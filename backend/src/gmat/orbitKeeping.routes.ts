import type { FastifyInstance } from "fastify"
import { spawn } from "node:child_process"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import type { AppConfig } from "../config.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { digitalThreadGmatSeed, syncDigitalThreadFromGmatDraft } from "../digitalThread/gmatDigitalThreadAdapter.js"
import { captureDigitalThreadSnapshot, draftDigitalThreadWorkspaceDir, snapshotDigitalThreadForRun } from "../digitalThread/digitalThreadStore.js"
import { appendMissionConversation, appendRunConversation, mergeMissionConversationIntoRun, snapshotMissionConversationForRun } from "../digitalThread/missionConversationStore.js"
import { analyzeOrbitKeepingRunWithLlm, loadOrbitKeepingRunConversation } from "./orbitKeepingAnalysis.js"
import { defaultOrbitKeepingValuesPath, generateOrbitKeepingMission, type OrbitKeepingProgress } from "./orbitKeeping.service.js"
import { appendOrbitKeepingDraftConversation, confirmOrbitKeepingDraft, createOrbitKeepingDraft, discussOrbitKeepingDraft, draftToOrbitKeepingChanges, loadOrbitKeepingDraft, recordOrbitKeepingDraftRun } from "./orbitKeepingDraft.js"
import { parseOrbitKeepingValues } from "./orbitKeepingValues.js"
import { toGmatNativePath } from "./orbitKeepingRunner.js"

type GenerateOrbitKeepingBody = { request?: unknown; workspaceDir?: unknown }
type AnalyzeOrbitKeepingBody = { draftId?: unknown; question?: unknown; runPath?: unknown; workspaceDir?: unknown }
type DraftMessageBody = { message?: unknown; workspaceDir?: unknown }
type DraftWorkspaceBody = { workspaceDir?: unknown }
type OrbitKeepingFileKind = "digital-thread" | "ephemeris" | "log" | "manifest" | "opalis" | "report" | "result" | "rf-comlink" | "script" | "timeseries" | "values"

function resolveOrbitKeepingDraftArtifact(workspaceDir: string, draftId: string, fileName: string) {
  if (!/^draft_[a-f0-9-]+$/u.test(draftId) || !["orbit_keeping.values.yaml"].includes(fileName)) return null
  return path.join(path.resolve(workspaceDir), "gmat", "drafts", draftId, fileName)
}

function getOrbitKeepingOutputDir(userWorkspaceRoot: string) {
  return path.join(path.resolve(userWorkspaceRoot), "gmat", "orbit-keeping")
}

function orbitKeepingFileKind(fileName: string): OrbitKeepingFileKind | null {
  if (fileName.endsWith(".script")) return "script"
  if (fileName.endsWith(".values.yaml")) return "values"
  if (fileName === "gmat_result.json") return "result"
  if (fileName === "consolidated-run-report.json") return "result"
  if (fileName === "workflow-status.json") return "result"
  if (fileName === "satellite.digital-thread.json" || fileName === "satellite.json") return "digital-thread"
  if (fileName === "orbit_timeseries.json") return "timeseries"
  if (fileName === "run_manifest.json") return "manifest"
  if (fileName === "ReboostReport.txt" || fileName === "OrbitAnalysisReport.txt") return "report"
  if (fileName === "gmat.log") return "log"
  if (fileName === "EphemerisFile1.oem") return "ephemeris"
  if (fileName.endsWith(".scd")) return "opalis"
  if (fileName === "prepared-opalis.opalis" || fileName === "prepared-opalis.json" || fileName === "calculated-opalis.opalis" || fileName === "calculated-opalis.json" || fileName === "opalis-parameters.json") return "opalis"
  if (fileName === "rf-comlink-inputs.json" || fileName === "prepared-rf-comlink.rfcl" || fileName === "calculated-rf-comlink.rfcl") return "rf-comlink"
  return null
}

