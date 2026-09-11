import path from "node:path"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"

import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage } from "../shared/index.js"
import { adaptDigitalThreadToGmat, syncDigitalThreadFromGmatDraft } from "../digitalThread/gmatDigitalThreadAdapter.js"
import { captureDigitalThreadSnapshot, draftDigitalThreadWorkspaceDir, loadOrCreateDigitalThread } from "../digitalThread/digitalThreadStore.js"
import { appendMissionConversation } from "../digitalThread/missionConversationStore.js"
import { appendChemicalHohmannDraftConversation, confirmChemicalHohmannDraft, createChemicalHohmannDraft, discussChemicalHohmannDraft, loadChemicalHohmannDraft, recordChemicalHohmannDraftRun } from "./chemicalHohmannDraft.js"
import { generateChemicalHohmannMission, snapshotChemicalHohmannExecution } from "./chemicalHohmann.service.js"
import { resolveMissionWorkspace } from "./missionWorkspace.js"
import { listRunArtifactHistory } from "./artifactHistory.js"
import { finalizeMissionRun } from "./missionRunLifecycle.js"

type WorkspaceBody = { workspaceDir?: unknown }
type ChemicalHohmannFileKind = "digital-thread" | "ephemeris" | "log" | "manifest" | "opalis" | "report" | "result" | "rf-comlink" | "script" | "simu-cic" | "timeseries" | "values"
const CHEMICAL_HOHMANN_ARTIFACT_KINDS: Record<string, ChemicalHohmannFileKind> = {
  "EphemerisFile1.oem": "ephemeris",
  "ReportFile1.txt": "report",
  "chemical_hohmann_timeseries.json": "timeseries",
  "chemical_hohmann_transfer.script": "script",
  "chemical_hohmann_transfer.values.yaml": "values",
  "gmat.log": "log",
  "gmat_result.json": "result",
  "run-analysis-context.json": "result",
  "run_manifest.json": "manifest",
  "satellite.json": "digital-thread",
  "opalis/01-conversion_vers_SIMU-CIC/EphemerisFile1_SIMU.txt": "simu-cic",
  "opalis/02-simu-cic/simucic.definition.json": "simu-cic",
  "opalis/03-opalis/02-resultats/calculated-opalis.opalis": "opalis",
  "opalis/03-opalis/02-resultats/calculated-opalis.json": "opalis",
  "rf-comlink/01-input/rf-comlink-inputs.json": "rf-comlink",
  "rf-comlink/02-scenario/prepared-rf-comlink.rfcl": "rf-comlink",
  "rf-comlink/03-results/calculated-rf-comlink.rfcl": "rf-comlink",
  "rf-comlink/03-results/rf-comlink-results.json": "rf-comlink",
  "rf-comlink/03-results/rf-comlink-calculation.log": "rf-comlink",
}

function chemicalHohmannArtifactKind(relativeFile: string, historical = false) {
  if (CHEMICAL_HOHMANN_ARTIFACT_KINDS[relativeFile]) return CHEMICAL_HOHMANN_ARTIFACT_KINDS[relativeFile]
  if (!historical) return undefined
  return Object.entries(CHEMICAL_HOHMANN_ARTIFACT_KINDS).find(([known]) => path.basename(known) === path.basename(relativeFile))?.[1]
}

function resolveWorkspace(root: string, candidate: unknown) {
  return resolveMissionWorkspace(root, candidate, { requireExplicitWorkspace: true, requireMissionRun: true })
}

