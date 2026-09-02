import fs from "node:fs/promises"
import path from "node:path"
import { createReadStream } from "node:fs"
import { parse } from "yaml"

import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import { adaptDigitalThreadToGmat, digitalThreadGmatSeed, syncDigitalThreadFromGmatDraft } from "../digitalThread/gmatDigitalThreadAdapter.js"
import { captureDigitalThreadSnapshot, draftDigitalThreadWorkspaceDir, loadOrCreateDigitalThread, syncMissionAnalysisRequestsToDraft } from "../digitalThread/digitalThreadStore.js"
import { appendMissionConversation } from "../digitalThread/missionConversationStore.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage } from "../shared/index.js"
import { artifactDefinitionForPath, contentTypeForArtifact, RUN_ARTIFACTS } from "../runs/artifactRegistry.js"
import { missionRunsDirectory } from "../runs/runWorkspace.js"
import { startMissionPipeline } from "../runs/missionPipeline.routes.js"
import { resolveMissionWorkspace } from "./missionWorkspace.js"
import { missionTemplateRuntime, type MissionTemplateDraft } from "./missionTemplateRuntime.js"
import { finalizeMissionRun } from "./missionRunLifecycle.js"
import { allGmatTemplateDefinitions, gmatTemplateDefinition, isGmatTemplateId, type GmatTemplateId } from "./templateRegistry.js"
import { listRunArtifactHistory } from "./artifactHistory.js"

type WorkspaceBody = { workspaceDir?: unknown }
type TemplateParams = { template: string }

function resolveTemplate(value: string): GmatTemplateId {
  if (!isGmatTemplateId(value)) throw new Error("unknown GMAT mission template")
  return value
}

function resolveWorkspace(root: string, candidate: unknown) {
  return resolveMissionWorkspace(root, candidate, { requireExplicitWorkspace: true, requireMissionRun: true, resolveRelativeToRoot: true })
}

/** Older Orbit Keeping drafts preserve a legacy internal templateId. The
 * generic API always exposes the canonical registered template ID. */
function presentDraft<T extends { templateId: string }>(draft: T, template: GmatTemplateId) {
  return { ...draft, templateId: template }
}

function hasRecordedRun(draft: MissionTemplateDraft) {
  const runs = (draft as MissionTemplateDraft & { runs?: unknown }).runs
  return Array.isArray(runs) && runs.length > 0
}

async function runManifestTemplate(workspaceDir: string) {
  const manifest = await fs.readFile(path.join(workspaceDir, "run_manifest.json"), "utf8").then(source => JSON.parse(source) as { templateId?: unknown }).catch(() => null)
  return typeof manifest?.templateId === "string" ? manifest.templateId : null
}

async function runDraftId(workspaceDir: string, template: GmatTemplateId) {
  const valuesArtifact = gmatTemplateDefinition(template).artifacts.find(artifact => artifact.kind === "values")
  if (!valuesArtifact) return undefined
  const document = await fs.readFile(path.join(workspaceDir, valuesArtifact.path), "utf8").then(source => parse(source) as { draft_id?: unknown }).catch(() => null)
  return typeof document?.draft_id === "string" ? document.draft_id : undefined
}

type ListedArtifactDefinition = { contentType?: string; kind: string; path: string; primary?: boolean }

/** Combines template-specific GMAT outputs with the shared downstream-tool
 * registry. This prevents each template route from owning another copy of the
 * OPALIS, Simu-CIC and RF-COMLINK file inventory. */
function artifactsForTemplate(template: GmatTemplateId): ListedArtifactDefinition[] {
  const artifacts = new Map<string, ListedArtifactDefinition>()
  for (const artifact of RUN_ARTIFACTS) artifacts.set(artifact.relativePath, {
    contentType: artifact.contentType,
    kind: artifact.kind,
    path: artifact.relativePath,
    ...("primary" in artifact && artifact.primary ? { primary: true } : {}),
  })
  for (const artifact of gmatTemplateDefinition(template).artifacts) artifacts.set(artifact.path, artifact)
  return [...artifacts.values()]
}