async function listOrbitKeepingFiles(userWorkspaceRoot: string) {
  const root = path.resolve(userWorkspaceRoot)
  const files: Array<{ artifactId: string; fileName: string; kind: OrbitKeepingFileKind; mtimeMs: number; relativePath: string; runPath?: string; size: number }> = []
  const addMissionRunFiles = async (runsDir: string) => {
    const runs = await fs.readdir(runsDir, { withFileTypes: true }).catch(() => [])
    for (const run of runs) {
      if (!run.isDirectory()) continue
      const runDir = path.join(runsDir, run.name)
      const manifest = JSON.parse(await fs.readFile(path.join(runDir, "run_manifest.json"), "utf8").catch(() => "{}")) as { templateId?: unknown }
      if (manifest.templateId !== "orbit-keeping") continue
      const entries = await fs.readdir(runDir, { withFileTypes: true }).catch(() => [])
      const hasUserFacingSatellite = entries.some(entry => entry.isFile() && entry.name === "satellite.json")
      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (hasUserFacingSatellite && entry.name === "satellite.digital-thread.json") continue
        const kind = orbitKeepingFileKind(entry.name)
        if (!kind) continue
        const filePath = path.join(runDir, entry.name)
        const stat = await fs.stat(filePath)
        files.push({ artifactId: run.name, fileName: entry.name, kind, mtimeMs: stat.mtimeMs, relativePath: path.relative(root, filePath), size: stat.size })
      }
      const opalisFiles = [
        ["consolidated-run-report.json"],
        ["opalis", "02-simu-cic", "00-scenario-input", "simucic-input.scd"],
        ["opalis", "02-opalis-input", "opalis-parameters.json"],
        ["opalis", "03-opalis", "02-resultats", "prepared-opalis.opalis"],
        ["opalis", "03-opalis", "02-resultats", "prepared-opalis.json"],
        ["opalis", "03-opalis", "02-resultats", "calculated-opalis.opalis"],
        ["opalis", "03-opalis", "02-resultats", "calculated-opalis.json"],
      ]
      for (const parts of opalisFiles) {
        const filePath = path.join(runDir, ...parts)
        const stat = await fs.stat(filePath).catch(() => null)
        const kind = orbitKeepingFileKind(parts.at(-1) ?? "")
        if (stat?.isFile() && kind) files.push({ artifactId: run.name, fileName: parts.at(-1)!, kind, mtimeMs: stat.mtimeMs, relativePath: path.relative(root, filePath), runPath: path.relative(root, runDir), size: stat.size })
      }
      const generatedScenarioDir = path.join(runDir, "opalis", "02-simu-cic", "01-execution-complete")
      for (const entry of await fs.readdir(generatedScenarioDir, { withFileTypes: true }).catch(() => [])) {
        if (!entry.isFile() || !entry.name.endsWith(".scd")) continue
        const filePath = path.join(generatedScenarioDir, entry.name)
        const stat = await fs.stat(filePath)
        files.push({ artifactId: run.name, fileName: entry.name, kind: "opalis", mtimeMs: stat.mtimeMs, relativePath: path.relative(root, filePath), runPath: path.relative(root, runDir), size: stat.size })
      }
      const rfComlinkFiles = [
        ["rf-comlink", "01-input", "rf-comlink-inputs.json"],
        ["rf-comlink", "02-scenario", "prepared-rf-comlink.rfcl"],
        ["rf-comlink", "03-results", "calculated-rf-comlink.rfcl"],
      ]
      for (const parts of rfComlinkFiles) {
        const filePath = path.join(runDir, ...parts)
        const stat = await fs.stat(filePath).catch(() => null)
        const kind = orbitKeepingFileKind(parts.at(-1) ?? "")
        if (stat?.isFile() && kind) files.push({ artifactId: run.name, fileName: parts.at(-1)!, kind, mtimeMs: stat.mtimeMs, relativePath: path.relative(root, filePath), runPath: path.relative(root, runDir), size: stat.size })
      }
    }
  }
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > 8) return
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const child = path.join(directory, entry.name)
      if (entry.name === "gmat") {
        await addMissionRunFiles(path.join(child, "mission-runs"))
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
          const hasUserFacingSatellite = runEntries.some(entry => entry.isFile() && entry.name === "satellite.json")
          for (const runEntry of runEntries) {
            if (runEntry.isFile() && !(hasUserFacingSatellite && runEntry.name === "satellite.digital-thread.json")) await addOutputFile(path.join(outputPath, runEntry.name), runEntry.name)
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
    !/\/gmat\/(?:orbit-keeping|mission-runs)(?:\/[^/]+)?\/(?:[^/]+\.script|[^/]+\.values\.yaml|(?:gmat_result|consolidated-run-report|workflow-status)\.json|satellite(?:\.digital-thread)?\.json|orbit_timeseries\.json|run_manifest\.json|ReboostReport\.txt|OrbitAnalysisReport\.txt|EphemerisFile1\.oem|gmat\.log|opalis\/02-simu-cic\/(?:00-scenario-input\/simucic-input\.scd|01-execution-complete\/[^/]+\.scd)|opalis\/02-opalis-input\/opalis-parameters\.json|opalis\/03-opalis\/02-resultats\/(?:prepared|calculated)-opalis\.(?:opalis|json)|rf-comlink\/(?:01-input\/rf-comlink-inputs\.json|02-scenario\/prepared-rf-comlink\.rfcl|03-results\/calculated-rf-comlink\.rfcl))$/u.test(normalized)
  ) return null
  return filePath
}

