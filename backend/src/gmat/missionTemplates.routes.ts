import fs from "node:fs/promises"
import path from "node:path"
import { createReadStream } from "node:fs"
import { parse } from "yaml"

import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import { adaptDigitalThreadToGmat, digitalThreadGmatSeed, syncDigitalThreadFromGmatDraft } from "../digitalThread/gmatDigitalThreadAdapter.js"
import { captureDigitalThreadSnapshot, draftDigitalThreadWorkspaceDir, isMissionRunWorkspace, loadOrCreateDigitalThread, syncSimuCicRequestToRunSnapshot } from "../digitalThread/digitalThreadStore.js"
import { appendMissionConversation } from "../digitalThread/missionConversationStore.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage } from "../shared/index.js"
import { artifactDefinitionForPath, contentTypeForArtifact, RUN_ARTIFACTS } from "../runs/artifactRegistry.js"
import { missionRunsDirectory } from "../runs/runWorkspace.js"
import { resolveMissionWorkspace } from "./missionWorkspace.js"
import { missionTemplateRuntime, type MissionTemplateDraft } from "./missionTemplateRuntime.js"
import { finalizeMissionRun } from "./missionRunLifecycle.js"
import { allGmatTemplateDefinitions, gmatTemplateDefinition, isGmatTemplateId, type GmatTemplateId } from "./templateRegistry.js"
import { listRunArtifactHistory } from "./artifactHistory.js"

type WorkspaceBody = { workspaceDir?: unknown }
type TemplateParams = { template: string }

const SATELLITE_OWNED_MISSION_PATHS = new Set([
  "spacecraft.dryMassKg", "spacecraft.dragCoefficient", "spacecraft.reflectivityCoefficient", "spacecraft.dragAreaM2", "spacecraft.srpAreaM2",
  "spacecraft.initialFuelMassKg", "propulsion.fuelMassKg", "propulsion.ispSeconds", "power.initialPowerKw", "power.initialMaxPowerKw",
  "power.annualDegradationPercent", "power.marginPercent", "power.systemMarginPercent", "power.busLoadKw", "power.minThrusterPowerKw", "power.maxThrusterPowerKw",
])
const EARTH_RADIUS_KM = 6378.1363

function normalizeMissionOrbitInput(fieldPath: string, value: string) {
  if (fieldPath !== "initialOrbit.altitudeKm" && fieldPath !== "targetOrbit.altitudeKm") return { fieldPath, value }
  const altitudeKm = Number(value)
  if (!Number.isFinite(altitudeKm)) throw new Error("orbit altitude must be a finite number")
  return {
    fieldPath: fieldPath === "initialOrbit.altitudeKm" ? "initialOrbit.smaKm" : "targetOrbit.smaKm",
    value: String(altitudeKm + EARTH_RADIUS_KM),
  }
}

function resolveTemplate(value: string): GmatTemplateId {
  if (!isGmatTemplateId(value)) throw new Error("unknown GMAT mission template")
  return value
}

function resolveWorkspace(root: string, candidate: unknown) {
  return resolveMissionWorkspace(root, candidate, { requireExplicitWorkspace: true, requireMissionRun: true, resolveRelativeToRoot: true })
}

/** The Files panel is also available before a dated planning run is selected.
 * In that state the client sends the workspace-version directory. */
function resolveHistoryRunsDir(root: string, candidate: unknown) {
  const workspaceDir = resolveMissionWorkspace(root, candidate, { requireExplicitWorkspace: true, resolveRelativeToRoot: true })
  return isMissionRunWorkspace(workspaceDir) ? path.dirname(workspaceDir) : missionRunsDirectory(workspaceDir)
}

/** Older Orbit Keeping drafts preserve a legacy internal templateId. The
 * generic API always exposes the canonical registered template ID. */
function presentDraft<T extends { templateId: string }>(draft: T, template: GmatTemplateId) {
  return { ...draft, templateId: template }
}

async function runManifestTemplate(workspaceDir: string) {
  const manifest = await fs.readFile(path.join(workspaceDir, "run_manifest.json"), "utf8").then(source => JSON.parse(source) as { templateId?: unknown }).catch(() => null)
  return typeof manifest?.templateId === "string" ? manifest.templateId : null
}

/**
 * The first Mission Studio implementation wrote a GMAT script directly in a
 * dated run directory, before `run_manifest.json` existed.  Those runs are
 * still valid engineering artifacts and must remain visible.  A legacy run
 * belongs to a scenario only when it contains that scenario's declared GMAT
 * script (or its reference-script basename); we never guess from a report or
 * an OEM filename, because those names are shared by several scenarios.
 */