async function listTemplateArtifacts(root: string, workspaceDir: string, template: GmatTemplateId) {
  if (await runManifestTemplate(workspaceDir) !== template) return []
  const draftId = await runDraftId(workspaceDir, template)
  const runPath = path.relative(path.resolve(root), workspaceDir).split(path.sep).join("/")
  const files = await Promise.all(artifactsForTemplate(template).map(async artifact => {
    const filePath = path.join(workspaceDir, ...artifact.path.split("/"))
    const stat = await fs.stat(filePath).catch(() => null)
    if (!stat?.isFile()) return null
    return {
      artifactId: path.basename(workspaceDir),
      ...(draftId ? { draftId } : {}),
      fileName: path.basename(filePath),
      kind: artifact.kind,
      mtimeMs: stat.mtimeMs,
      primary: artifact.primary,
      relativePath: path.relative(path.resolve(root), filePath).split(path.sep).join("/"),
      runPath,
      size: stat.size,
    }
  }))
  const generatedScenarioDir = path.join(workspaceDir, "opalis", "02-simu-cic", "01-execution-complete")
  const generatedScenarios = await Promise.all((await fs.readdir(generatedScenarioDir, { withFileTypes: true }).catch(() => [])).flatMap(async entry => {
    if (!entry.isFile()) return []
    const relativePath = `opalis/02-simu-cic/01-execution-complete/${entry.name}`
    const definition = artifactDefinitionForPath(relativePath)
    if (!definition) return []
    const filePath = path.join(generatedScenarioDir, entry.name)
    const stat = await fs.stat(filePath)
    return [{ artifactId: path.basename(workspaceDir), ...(draftId ? { draftId } : {}), fileName: entry.name, kind: definition.kind, mtimeMs: stat.mtimeMs, primary: definition.primary, relativePath: path.relative(path.resolve(root), filePath).split(path.sep).join("/"), runPath, size: stat.size }]
  }))
  return [...files.filter((file): file is NonNullable<typeof file> => file !== null), ...generatedScenarios.flat()].sort((left, right) => right.mtimeMs - left.mtimeMs)
}

/** Mission runs are stored in the user's canonical GMAT run directory.  Do not
 * recursively scan the entire workspace here: that makes the Files view time
 * out as historic runs accumulate. */
async function listTemplateHistory(root: string, template: GmatTemplateId) {
  const results: Array<Awaited<ReturnType<typeof listTemplateArtifacts>>[number] & { historical?: boolean }> = []
  const runsDir = missionRunsDirectory(root)
  const runs = await fs.readdir(runsDir, { withFileTypes: true }).catch(() => [])
  for (const run of runs.filter(candidate => candidate.isDirectory())) {
    const runDir = path.join(runsDir, run.name)
    results.push(...await listTemplateArtifacts(root, runDir, template))
    for (const artifact of await listRunArtifactHistory(runDir)) {
      const versionDir = path.join(runDir, "artifact-history", artifact.stage, artifact.version)
      const relativeToRun = path.relative(versionDir, artifact.filePath).split(path.sep).join("/")
      const declared = artifactsForTemplate(template).find(candidate => candidate.path === relativeToRun) ?? artifactDefinitionForPath(relativeToRun)
      const stat = declared ? await fs.stat(artifact.filePath).catch(() => null) : null
      if (declared && stat?.isFile()) results.push({ artifactId: `${run.name} · ${artifact.version}`, fileName: path.basename(artifact.filePath), historical: true, kind: declared.kind, mtimeMs: stat.mtimeMs, primary: declared.primary, relativePath: path.relative(path.resolve(root), artifact.filePath).split(path.sep).join("/"), runPath: path.relative(path.resolve(root), versionDir).split(path.sep).join("/"), size: stat.size })
    }
  }
  return results.sort((left, right) => right.mtimeMs - left.mtimeMs)
}

