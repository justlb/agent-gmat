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
import { analyzeElectricPropulsionRunWithLlm, loadElectricPropulsionRunConversation } from "./electricPropulsionAnalysis.js"
import { appendElectricPropulsionDraftConversation, confirmElectricPropulsionDraft, createElectricPropulsionDraft, discussElectricPropulsionDraft, draftToElectricPropulsionChanges, loadElectricPropulsionDraft, recordElectricPropulsionDraftRun } from "./electricPropulsionDraft.js"
import { generateElectricPropulsionMission } from "./electricPropulsion.service.js"
import { extractElectricPropulsionValues } from "./electricPropulsionValues.js"
import { defaultElectricPropulsionTemplatePath } from "./electricPropulsionTemplate.js"
import { resolveMissionWorkspace } from "./missionWorkspace.js"
import { toGmatNativePath } from "./orbitKeepingRunner.js"
import { listRunArtifactHistory } from "./artifactHistory.js"
import { finalizeMissionRun } from "./missionRunLifecycle.js"

type DraftMessageBody = { message?: unknown; workspaceDir?: unknown }
type DraftWorkspaceBody = { workspaceDir?: unknown }
type AnalyzeBody = { draftId?: unknown; question?: unknown; runPath?: unknown; workspaceDir?: unknown }
type ElectricPropulsionFileKind = "calibration" | "digital-thread" | "ephemeris" | "log" | "manifest" | "opalis" | "report" | "result" | "rf-comlink" | "script" | "timeseries" | "values" | "vts"

function resolveElectricPropulsionDraftArtifact(workspaceDir: string, draftId: string, fileName: string) {
  if (!/^electric_draft_[a-f0-9-]+$/u.test(draftId) || !["electric_propulsion_transfer.values.yaml"].includes(fileName)) return null
  return path.join(path.resolve(workspaceDir), "gmat", "electric-propulsion-transfer", "drafts", draftId, fileName)
}

function electricPropulsionFileKind(fileName: string): ElectricPropulsionFileKind | null {
  if (fileName.endsWith(".script")) return "script"
  if (fileName.endsWith(".values.yaml")) return "values"
  if (fileName === "gmat_result.json") return "result"
  if (fileName === "consolidated-run-report.json") return "result"
  if (fileName === "workflow-status.json") return "result"
  if (fileName === "satellite.digital-thread.json" || fileName === "satellite.json") return "digital-thread"
  if (fileName === "electric_transfer_timeseries.json") return "timeseries"
  if (fileName === "electric_propulsion_calibration.json") return "calibration"
  if (fileName === "run_manifest.json") return "manifest"
  if (fileName === "ElectricTransferReport.txt") return "report"
  if (fileName === "gmat.log") return "log"
  if (fileName === "EphemerisFile1.oem") return "ephemeris"
  if (fileName === "gmat-orbit.vts" || fileName === "GMAT_OEM_POSITION.TXT") return "vts"
  if (fileName.endsWith(".scd")) return "opalis"
  if (fileName === "prepared-opalis.opalis" || fileName === "prepared-opalis.json" || fileName === "calculated-opalis.opalis" || fileName === "calculated-opalis.json" || fileName === "opalis-parameters.json") return "opalis"
  if (fileName === "rf-comlink-inputs.json" || fileName === "prepared-rf-comlink.rfcl" || fileName === "calculated-rf-comlink.rfcl" || fileName === "rf-comlink-results.json") return "rf-comlink"
  return null
}