async function legacyRunMatchesTemplate(workspaceDir: string, template: GmatTemplateId) {
  const definition = gmatTemplateDefinition(template)
  const scriptNames = new Set([
    path.basename(definition.gmatReferenceScript).toLocaleLowerCase(),
    ...definition.artifacts
      .filter(artifact => artifact.kind === "script")
      .map(artifact => path.basename(artifact.path).toLocaleLowerCase()),
  ])
  const entries = await fs.readdir(workspaceDir, { withFileTypes: true }).catch(() => [])
  return entries.some(entry => entry.isFile() && scriptNames.has(entry.name.toLocaleLowerCase()))
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
  const manifestTemplate = await runManifestTemplate(workspaceDir)
  // New runs are authoritative through their manifest.  Only runs created
  // before manifests are eligible for the narrow legacy-script fallback.
  if (manifestTemplate ? manifestTemplate !== template : !await legacyRunMatchesTemplate(workspaceDir, template)) return []
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
async function listTemplateHistory(root: string, runsDir: string, template: GmatTemplateId) {
  const results: Array<Awaited<ReturnType<typeof listTemplateArtifacts>>[number] & { historical?: boolean }> = []
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
      const runsDir = resolveHistoryRunsDir(root, req.query.workspaceDir)
      return reply.send({ files: await listTemplateHistory(root, runsDir, template) })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to list GMAT template artifacts") }) }
  })

  fastify.get<{ Params: TemplateParams; Querystring: { relativePath?: string; workspaceDir?: string } }>("/api/gmat/templates/:template/files/download", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const template = resolveTemplate(req.params.template)
      const runsDir = resolveHistoryRunsDir(root, req.query.workspaceDir)
      const requestedPath = typeof req.query.relativePath === "string" ? req.query.relativePath : ""
      // Authorize downloads against the exact inventory returned by the Files
      // panel. This works for both current and versioned historical artifacts
      // without trusting a client-provided filesystem path.
      const declared = (await listTemplateHistory(root, runsDir, template)).find(file => file.relativePath === requestedPath)
      const candidate = declared ? path.resolve(root, declared.relativePath) : ""
      const stat = candidate ? await fs.stat(candidate).catch(() => null) : null
      if (!declared || !stat?.isFile()) return reply.status(404).send({ error: "GMAT template artifact not found" })
      const contentType = contentTypeForArtifact(declared.kind)
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
      // Drafts are durable from the first entered field. Hiding incomplete
      // drafts makes the frontend lose its active editing aggregate after a
      // refresh and was the root cause of values apparently disappearing.
      return reply.send({ drafts: drafts.filter((draft): draft is NonNullable<typeof draft> => draft !== null).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).map(draft => presentDraft(draft, template)) })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to list GMAT mission drafts") }) }
  })

  fastify.get<{ Params: TemplateParams & { draftId: string }; Querystring: { workspaceDir?: string } }>("/api/gmat/templates/:template/drafts/:draftId", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const template = resolveTemplate(req.params.template)
      const workspaceDir = resolveWorkspace(root, req.query.workspaceDir)
      const draft = await missionTemplateRuntime(template).load(workspaceDir, req.params.draftId)
      // Loading a legacy draft is also its migration point.  Earlier
      // declarative scenarios could save draft.json but fail while writing a
      // missing parameters.targetOrbit object, leaving satellite.json empty.
      // Reapply the complete draft atomically now that the digital-thread
      // shape is guaranteed by initialize/load.
      await syncDigitalThreadFromGmatDraft(draftDigitalThreadWorkspaceDir(workspaceDir, template, draft.draftId), draft)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      return reply.send(presentDraft(draft, template))
    }
    catch (error) { return reply.status(404).send({ error: getErrorMessage(error, "GMAT mission draft not found") }) }
  })

  fastify.patch<{ Params: TemplateParams & { draftId: string }; Body: WorkspaceBody & { path?: unknown; value?: unknown } }>("/api/gmat/templates/:template/drafts/:draftId/values", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    let fieldPath = typeof req.body?.path === "string" ? req.body.path : ""
    let value = typeof req.body?.value === "string" || typeof req.body?.value === "number" ? String(req.body.value) : ""
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!fieldPath || !value.trim()) return reply.status(400).send({ error: "path and value are required" })
    if (SATELLITE_OWNED_MISSION_PATHS.has(fieldPath)) return reply.status(403).send({ error: "satellite-owned parameters are read from satellite.json and cannot be edited in Mission Studio" })
    try { ({ fieldPath, value } = normalizeMissionOrbitInput(fieldPath, value)) }
    catch (error) { return reply.status(400).send({ error: getErrorMessage(error, "invalid mission orbit value") }) }
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
      const digitalThreadSnapshot = await captureDigitalThreadSnapshot(draftDigitalThreadWorkspaceDir(workspaceDir, template, draft.draftId))
      const execution = await runtime.execute({ connection: resolveModelBackend(config, "chatModel"), draft, execution: config.tools.gmat.bin ? { bin: config.tools.gmat.bin, timeoutMs: config.tools.gmat.timeoutMs } : undefined, workspaceDir })
      const runPath = await finalizeMissionRun({ digitalThreadSnapshot, draftConversation: (draft as { conversation?: Array<{ assistant: string; user: string }> }).conversation ?? [], result: execution.result, root, runDir: execution.runDir, workspaceDir })
      // The attitude target is a downstream mission input, selected in the
      // planning satellite.json before GMAT. Copy it after finalization so the
      // completed run snapshot is the one Simu-CIC reads.
      await syncSimuCicRequestToRunSnapshot(execution.runDir, await loadOrCreateDigitalThread(workspaceDir))
      const recordedDraft = await runtime.recordRun({ draft, execution, runPath, workspaceDir })
      return reply.send({ ...execution, draft: presentDraft(recordedDraft, template), runPath })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to execute GMAT mission draft") }) }
  })
}
