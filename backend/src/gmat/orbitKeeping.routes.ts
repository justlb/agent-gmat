import type { FastifyInstance } from "fastify"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import type { AppConfig } from "../config.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { analyzeOrbitKeepingRunWithLlm, loadOrbitKeepingRunConversation } from "./orbitKeepingAnalysis.js"
import { defaultOrbitKeepingValuesPath, generateOrbitKeepingMission, type OrbitKeepingProgress } from "./orbitKeeping.service.js"
import { confirmOrbitKeepingDraft, createOrbitKeepingDraft, discussOrbitKeepingDraft, draftToOrbitKeepingChanges, loadOrbitKeepingDraft } from "./orbitKeepingDraft.js"
import { parseOrbitKeepingValues } from "./orbitKeepingValues.js"

type GenerateOrbitKeepingBody = { request?: unknown; workspaceDir?: unknown }
type AnalyzeOrbitKeepingBody = { question?: unknown; runPath?: unknown }
type DraftMessageBody = { message?: unknown; workspaceDir?: unknown }
type DraftWorkspaceBody = { workspaceDir?: unknown }
type OrbitKeepingFileKind = "log" | "manifest" | "report" | "result" | "script" | "timeseries" | "values"

function getOrbitKeepingOutputDir(userWorkspaceRoot: string) {
  return path.join(path.resolve(userWorkspaceRoot), "gmat", "orbit-keeping")
}

function orbitKeepingFileKind(fileName: string): OrbitKeepingFileKind | null {
  if (fileName.endsWith(".script")) return "script"
  if (fileName.endsWith(".values.yaml")) return "values"
  if (fileName === "gmat_result.json") return "result"
  if (fileName === "orbit_timeseries.json") return "timeseries"
  if (fileName === "run_manifest.json") return "manifest"
  if (fileName === "ReboostReport.txt" || fileName === "OrbitAnalysisReport.txt") return "report"
  if (fileName === "gmat.log") return "log"
  return null
}

async function listOrbitKeepingFiles(userWorkspaceRoot: string) {
  const root = path.resolve(userWorkspaceRoot)
  const files: Array<{ artifactId: string; fileName: string; kind: OrbitKeepingFileKind; mtimeMs: number; relativePath: string; size: number }> = []
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 8) return
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const child = path.join(directory, entry.name)
      if (entry.name === "gmat") {
        const outputDir = path.join(child, "orbit-keeping")
        const outputEntries = await fs.readdir(outputDir, { withFileTypes: true }).catch(() => [])
        if (outputEntries.length === 0) {
          await visit(child, depth + 1)
          continue
        }
        const addOutputFile = async (outputPath: string, fileName: string) => {
          const kind = orbitKeepingFileKind(fileName)
          if (!kind) return
          const stat = await fs.stat(outputPath)
          files.push({
            artifactId: path.basename(path.dirname(outputPath)),
            fileName,
            kind,
            mtimeMs: stat.mtimeMs,
            relativePath: path.relative(root, outputPath),
            size: stat.size,
          })
        }
        for (const outputEntry of outputEntries) {
          const outputPath = path.join(outputDir, outputEntry.name)
          if (outputEntry.isFile()) {
            await addOutputFile(outputPath, outputEntry.name)
            continue
          }
          if (!outputEntry.isDirectory()) continue
          const runEntries = await fs.readdir(outputPath, { withFileTypes: true }).catch(() => [])
          for (const runEntry of runEntries) {
            if (runEntry.isFile()) await addOutputFile(path.join(outputPath, runEntry.name), runEntry.name)
          }
        }
        continue
      }
      await visit(child, depth + 1)
    }
  }
  await visit(root, 0)
  return files.sort((left, right) => right.mtimeMs - left.mtimeMs)
}

function resolveListedOrbitKeepingFilePath(userWorkspaceRoot: string, relativePath: unknown) {
  if (typeof relativePath !== "string" || !relativePath.trim()) return null
  const root = path.resolve(userWorkspaceRoot)
  const filePath = path.resolve(root, relativePath)
  const normalized = filePath.split(path.sep).join("/")
  if (
    !isPathInside(root, filePath) ||
    !/\/gmat\/orbit-keeping(?:\/[^/]+)?\/(?:[^/]+\.script|[^/]+\.values\.yaml|gmat_result\.json|orbit_timeseries\.json|run_manifest\.json|ReboostReport\.txt|OrbitAnalysisReport\.txt|gmat\.log)$/u.test(normalized)
  ) return null
  return filePath
}