function resolveOrbitKeepingRunDir(userWorkspaceRoot: string, runPath: unknown) {
  if (typeof runPath !== "string" || !runPath.trim()) return null
  const root = path.resolve(userWorkspaceRoot)
  const runDir = path.resolve(root, runPath)
  const normalized = runDir.split(path.sep).join("/")
  if (!isPathInside(root, runDir) || !/\/gmat\/(?:orbit-keeping|mission-runs)\/[^/]+$/u.test(normalized)) return null
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

async function openGmatGui(guiBin: string | null, runDir: string) {
  if (!guiBin) throw new Error("GMAT GUI is not configured (tools.gmat.guiBin)")
  const script = (await fs.readdir(runDir)).find(file => file.endsWith(".script"))
  if (!script) throw new Error("GMAT script is not available for this run")
  await new Promise<void>((resolve, reject) => {
    const child = spawn(guiBin, [toGmatNativePath(path.join(runDir, script))], { detached: true, stdio: "ignore", windowsHide: false })
    child.once("error", reject)
    child.once("spawn", () => { child.unref(); resolve() })
  })
}

/** HTTP boundary for the one-call, deterministic orbit-keeping pipeline. */
export async function orbitKeepingRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.post<{ Body: { runPath?: unknown } }>("/api/gmat/orbit-keeping/open-gui", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveOrbitKeepingRunDir(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      await openGmatGui(config.tools.gmat.guiBin, runDir)
      return reply.send({ ok: true })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to open GMAT GUI") })
    }
  })
  fastify.post<{ Body: DraftWorkspaceBody }>("/api/gmat/orbit-keeping/drafts", async (req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      return reply.send(await createOrbitKeepingDraft(resolveOutputWorkspaceDir(userWorkspaceRoot, req.body?.workspaceDir)))
    } catch (err) {
      return reply.status(422).send({ error: getErrorMessage(err, "failed to create GMAT draft") })
    }
  })

  fastify.get<{ Querystring: { workspaceDir?: string } }>("/api/gmat/orbit-keeping/drafts", async (req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveOutputWorkspaceDir(userWorkspaceRoot, req.query.workspaceDir)
      const root = path.join(path.resolve(workspaceDir), "gmat", "drafts")
      const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
      const drafts = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => loadOrbitKeepingDraft(workspaceDir, entry.name).catch(() => null)))
      return reply.send({ drafts: drafts.filter((draft): draft is NonNullable<typeof draft> => draft !== null).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) })
    } catch (err) {
      return reply.status(422).send({ error: getErrorMessage(err, "failed to list GMAT drafts") })
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
  fastify.get<{ Params: { draftId: string }; Querystring: { file?: string; workspaceDir?: string } }>("/api/gmat/orbit-keeping/drafts/:draftId/download", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const fileName = typeof req.query.file === "string" ? req.query.file : ""
      const filePath = resolveOrbitKeepingDraftArtifact(resolveOutputWorkspaceDir(root, req.query.workspaceDir), req.params.draftId, fileName)
      const stat = filePath ? await fs.stat(filePath).catch(() => null) : null
      if (!filePath || !stat?.isFile()) return reply.status(404).send({ error: "GMAT draft artifact not found" })
      return reply.header("Content-Type", "application/x-yaml; charset=utf-8").header("Content-Disposition", `attachment; filename="${fileName}"`).send(createReadStream(filePath))
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to download GMAT draft artifact") }) }
  })

  fastify.post<{ Params: { draftId: string }; Body: DraftMessageBody }>("/api/gmat/orbit-keeping/drafts/:draftId/messages", async (req, reply) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!message) return reply.status(400).send({ error: "message must be a non-empty string" })
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    const workspaceDir = resolveOutputWorkspaceDir(userWorkspaceRoot, req.body?.workspaceDir)
    try {
      const draft = await loadOrbitKeepingDraft(workspaceDir, req.params.draftId)
      const updatedDraft = await discussOrbitKeepingDraft({ connection: resolveModelBackend(config, "chatModel"), draft, message, workspaceDir })
      await appendMissionConversation(workspaceDir, { answer: updatedDraft.assistantMessage ?? "Mission draft updated.", askedAt: updatedDraft.updatedAt, channel: "gmat-draft", question: message })
      await syncDigitalThreadFromGmatDraft(draftDigitalThreadWorkspaceDir(workspaceDir, "orbit-keeping", updatedDraft.draftId), updatedDraft)
      await syncDigitalThreadFromGmatDraft(workspaceDir, updatedDraft)
      return reply.send(updatedDraft)
    } catch (err) {
      const error = getErrorMessage(err, "failed to update GMAT draft")
      const answer = `Mission configuration error: ${error}`
      await appendOrbitKeepingDraftConversation(workspaceDir, req.params.draftId, { assistant: answer, user: message }).catch(() => undefined)
      await appendMissionConversation(workspaceDir, { answer, askedAt: new Date().toISOString(), channel: "gmat-draft", question: message }).catch(() => undefined)
      return reply.status(422).send({ error })
    }
  })

  fastify.post<{ Params: { draftId: string }; Body: DraftWorkspaceBody }>("/api/gmat/orbit-keeping/drafts/:draftId/confirm", async (req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveOutputWorkspaceDir(userWorkspaceRoot, req.body?.workspaceDir)
      const current = await loadOrbitKeepingDraft(workspaceDir, req.params.draftId)
      const authoritative = current.digitalThreadRequiredPaths?.length ? (await digitalThreadGmatSeed(draftDigitalThreadWorkspaceDir(workspaceDir, "orbit-keeping", current.draftId), "orbit-keeping")).values : undefined
      return reply.send(await confirmOrbitKeepingDraft(workspaceDir, req.params.draftId, authoritative))
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
      const digitalThreadSnapshot = await captureDigitalThreadSnapshot(draftDigitalThreadWorkspaceDir(workspaceDir, "orbit-keeping", draft.draftId))
      const result = await generateOrbitKeepingMission({
        changes: draftToOrbitKeepingChanges(draft, values),
        connection: resolveModelBackend(config, "chatModel"),
        execution: config.tools.gmat.bin ? { bin: config.tools.gmat.bin, timeoutMs: config.tools.gmat.timeoutMs } : undefined,
        request: `Confirmed GMAT mission draft ${draft.draftId}`,
        workspaceDir,
      })
      const runPath = path.relative(path.resolve(userWorkspaceRoot), result.runDir)
      await snapshotMissionConversationForRun(workspaceDir, result.runDir, draft.conversation)
      await appendRunConversation(result.runDir, { answer: result.result.status === "failed" || result.result.status === "timeout" ? `GMAT ${result.result.status}: ${result.result.error || "GMAT did not produce a usable result. Review the generated log file for details."}` : "GMAT completed successfully. You can now ask questions about the saved results or request a revised run.", askedAt: new Date().toISOString(), channel: "gmat-draft", question: "GMAT execution" })
      await snapshotDigitalThreadForRun(workspaceDir, result.runDir, digitalThreadSnapshot)
      await recordOrbitKeepingDraftRun(workspaceDir, draft.draftId, {
        changes: result.changes,
        completedAt: new Date().toISOString(),
        result: result.result,
        runId: result.runId,
        runPath,
      })
      return reply.send({ ...result, draftId: draft.draftId, runPath })
    } catch (err) {
      return reply.status(422).send({ error: getErrorMessage(err, "failed to execute GMAT draft") })
    }
  })

  fastify.post<{ Params: { draftId: string }; Body: DraftWorkspaceBody }>("/api/gmat/orbit-keeping/drafts/:draftId/execute/events", async (req, reply) => {
    const userWorkspaceRoot = getRequestUserWorkspaceRoot()
    if (!userWorkspaceRoot) return reply.status(500).send({ error: "user workspace is unavailable" })
    const sendEvent = (event: string, payload: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
    reply.hijack()
    reply.raw.writeHead(200, { "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" })
    try {
      const workspaceDir = resolveOutputWorkspaceDir(userWorkspaceRoot, req.body?.workspaceDir)
      const draft = await loadOrbitKeepingDraft(workspaceDir, req.params.draftId)
      const values = parseOrbitKeepingValues(await fs.readFile(defaultOrbitKeepingValuesPath(), "utf8"))
      const digitalThreadSnapshot = await captureDigitalThreadSnapshot(draftDigitalThreadWorkspaceDir(workspaceDir, "orbit-keeping", draft.draftId))
      const result = await generateOrbitKeepingMission({
        changes: draftToOrbitKeepingChanges(draft, values),
        connection: resolveModelBackend(config, "chatModel"),
        execution: config.tools.gmat.bin ? { bin: config.tools.gmat.bin, timeoutMs: config.tools.gmat.timeoutMs } : undefined,
        onProgress: progress => sendEvent("progress", progress),
        request: `Confirmed GMAT mission draft ${draft.draftId}`,
        workspaceDir,
      })
      const runPath = path.relative(path.resolve(userWorkspaceRoot), result.runDir)
      await snapshotMissionConversationForRun(workspaceDir, result.runDir, draft.conversation)
      await appendRunConversation(result.runDir, { answer: result.result.status === "failed" || result.result.status === "timeout" ? `GMAT ${result.result.status}: ${result.result.error || "GMAT did not produce a usable result. Review the generated log file for details."}` : "GMAT completed successfully. You can now ask questions about the saved results or request a revised run.", askedAt: new Date().toISOString(), channel: "gmat-draft", question: "GMAT execution" })
      await snapshotDigitalThreadForRun(workspaceDir, result.runDir, digitalThreadSnapshot)
      await recordOrbitKeepingDraftRun(workspaceDir, draft.draftId, { changes: result.changes, completedAt: new Date().toISOString(), result: result.result, runId: result.runId, runPath })
      sendEvent("result", { ...result, draftId: draft.draftId, runPath })
    } catch (err) {
      sendEvent("error", { error: getErrorMessage(err, "failed to execute GMAT draft") })
    } finally {
      reply.raw.end()
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
      const draftId = typeof req.body?.draftId === "string" ? req.body.draftId : ""
      const workspaceDir = resolveOutputWorkspaceDir(userWorkspaceRoot, req.body?.workspaceDir)
      const draft = draftId ? await loadOrbitKeepingDraft(workspaceDir, draftId) : null
      if (draft) await mergeMissionConversationIntoRun(workspaceDir, runDir, draft.conversation)
      const relatedRuns = draft?.runs ?? []
      return reply.send(await analyzeOrbitKeepingRunWithLlm({
        connection: resolveModelBackend(config, "chatModel"),
        question,
        relatedRuns,
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
      .header("Content-Type", kind === "values" ? "application/x-yaml; charset=utf-8" : kind === "digital-thread" || kind === "result" || kind === "manifest" || kind === "timeseries" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8")
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