async function listChemicalHohmannFiles(root: string, workspaceDir: string) {
  const files: Array<{ artifactId: string; fileName: string; historical?: boolean; kind: ChemicalHohmannFileKind; mtimeMs: number; relativePath: string; runPath: string; size: number }> = (await Promise.all(Object.entries(CHEMICAL_HOHMANN_ARTIFACT_KINDS).map(async ([relativeFile, kind]) => {
    const filePath = path.join(workspaceDir, relativeFile)
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile()) return null
    return { artifactId: path.basename(workspaceDir), fileName: path.basename(relativeFile), kind, mtimeMs: stat.mtimeMs, relativePath: path.relative(path.resolve(root), filePath), runPath: path.relative(path.resolve(root), workspaceDir), size: stat.size }
  }))).filter((file): file is NonNullable<typeof file> => file !== null)
  for (const artifact of await listRunArtifactHistory(workspaceDir)) {
    const kind = chemicalHohmannArtifactKind(artifact.filePath, true)
    if (!kind) continue
    const versionDir = path.join(workspaceDir, "artifact-history", artifact.stage, artifact.version)
    const stat = await fs.stat(artifact.filePath)
    files.push({ artifactId: `${artifact.stage} · ${artifact.version}`, fileName: path.basename(artifact.filePath), historical: true, kind, mtimeMs: stat.mtimeMs, relativePath: path.relative(path.resolve(root), artifact.filePath), runPath: path.relative(path.resolve(root), versionDir), size: stat.size })
  }
  return files.filter((file): file is NonNullable<typeof file> => file !== null).sort((left, right) => right.mtimeMs - left.mtimeMs)
}

function resolveChemicalHohmannFile(root: string, workspaceDir: string, relativePath: unknown) {
  if (typeof relativePath !== "string" || !relativePath.trim()) return null
  const filePath = path.resolve(root, relativePath)
  const relativeFile = path.relative(path.resolve(workspaceDir), filePath).split(path.sep).join("/")
  const segments = relativeFile.split("/")
  const historyIndex = segments.indexOf("artifact-history")
  const historicalArtifact = historyIndex >= 0 && segments.length > historyIndex + 3 && /^[A-Za-z0-9_-]+$/u.test(segments[historyIndex + 1]) && /^[-A-Za-z0-9_]+$/u.test(segments[historyIndex + 2]) && chemicalHohmannArtifactKind(relativeFile, true)
  return !relativeFile.startsWith("../") && (chemicalHohmannArtifactKind(relativeFile) || historicalArtifact) ? filePath : null
}