function resolveOrbitKeepingRunDir(userWorkspaceRoot: string, runPath: unknown) {
  if (typeof runPath !== "string" || !runPath.trim()) return null
  const root = path.resolve(userWorkspaceRoot)
  const runDir = path.resolve(root, runPath)
  const normalized = runDir.split(path.sep).join("/")
  if (!isPathInside(root, runDir) || !/\/gmat\/orbit-keeping\/[^/]+$/u.test(normalized)) return null
  return runDir
}

function resolveOutputWorkspaceDir(userWorkspaceRoot: string, requestedWorkspaceDir: unknown) {
  if (typeof requestedWorkspaceDir !== "string" || !requestedWorkspaceDir.trim()) return userWorkspaceRoot
  const workspaceDir = path.resolve(requestedWorkspaceDir)
  if (!isPathInside(path.resolve(userWorkspaceRoot), workspaceDir)) {
    throw new Error("workspaceDir must be inside the current user workspace")
  }
  return workspaceDir
}

/** HTTP boundary for the one-call, deterministic orbit-keeping pipeline. */
export async function orbitKeepingRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.post<{ Body: DraftWorkspaceBody }>("/api/gmat/orbit-keeping/drafts", async (req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      return reply.send(await createOrbitKeepingDraft(resolveOutputWorkspaceDir(userWorkspaceRoot, req.body?.workspaceDir)))
    } catch (err) {
      return reply.status(422).send({ error: getErrorMessage(err, "failed to create GMAT draft") })
    }
  })

  fastify.get<{ Params: { draftId: string }; Querystring: { workspaceDir?: string } }>("/api/gmat/orbit-keeping/drafts/:draftId", async (req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      return reply.send(await loadOrbitKeepingDraft(resolveOutputWorkspaceDir(userWorkspaceRoot, req.query.workspaceDir), req.params.draftId))
    } catch (err) {
      return reply.status(404).send({ error: getErrorMessage(err, "GMAT draft not found") })
    }
  })

  fastify.post<{ Params: { draftId: string }; Body: DraftMessageBody }>("/api/gmat/orbit-keeping/drafts/:draftId/messages", async (req, reply) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!message) return reply.status(400).send({ error: "message must be a non-empty string" })
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveOutputWorkspaceDir(userWorkspaceRoot, req.body?.workspaceDir)
      const draft = await loadOrbitKeepingDraft(workspaceDir, req.params.draftId)
      return reply.send(await discussOrbitKeepingDraft({ connection: resolveModelBackend(config, "chatModel"), draft, message, workspaceDir }))
    } catch (err) {
      return reply.status(422).send({ error: getErrorMessage(err, "failed to update GMAT draft") })
    }
  })

  fastify.post<{ Params: { draftId: string }; Body: DraftWorkspaceBody }>("/api/gmat/orbit-keeping/drafts/:draftId/confirm", async (req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      return reply.send(await confirmOrbitKeepingDraft(resolveOutputWorkspaceDir(userWorkspaceRoot, req.body?.workspaceDir), req.params.draftId))
    } catch (err) {
      return reply.status(422).send({ error: getErrorMessage(err, "failed to confirm GMAT draft") })
    }
  })

  fastify.post<{ Params: { draftId: string }; Body: DraftWorkspaceBody }>("/api/gmat/orbit-keeping/drafts/:draftId/execute", async (req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveOutputWorkspaceDir(userWorkspaceRoot, req.body?.workspaceDir)
      const draft = await loadOrbitKeepingDraft(workspaceDir, req.params.draftId)
      const values = parseOrbitKeepingValues(await fs.readFile(defaultOrbitKeepingValuesPath(), "utf8"))
      const result = await generateOrbitKeepingMission({
        changes: draftToOrbitKeepingChanges(draft, values),
        connection: resolveModelBackend(config, "chatModel"),
        execution: config.tools.gmat.bin ? { bin: config.tools.gmat.bin, timeoutMs: config.tools.gmat.timeoutMs } : undefined,
        request: `Confirmed GMAT mission draft ${draft.draftId}`,
        workspaceDir,
      })
      return reply.send({ ...result, runPath: path.relative(path.resolve(userWorkspaceRoot), result.runDir) })
    } catch (err) {
      return reply.status(422).send({ error: getErrorMessage(err, "failed to execute GMAT draft") })
    }
  })

  fastify.get<{ Querystring: { runPath?: string } }>("/api/gmat/orbit-keeping/timeseries", async (req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    const runDir = resolveOrbitKeepingRunDir(userWorkspaceRoot, req.query.runPath)
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    const source = await fs.readFile(path.join(runDir, "orbit_timeseries.json"), "utf8").catch(() => null)
    if (source === null) return reply.status(404).send({ error: "GMAT time series is not available for this run" })
    try {
      const samples: unknown = JSON.parse(source)
      if (!Array.isArray(samples)) throw new Error("invalid time series")
      return reply.send({ samples })
    } catch {
      return reply.status(422).send({ error: "GMAT time series is invalid" })
    }
  })

  fastify.post<{ Body: GenerateOrbitKeepingBody }>("/api/gmat/orbit-keeping/generate/events", async (req, reply) => {
    const request = typeof req.body?.request === "string" ? req.body.request.trim() : ""
    if (!request) return reply.status(400).send({ error: "request must be a non-empty string" })
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })

    const sendEvent = (event: string, payload: unknown) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
    }
    reply.hijack()
    reply.raw.writeHead(200, {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    })
    try {
      const workspaceDir = resolveOutputWorkspaceDir(userWorkspaceRoot, req.body?.workspaceDir)
      const result = await generateOrbitKeepingMission({
        connection: resolveModelBackend(config, "chatModel"),
        execution: config.tools.gmat.bin ? { bin: config.tools.gmat.bin, timeoutMs: config.tools.gmat.timeoutMs } : undefined,
        onProgress: (progress: OrbitKeepingProgress) => sendEvent("progress", progress),
        request,
        workspaceDir,
      })
      sendEvent("result", { ...result, runPath: path.relative(path.resolve(userWorkspaceRoot), result.runDir) })
    } catch (err) {
      sendEvent("error", { error: getErrorMessage(err, "failed to generate orbit-keeping mission") })
    } finally {
      reply.raw.end()
    }
  })

  fastify.post<{ Body: AnalyzeOrbitKeepingBody }>("/api/gmat/orbit-keeping/analyze", async (req, reply) => {
    const question = typeof req.body?.question === "string" ? req.body.question.trim() : ""
    if (!question) return reply.status(400).send({ error: "question must be a non-empty string" })
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    const runDir = resolveOrbitKeepingRunDir(userWorkspaceRoot, req.body?.runPath)
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      return reply.send(await analyzeOrbitKeepingRunWithLlm({
        connection: resolveModelBackend(config, "chatModel"),
        question,
        runDir,
      }))
    } catch (err) {
      return reply.status(422).send({ error: getErrorMessage(err, "failed to analyze GMAT run") })
    }
  })

  fastify.get<{ Querystring: { runPath?: string } }>("/api/gmat/orbit-keeping/analyze/history", async (req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    const runDir = resolveOrbitKeepingRunDir(userWorkspaceRoot, req.query.runPath)
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      return reply.send({ conversation: await loadOrbitKeepingRunConversation(runDir) })
    } catch (err) {
      return reply.status(422).send({ error: getErrorMessage(err, "failed to read GMAT run conversation") })
    }
  })

  fastify.get("/api/gmat/orbit-keeping/files", async (_req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    return reply.send({ files: await listOrbitKeepingFiles(userWorkspaceRoot) })
  })

  fastify.get<{ Querystring: { relativePath?: string } }>("/api/gmat/orbit-keeping/files/download", async (req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    const filePath = resolveListedOrbitKeepingFilePath(userWorkspaceRoot, req.query.relativePath)
    if (!filePath) return reply.status(400).send({ error: "invalid GMAT artifact path" })
    const kind = orbitKeepingFileKind(path.basename(filePath))
    if (!kind) return reply.status(400).send({ error: "invalid GMAT artifact path" })
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile()) return reply.status(404).send({ error: "GMAT artifact not found" })
    return reply
      .header("Content-Type", kind === "values" ? "application/x-yaml; charset=utf-8" : kind === "result" || kind === "manifest" || kind === "timeseries" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`)
      .header("Content-Length", String(stat.size))
      .send(createReadStream(filePath))
  })

  fastify.post<{ Body: GenerateOrbitKeepingBody }>("/api/gmat/orbit-keeping/generate", async (req, reply) => {
    const request = typeof req.body?.request === "string" ? req.body.request.trim() : ""
    if (!request) return reply.status(400).send({ error: "request must be a non-empty string" })

    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })

    try {
      const workspaceDir = resolveOutputWorkspaceDir(userWorkspaceRoot, req.body?.workspaceDir)
      const result = await generateOrbitKeepingMission({
        connection: resolveModelBackend(config, "chatModel"),
        execution: config.tools.gmat.bin ? {
          bin: config.tools.gmat.bin,
          timeoutMs: config.tools.gmat.timeoutMs,
        } : undefined,
        request,
        workspaceDir,
      })
      return reply.send({
        ...result,
        runPath: path.relative(path.resolve(userWorkspaceRoot), result.runDir),
      })
    } catch (err) {
      return reply.status(422).send({ error: getErrorMessage(err, "failed to generate orbit-keeping mission") })
    }
  })
}