async function listElectricPropulsionFiles(userWorkspaceRoot: string) {
  const root = path.resolve(userWorkspaceRoot)
  const files: Array<{ artifactId: string; fileName: string; historical?: boolean; kind: ElectricPropulsionFileKind; mtimeMs: number; relativePath: string; runPath?: string; size: number }> = []
  const addMissionRunFiles = async (runsDir: string) => {
    const runs = await fs.readdir(runsDir, { withFileTypes: true }).catch(() => [])
    for (const run of runs) {
      if (!run.isDirectory()) continue
      const runDir = path.join(runsDir, run.name)
      const manifest = JSON.parse(await fs.readFile(path.join(runDir, "run_manifest.json"), "utf8").catch(() => "{}")) as { templateId?: unknown }
      if (manifest.templateId !== "electric-propulsion-transfer") continue
      const entries = await fs.readdir(runDir, { withFileTypes: true }).catch(() => [])
      const hasUserFacingSatellite = entries.some(entry => entry.isFile() && entry.name === "satellite.json")
      for (const entry of entries) {
        if (!entry.isFile()) continue
        if (hasUserFacingSatellite && entry.name === "satellite.digital-thread.json") continue
        const kind = electricPropulsionFileKind(entry.name)
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
        const kind = electricPropulsionFileKind(parts.at(-1) ?? "")
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
        ["rf-comlink", "03-results", "rf-comlink-results.json"],
      ]
      for (const parts of rfComlinkFiles) {
        const filePath = path.join(runDir, ...parts)
        const stat = await fs.stat(filePath).catch(() => null)
        const kind = electricPropulsionFileKind(parts.at(-1) ?? "")
        if (stat?.isFile() && kind) files.push({ artifactId: run.name, fileName: parts.at(-1)!, kind, mtimeMs: stat.mtimeMs, relativePath: path.relative(root, filePath), runPath: path.relative(root, runDir), size: stat.size })
      }
      const vtsFiles = [["vts", "gmat-orbit.vts"], ["vts", "Data", "GMAT_OEM_POSITION.TXT"]]
      for (const parts of vtsFiles) {
        const filePath = path.join(runDir, ...parts)
        const stat = await fs.stat(filePath).catch(() => null)
        const kind = electricPropulsionFileKind(parts.at(-1) ?? "")
        if (stat?.isFile() && kind) files.push({ artifactId: run.name, fileName: parts.at(-1)!, kind, mtimeMs: stat.mtimeMs, relativePath: path.relative(root, filePath), runPath: path.relative(root, runDir), size: stat.size })
      }
      for (const artifact of await listRunArtifactHistory(runDir)) {
        const kind = electricPropulsionFileKind(path.basename(artifact.filePath))
        if (!kind) continue
        const versionDir = path.join(runDir, "artifact-history", artifact.stage, artifact.version)
        const stat = await fs.stat(artifact.filePath)
        files.push({ artifactId: `${run.name} · ${artifact.version}`, fileName: path.basename(artifact.filePath), historical: true, kind, mtimeMs: stat.mtimeMs, relativePath: path.relative(root, artifact.filePath), runPath: path.relative(root, versionDir), size: stat.size })
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
        const outputDir = path.join(child, "electric-propulsion-transfer")
        const outputEntries = await fs.readdir(outputDir, { withFileTypes: true }).catch(() => [])
        for (const outputEntry of outputEntries) {
          if (!outputEntry.isDirectory() || outputEntry.name === "drafts") continue
          const runDir = path.join(outputDir, outputEntry.name)
          const runEntries = await fs.readdir(runDir, { withFileTypes: true }).catch(() => [])
          const hasUserFacingSatellite = runEntries.some(entry => entry.isFile() && entry.name === "satellite.json")
          for (const runEntry of runEntries) {
            if (!runEntry.isFile()) continue
            if (hasUserFacingSatellite && runEntry.name === "satellite.digital-thread.json") continue
            const kind = electricPropulsionFileKind(runEntry.name)
            if (!kind) continue
            const filePath = path.join(runDir, runEntry.name)
            const stat = await fs.stat(filePath)
            files.push({ artifactId: outputEntry.name, fileName: runEntry.name, kind, mtimeMs: stat.mtimeMs, relativePath: path.relative(root, filePath), size: stat.size })
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

function resolveListedElectricPropulsionFilePath(userWorkspaceRoot: string, relativePath: unknown) {
  if (typeof relativePath !== "string" || !relativePath.trim()) return null
  const root = path.resolve(userWorkspaceRoot)
  const filePath = path.resolve(root, relativePath)
  const normalized = filePath.split(path.sep).join("/")
  const segments = path.relative(root, filePath).split(path.sep)
  const historyIndex = segments.indexOf("artifact-history")
  const historicalArtifact = historyIndex >= 0 && segments.length > historyIndex + 3 && /^[A-Za-z0-9_-]+$/u.test(segments[historyIndex + 1]) && /^[-A-Za-z0-9_]+$/u.test(segments[historyIndex + 2]) && Boolean(electricPropulsionFileKind(path.basename(filePath)))
  if (!isPathInside(root, filePath) || (!historicalArtifact && !/\/gmat\/(?:electric-propulsion-transfer|mission-runs)\/[^/]+\/(?:[^/]+\.script|[^/]+\.values\.yaml|(?:gmat_result|consolidated-run-report|workflow-status)\.json|satellite(?:\.digital-thread)?\.json|electric_transfer_timeseries\.json|electric_propulsion_calibration\.json|run_manifest\.json|ElectricTransferReport\.txt|EphemerisFile1\.oem|gmat\.log|vts\/(?:gmat-orbit\.vts|Data\/GMAT_OEM_POSITION\.TXT)|opalis\/02-simu-cic\/(?:00-scenario-input\/simucic-input\.scd|01-execution-complete\/[^/]+\.scd)|opalis\/02-opalis-input\/opalis-parameters\.json|opalis\/03-opalis\/02-resultats\/(?:prepared|calculated)-opalis\.(?:opalis|json)|rf-comlink\/(?:01-input\/rf-comlink-inputs\.json|02-scenario\/prepared-rf-comlink\.rfcl|03-results\/(?:calculated-rf-comlink\.rfcl|rf-comlink-results\.json)))$/u.test(normalized))) return null
  return filePath
}

function resolveOutputWorkspaceDir(userWorkspaceRoot: string, requestedWorkspaceDir: unknown) {
  return resolveMissionWorkspace(userWorkspaceRoot, requestedWorkspaceDir)
}
function resolveRunDir(userWorkspaceRoot: string, runPath: unknown) {
  if (typeof runPath !== "string" || !runPath.trim()) return null
  const root = path.resolve(userWorkspaceRoot)
  const runDir = path.resolve(root, runPath)
  const normalized = runDir.split(path.sep).join("/")
  return isPathInside(root, runDir) && /\/gmat\/(?:electric-propulsion-transfer|mission-runs)\/[^/]+$/u.test(normalized) ? runDir : null
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

/** HTTP boundary for the draft-first electric-propulsion transfer workflow. */
export async function electricPropulsionRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.post<{ Body: { runPath?: unknown } }>("/api/gmat/electric-propulsion-transfer/open-gui", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveRunDir(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      await openGmatGui(config.tools.gmat.guiBin, runDir)
      return reply.send({ ok: true })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to open GMAT GUI") })
    }
  })
  fastify.get("/api/gmat/electric-propulsion-transfer/files", async (_req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    return reply.send({ files: await listElectricPropulsionFiles(root) })
  })
  fastify.get<{ Querystring: { relativePath?: string } }>("/api/gmat/electric-propulsion-transfer/files/download", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const filePath = root ? resolveListedElectricPropulsionFilePath(root, req.query.relativePath) : null
    if (!filePath) return reply.status(400).send({ error: "invalid GMAT artifact path" })
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile()) return reply.status(404).send({ error: "GMAT artifact not found" })
    const kind = electricPropulsionFileKind(path.basename(filePath))
    return reply
      .header("Content-Type", kind === "values" ? "application/x-yaml; charset=utf-8" : kind === "digital-thread" || kind === "result" || kind === "manifest" || kind === "timeseries" ? "application/json; charset=utf-8" : "text/plain; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`)
      .header("Content-Length", String(stat.size))
      .send(createReadStream(filePath))
  })
  fastify.post<{ Body: DraftWorkspaceBody }>("/api/gmat/electric-propulsion-transfer/drafts", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try { return reply.send(await createElectricPropulsionDraft(resolveOutputWorkspaceDir(root, req.body?.workspaceDir))) } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to create electric-propulsion GMAT draft") }) }
  })
  fastify.get<{ Querystring: { workspaceDir?: string } }>("/api/gmat/electric-propulsion-transfer/drafts", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveOutputWorkspaceDir(root, req.query.workspaceDir)
      const entries = await fs.readdir(path.join(workspaceDir, "gmat", "electric-propulsion-transfer", "drafts"), { withFileTypes: true }).catch(() => [])
      const drafts = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => loadElectricPropulsionDraft(workspaceDir, entry.name).catch(() => null)))
      return reply.send({ drafts: drafts.filter((draft): draft is NonNullable<typeof draft> => draft !== null).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to list electric-propulsion GMAT drafts") }) }
  })
  fastify.get<{ Params: { draftId: string }; Querystring: { workspaceDir?: string } }>("/api/gmat/electric-propulsion-transfer/drafts/:draftId", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try { return reply.send(await loadElectricPropulsionDraft(resolveOutputWorkspaceDir(root, req.query.workspaceDir), req.params.draftId)) } catch (error) { return reply.status(404).send({ error: getErrorMessage(error, "GMAT draft not found") }) }
  })
  fastify.get<{ Params: { draftId: string }; Querystring: { file?: string; workspaceDir?: string } }>("/api/gmat/electric-propulsion-transfer/drafts/:draftId/download", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const fileName = typeof req.query.file === "string" ? req.query.file : ""
      const filePath = resolveElectricPropulsionDraftArtifact(resolveOutputWorkspaceDir(root, req.query.workspaceDir), req.params.draftId, fileName)
      const stat = filePath ? await fs.stat(filePath).catch(() => null) : null
      if (!filePath || !stat?.isFile()) return reply.status(404).send({ error: "GMAT draft artifact not found" })
      return reply.header("Content-Type", "application/x-yaml; charset=utf-8").header("Content-Disposition", `attachment; filename="${fileName}"`).send(createReadStream(filePath))
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to download electric-propulsion draft artifact") }) }
  })
  fastify.post<{ Params: { draftId: string }; Body: DraftMessageBody }>("/api/gmat/electric-propulsion-transfer/drafts/:draftId/messages", async (req, reply) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!message) return reply.status(400).send({ error: "message must be a non-empty string" })
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const workspaceDir = resolveOutputWorkspaceDir(root, req.body?.workspaceDir)
    try {
      const updatedDraft = await discussElectricPropulsionDraft({ connection: resolveModelBackend(config, "chatModel"), draft: await loadElectricPropulsionDraft(workspaceDir, req.params.draftId), message, workspaceDir })
      await appendMissionConversation(workspaceDir, { answer: updatedDraft.assistantMessage ?? "Mission draft updated.", askedAt: updatedDraft.updatedAt, channel: "gmat-draft", question: message })
      await syncDigitalThreadFromGmatDraft(draftDigitalThreadWorkspaceDir(workspaceDir, "electric-propulsion-transfer", updatedDraft.draftId), updatedDraft)
      await syncDigitalThreadFromGmatDraft(workspaceDir, updatedDraft)
      return reply.send(updatedDraft)
    } catch (error) {
      const errorMessage = getErrorMessage(error, "failed to update electric-propulsion GMAT draft")
      const answer = `Mission configuration error: ${errorMessage}`
      await appendElectricPropulsionDraftConversation(workspaceDir, req.params.draftId, { assistant: answer, user: message }).catch(() => undefined)
      await appendMissionConversation(workspaceDir, { answer, askedAt: new Date().toISOString(), channel: "gmat-draft", question: message }).catch(() => undefined)
      return reply.status(422).send({ error: errorMessage })
    }
  })
  fastify.post<{ Params: { draftId: string }; Body: DraftWorkspaceBody }>("/api/gmat/electric-propulsion-transfer/drafts/:draftId/confirm", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveOutputWorkspaceDir(root, req.body?.workspaceDir)
      const current = await loadElectricPropulsionDraft(workspaceDir, req.params.draftId)
      const authoritative = current.digitalThreadRequiredPaths?.length ? (await digitalThreadGmatSeed(draftDigitalThreadWorkspaceDir(workspaceDir, "electric-propulsion-transfer", current.draftId), "electric-propulsion-transfer")).values : undefined
      return reply.send(await confirmElectricPropulsionDraft(workspaceDir, req.params.draftId, authoritative))
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to confirm electric-propulsion GMAT draft") }) }
  })
  fastify.post<{ Params: { draftId: string }; Body: DraftWorkspaceBody }>("/api/gmat/electric-propulsion-transfer/drafts/:draftId/execute/events", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const sendEvent = (event: string, payload: unknown) => reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)
    reply.hijack()
    reply.raw.writeHead(200, { "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "Content-Type": "text/event-stream; charset=utf-8", "X-Accel-Buffering": "no" })
    // GMAT can integrate a finite electric burn for several minutes without
    // producing a report. Keep the SSE connection alive during that interval;
    // otherwise browsers/proxies can close an apparently idle request and leave
    // the Mission Studio UI permanently on "running".
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(": keep-alive\n\n")
    }, 15_000)
    try {
      const workspaceDir = resolveOutputWorkspaceDir(root, req.body?.workspaceDir)
      const currentDraft = await loadElectricPropulsionDraft(workspaceDir, req.params.draftId)
      const draft = currentDraft.digitalThreadRequiredPaths?.length
        ? await confirmElectricPropulsionDraft(workspaceDir, req.params.draftId, (await digitalThreadGmatSeed(draftDigitalThreadWorkspaceDir(workspaceDir, "electric-propulsion-transfer", req.params.draftId), "electric-propulsion-transfer")).values)
        : currentDraft
      const values = extractElectricPropulsionValues(await fs.readFile(defaultElectricPropulsionTemplatePath(), "utf8"))
      const digitalThreadSnapshot = await captureDigitalThreadSnapshot(draftDigitalThreadWorkspaceDir(workspaceDir, "electric-propulsion-transfer", draft.draftId))
      const result = await generateElectricPropulsionMission({ changes: draftToElectricPropulsionChanges(draft, values), execution: config.tools.gmat.bin ? { bin: config.tools.gmat.bin, timeoutMs: config.tools.gmat.timeoutMs } : undefined, onProgress: progress => sendEvent("progress", progress), request: `Confirmed GMAT electric-propulsion draft ${draft.draftId}`, workspaceDir })
      const runPath = await finalizeMissionRun({ digitalThreadSnapshot, draftConversation: draft.conversation, result: result.result, root, runDir: result.runDir, workspaceDir })
      await recordElectricPropulsionDraftRun(workspaceDir, draft.draftId, { changes: result.changes, completedAt: new Date().toISOString(), result: result.result, runId: result.runId, runPath })
      sendEvent("result", { ...result, draftId: draft.draftId, runPath })
    } catch (error) { sendEvent("error", { error: getErrorMessage(error, "failed to execute electric-propulsion GMAT draft") }) } finally {
      clearInterval(heartbeat)
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end()
    }
  })
  fastify.post<{ Body: AnalyzeBody }>("/api/gmat/electric-propulsion-transfer/analyze", async (req, reply) => {
    const question = typeof req.body?.question === "string" ? req.body.question.trim() : ""
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveRunDir(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!question) return reply.status(400).send({ error: "question must be a non-empty string" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      const workspaceDir = resolveOutputWorkspaceDir(root, req.body?.workspaceDir)
      const draftId = typeof req.body?.draftId === "string" ? req.body.draftId : ""
      const draft = draftId ? await loadElectricPropulsionDraft(workspaceDir, draftId) : null
      if (draft) await mergeMissionConversationIntoRun(workspaceDir, runDir, draft.conversation)
      const relatedRuns = draft?.runs ?? []
      return reply.send(await analyzeElectricPropulsionRunWithLlm({ connection: resolveModelBackend(config, "chatModel"), question, relatedRuns, runDir }))
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to analyze electric-propulsion GMAT run") }) }
  })
  fastify.get<{ Querystring: { runPath?: string } }>("/api/gmat/electric-propulsion-transfer/analyze/history", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const runDir = resolveRunDir(root, req.query.runPath)
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try { return reply.send({ conversation: await loadElectricPropulsionRunConversation(runDir) }) } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to read electric-propulsion GMAT run conversation") }) }
  })
  fastify.get<{ Querystring: { runPath?: string } }>("/api/gmat/electric-propulsion-transfer/timeseries", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const runDir = resolveRunDir(root, req.query.runPath)
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    const source = await fs.readFile(path.join(runDir, "electric_transfer_timeseries.json"), "utf8").catch(() => null)
    if (source === null) return reply.status(404).send({ error: "GMAT electric-transfer time series is not available for this run" })
    try {
      const samples: unknown = JSON.parse(source)
      if (!Array.isArray(samples)) throw new Error("invalid time series")
      return reply.send({ samples })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "invalid GMAT electric-transfer time series") }) }
  })
}