/** Deterministic API boundary for the chemical Hohmann GMAT template. */
export async function chemicalHohmannRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.get<{ Querystring: { workspaceDir?: string } }>("/api/gmat/chemical-hohmann-transfer/files", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try { return reply.send({ files: await listChemicalHohmannFiles(root, resolveWorkspace(root, req.query.workspaceDir)) }) } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to list chemical Hohmann GMAT files") }) }
  })

  fastify.get<{ Querystring: { relativePath?: string; workspaceDir?: string } }>("/api/gmat/chemical-hohmann-transfer/files/download", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveWorkspace(root, req.query.workspaceDir)
      const filePath = resolveChemicalHohmannFile(root, workspaceDir, req.query.relativePath)
      const stat = filePath ? await fs.stat(filePath).catch(() => null) : null
      if (!filePath || !stat?.isFile()) return reply.status(404).send({ error: "chemical Hohmann GMAT artifact not found" })
      const relativeFile = path.relative(workspaceDir, filePath).split(path.sep).join("/")
      const kind = chemicalHohmannArtifactKind(relativeFile, relativeFile.startsWith("artifact-history/"))
      const contentType = kind === "values" ? "application/x-yaml; charset=utf-8" : ["digital-thread", "manifest", "result", "timeseries"].includes(kind ?? "") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8"
      return reply.header("Content-Type", contentType).header("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`).header("Content-Length", String(stat.size)).send(createReadStream(filePath))
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to download chemical Hohmann GMAT artifact") }) }
  })

  fastify.post<{ Body: WorkspaceBody }>("/api/gmat/chemical-hohmann-transfer/drafts", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const adapted = adaptDigitalThreadToGmat(await loadOrCreateDigitalThread(workspaceDir), "chemical-hohmann-transfer")
      const propulsionGuard = adapted.guards.find(guard => guard.code === "incompatible_propulsion")
      if (propulsionGuard) throw new Error(propulsionGuard.message)
      const draft = await createChemicalHohmannDraft(workspaceDir, adapted.values, adapted.requiredDraftPaths)
      await syncDigitalThreadFromGmatDraft(draftDigitalThreadWorkspaceDir(workspaceDir, "chemical-hohmann-transfer", draft.draftId), draft)
      return reply.send(draft)
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to create chemical Hohmann draft") }) }
  })

  fastify.get<{ Querystring: { workspaceDir?: string } }>("/api/gmat/chemical-hohmann-transfer/drafts", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveWorkspace(root, req.query.workspaceDir)
      const draftsDir = path.join(workspaceDir, "gmat", "chemical-hohmann-transfer", "drafts")
      const entries = await fs.readdir(draftsDir, { withFileTypes: true }).catch(() => [])
      const drafts = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => loadChemicalHohmannDraft(workspaceDir, entry.name).catch(() => null)))
      return reply.send({ drafts: drafts.filter((draft): draft is NonNullable<typeof draft> => draft !== null).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)) })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to list chemical Hohmann GMAT drafts") }) }
  })

  fastify.get<{ Params: { draftId: string }; Querystring: { workspaceDir?: string } }>("/api/gmat/chemical-hohmann-transfer/drafts/:draftId", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try { return reply.send(await loadChemicalHohmannDraft(resolveWorkspace(root, req.query.workspaceDir), req.params.draftId)) } catch (error) { return reply.status(404).send({ error: getErrorMessage(error, "chemical Hohmann draft not found") }) }
  })

  fastify.post<{ Params: { draftId: string }; Body: WorkspaceBody & { message?: unknown } }>("/api/gmat/chemical-hohmann-transfer/drafts/:draftId/messages", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!message) return reply.status(400).send({ error: "message must be a non-empty string" })
    let workspaceDir = ""
    try {
      workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const draft = await discussChemicalHohmannDraft({ connection: resolveModelBackend(config, "chatModel"), draft: await loadChemicalHohmannDraft(workspaceDir, req.params.draftId), message, workspaceDir })
      await syncDigitalThreadFromGmatDraft(draftDigitalThreadWorkspaceDir(workspaceDir, "chemical-hohmann-transfer", draft.draftId), draft)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      await appendMissionConversation(workspaceDir, { answer: draft.assistantMessage ?? "Mission draft updated.", askedAt: draft.updatedAt, channel: "gmat-draft", question: message })
      return reply.send(draft)
    } catch (error) {
      const errorMessage = getErrorMessage(error, "failed to update chemical Hohmann GMAT draft")
      if (workspaceDir) await appendChemicalHohmannDraftConversation(workspaceDir, req.params.draftId, { assistant: `Mission configuration error: ${errorMessage}`, user: message }).catch(() => undefined)
      return reply.status(422).send({ error: errorMessage })
    }
  })

  fastify.post<{ Params: { draftId: string }; Body: WorkspaceBody }>("/api/gmat/chemical-hohmann-transfer/drafts/:draftId/confirm", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const draft = await confirmChemicalHohmannDraft(workspaceDir, req.params.draftId)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      return reply.send(draft)
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to confirm chemical Hohmann draft") }) }
  })

  fastify.post<{ Params: { draftId: string }; Body: WorkspaceBody }>("/api/gmat/chemical-hohmann-transfer/drafts/:draftId/execute", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const draft = await confirmChemicalHohmannDraft(workspaceDir, req.params.draftId)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      const digitalThreadSnapshot = await captureDigitalThreadSnapshot(draftDigitalThreadWorkspaceDir(workspaceDir, "chemical-hohmann-transfer", draft.draftId))
      const result = await generateChemicalHohmannMission({ draft, workspaceDir, execution: config.tools.gmat.bin ? { bin: config.tools.gmat.bin, timeoutMs: config.tools.gmat.timeoutMs } : undefined })
      await finalizeMissionRun({ digitalThreadSnapshot, draftConversation: draft.conversation, result: result.result, root, runDir: result.runDir, workspaceDir })
      const snapshotDir = await snapshotChemicalHohmannExecution(result.runDir)
      if (!snapshotDir) throw new Error("chemical Hohmann execution did not produce artifacts to preserve")
      const snapshotPath = path.relative(workspaceDir, snapshotDir).split(path.sep).join("/")
      const recordedDraft = await recordChemicalHohmannDraftRun(workspaceDir, draft.draftId, { completedAt: new Date().toISOString(), result: result.result, runId: path.basename(snapshotDir), runPath: snapshotPath })
      return reply.send({ ...result, draft: recordedDraft, runPath: path.relative(path.resolve(root), result.runDir) })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to execute chemical Hohmann GMAT draft") }) }
  })
}