/** Generic HTTP lifecycle for all GMAT mission templates. Template-specific
 * modules only implement engineering rules through missionTemplateRuntime. */
export async function missionTemplatesRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.get("/api/gmat/templates", async () => ({
    templates: allGmatTemplateDefinitions().map(({ skillDirectory: _skillDirectory, ...template }) => template),
  }))

  fastify.get<{ Params: TemplateParams; Querystring: { workspaceDir?: string } }>("/api/gmat/templates/:template/files", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const template = resolveTemplate(req.params.template)
      return reply.send({ files: await listTemplateHistory(root, template) })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to list GMAT template artifacts") }) }
  })

  fastify.get<{ Params: TemplateParams; Querystring: { relativePath?: string; workspaceDir?: string } }>("/api/gmat/templates/:template/files/download", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const template = resolveTemplate(req.params.template)
      const workspaceDir = resolveWorkspace(root, req.query.workspaceDir)
      if (await runManifestTemplate(workspaceDir) !== template) return reply.status(404).send({ error: "GMAT template artifact not found" })
      const candidate = typeof req.query.relativePath === "string" ? path.resolve(root, req.query.relativePath) : ""
      const relativeToWorkspace = candidate ? path.relative(workspaceDir, candidate).split(path.sep).join("/") : ""
      const declared = artifactsForTemplate(template).find(artifact => artifact.path === relativeToWorkspace) ?? artifactDefinitionForPath(relativeToWorkspace)
      const stat = candidate && declared ? await fs.stat(candidate).catch(() => null) : null
      if (!declared || !stat?.isFile()) return reply.status(404).send({ error: "GMAT template artifact not found" })
      const contentType = declared.contentType ?? contentTypeForArtifact(declared.kind)
      return reply.header("Content-Type", contentType).header("Content-Disposition", `attachment; filename="${path.basename(candidate)}"`).header("Content-Length", String(stat.size)).send(createReadStream(candidate))
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to download GMAT template artifact") }) }
  })

  fastify.post<{ Params: TemplateParams; Body: WorkspaceBody }>("/api/gmat/templates/:template/drafts", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const template = resolveTemplate(req.params.template)
      const workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const adapted = adaptDigitalThreadToGmat(await loadOrCreateDigitalThread(workspaceDir), template)
      const guard = adapted.guards.find(item => item.code === "incompatible_propulsion")
      if (guard) throw new Error(guard.message)
      const draft = await missionTemplateRuntime(template).create(workspaceDir, adapted.values, adapted.requiredDraftPaths)
      await syncDigitalThreadFromGmatDraft(draftDigitalThreadWorkspaceDir(workspaceDir, template, draft.draftId), draft)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      return reply.send(presentDraft(draft, template))
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to create GMAT mission draft") }) }
  })

  fastify.get<{ Params: TemplateParams; Querystring: { workspaceDir?: string } }>("/api/gmat/templates/:template/drafts", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const template = resolveTemplate(req.params.template)
      const workspaceDir = resolveWorkspace(root, req.query.workspaceDir)
      const draftsDir = path.join(workspaceDir, ...gmatTemplateDefinition(template).draftDirectory)
      const entries = await fs.readdir(draftsDir, { withFileTypes: true }).catch(() => [])
      const runtime = missionTemplateRuntime(template)
      const drafts = await Promise.all(entries.filter(entry => entry.isDirectory()).map(entry => runtime.load(workspaceDir, entry.name).catch(() => null)))
      // A draft is only durable user-facing history once it produced a GMAT
      // execution. Incomplete forms are implementation state, not runs to
      // restore after a page reload.
      return reply.send({ drafts: drafts.filter((draft): draft is NonNullable<typeof draft> => draft !== null && hasRecordedRun(draft)).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(draft => presentDraft(draft, template)) })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to list GMAT mission drafts") }) }
  })

  fastify.get<{ Params: TemplateParams & { draftId: string }; Querystring: { workspaceDir?: string } }>("/api/gmat/templates/:template/drafts/:draftId", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const template = resolveTemplate(req.params.template)
      return reply.send(presentDraft(await missionTemplateRuntime(template).load(resolveWorkspace(root, req.query.workspaceDir), req.params.draftId), template))
    }
    catch (error) { return reply.status(404).send({ error: getErrorMessage(error, "GMAT mission draft not found") }) }
  })

  fastify.patch<{ Params: TemplateParams & { draftId: string }; Body: WorkspaceBody & { path?: unknown; value?: unknown } }>("/api/gmat/templates/:template/drafts/:draftId/values", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const fieldPath = typeof req.body?.path === "string" ? req.body.path : ""
    const value = typeof req.body?.value === "string" || typeof req.body?.value === "number" ? String(req.body.value) : ""
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!fieldPath || !value.trim()) return reply.status(400).send({ error: "path and value are required" })
    try {
      const template = resolveTemplate(req.params.template)
      const workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const runtime = missionTemplateRuntime(template)
      const draft = await runtime.setValue(workspaceDir, await runtime.load(workspaceDir, req.params.draftId), fieldPath, value)
      await syncDigitalThreadFromGmatDraft(draftDigitalThreadWorkspaceDir(workspaceDir, template, draft.draftId), draft)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      return reply.send(presentDraft(draft, template))
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to update GMAT mission value") }) }
  })

  fastify.post<{ Params: TemplateParams & { draftId: string }; Body: WorkspaceBody & { message?: unknown } }>("/api/gmat/templates/:template/drafts/:draftId/messages", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!message) return reply.status(400).send({ error: "message must be a non-empty string" })
    try {
      const template = resolveTemplate(req.params.template)
      const workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const runtime = missionTemplateRuntime(template)
      const draft = await runtime.discuss({ connection: resolveModelBackend(config, "chatModel"), draft: await runtime.load(workspaceDir, req.params.draftId), message, workspaceDir })
      await syncDigitalThreadFromGmatDraft(draftDigitalThreadWorkspaceDir(workspaceDir, template, draft.draftId), draft)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      await appendMissionConversation(workspaceDir, { answer: (draft as { assistantMessage?: string }).assistantMessage ?? "Mission draft updated.", askedAt: draft.updatedAt, channel: "gmat-draft", question: message })
      return reply.send(presentDraft(draft, template))
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to update GMAT mission draft") }) }
  })

  fastify.post<{ Params: TemplateParams & { draftId: string }; Body: WorkspaceBody }>("/api/gmat/templates/:template/drafts/:draftId/confirm", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const template = resolveTemplate(req.params.template)
      const workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const runtime = missionTemplateRuntime(template)
      const current = await runtime.load(workspaceDir, req.params.draftId)
      const requiredPaths = (current as { digitalThreadRequiredPaths?: unknown }).digitalThreadRequiredPaths
      const authoritative = Array.isArray(requiredPaths) && requiredPaths.length
        ? (await digitalThreadGmatSeed(draftDigitalThreadWorkspaceDir(workspaceDir, template, current.draftId), template)).values
        : undefined
      const draft = await runtime.confirm(workspaceDir, req.params.draftId, authoritative)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      return reply.send(presentDraft(draft, template))
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to confirm GMAT mission draft") }) }
  })

  fastify.post<{ Params: TemplateParams & { draftId: string }; Body: WorkspaceBody }>("/api/gmat/templates/:template/drafts/:draftId/execute", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const template = resolveTemplate(req.params.template)
      const workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const runtime = missionTemplateRuntime(template)
      const draft = await runtime.load(workspaceDir, req.params.draftId)
      if (!draft.confirmed) throw new Error("confirm the GMAT mission draft before execution")
      const draftWorkspaceDir = draftDigitalThreadWorkspaceDir(workspaceDir, template, draft.draftId)
      await syncMissionAnalysisRequestsToDraft(workspaceDir, draftWorkspaceDir)
      const digitalThreadSnapshot = await captureDigitalThreadSnapshot(draftWorkspaceDir)
      const execution = await runtime.execute({ connection: resolveModelBackend(config, "chatModel"), draft, execution: config.tools.gmat.bin ? { bin: config.tools.gmat.bin, timeoutMs: config.tools.gmat.timeoutMs } : undefined, workspaceDir })
      const runPath = await finalizeMissionRun({ digitalThreadSnapshot, draftConversation: (draft as { conversation?: Array<{ assistant: string; user: string }> }).conversation ?? [], result: execution.result, root, runDir: execution.runDir, workspaceDir })
      const recordedDraft = await runtime.recordRun({ draft, execution, runPath, workspaceDir })
      return reply.send({ ...execution, draft: presentDraft(recordedDraft, template), runPath })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to execute GMAT mission draft") }) }
  })

  /** Executes any mission scenario and immediately hands its immutable run to
   * the shared Simu-CIC → (OPALIS || RF-COMLINK) pipeline. */
  fastify.post<{ Params: TemplateParams & { draftId: string }; Body: WorkspaceBody }>("/api/gmat/templates/:template/drafts/:draftId/run-full-pipeline", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const template = resolveTemplate(req.params.template)
      const workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const runtime = missionTemplateRuntime(template)
      const current = await runtime.load(workspaceDir, req.params.draftId)
      const requiredPaths = (current as { digitalThreadRequiredPaths?: unknown }).digitalThreadRequiredPaths
      const authoritative = Array.isArray(requiredPaths) && requiredPaths.length
        ? (await digitalThreadGmatSeed(draftDigitalThreadWorkspaceDir(workspaceDir, template, current.draftId), template)).values
        : undefined
      const draft = current.confirmed ? current : await runtime.confirm(workspaceDir, current.draftId, authoritative)
      if (draft.missing.length) throw new Error(`complete the mission scenario before starting the full pipeline: ${draft.missing.join(", ")}`)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      const draftWorkspaceDir = draftDigitalThreadWorkspaceDir(workspaceDir, template, draft.draftId)
      await syncMissionAnalysisRequestsToDraft(workspaceDir, draftWorkspaceDir)
      const digitalThreadSnapshot = await captureDigitalThreadSnapshot(draftWorkspaceDir)
      const execution = await runtime.execute({ connection: resolveModelBackend(config, "chatModel"), draft, execution: config.tools.gmat.bin ? { bin: config.tools.gmat.bin, timeoutMs: config.tools.gmat.timeoutMs } : undefined, workspaceDir })
      if (execution.result.status !== "completed") throw new Error(execution.result.error || `GMAT ended with status ${execution.result.status}`)
      const runPath = await finalizeMissionRun({ digitalThreadSnapshot, draftConversation: (draft as { conversation?: Array<{ assistant: string; user: string }> }).conversation ?? [], result: execution.result, root, runDir: execution.runDir, workspaceDir })
      const recordedDraft = await runtime.recordRun({ draft, execution, runPath, workspaceDir })
      // execution.runDir has just been created and finalized above. Hand it to
      // the orchestrator directly: re-resolving it through an internal HTTP
      // request was the source of the 400 returned after a successful GMAT run.
      const pipelineRunPath = runPath.split(path.sep).join("/")
      const workflow = await startMissionPipeline({ fastify, headers: req.headers, root, runDir: execution.runDir, runPath: pipelineRunPath })
      return reply.code(202).send({ execution, draft: presentDraft(recordedDraft, template), pipeline: { ok: true, workflow }, runPath: pipelineRunPath })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to run full mission pipeline") }) }
  })
}
