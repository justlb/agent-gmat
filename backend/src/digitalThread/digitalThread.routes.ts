import path from "node:path"
import fs from "node:fs/promises"
import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { adaptDigitalThreadToGmat } from "./gmatDigitalThreadAdapter.js"
import { createPlanningRun, draftDigitalThreadWorkspaceDir, loadOrCreateDigitalThread, saveDigitalThread, updateDigitalThreadWithLlm } from "./digitalThreadStore.js"
import { getSatelliteDefinition, listSatelliteDefinitions, selectSatelliteDefinition } from "./satelliteLibrary.js"
import { assertValidSimuCicRequest } from "../opalis/groundStationCatalog.js"
import { loadMissionConversation } from "./missionConversationStore.js"

function resolveWorkspaceDir(root: string, requested: unknown) {
  const requestedPath = typeof requested === "string" && requested.trim() ? requested : null
  // Mission-file listings expose run paths relative to the user workspace.
  // Accept that stable API form as well as an absolute workspace path.
  const workspaceDir = requestedPath ? path.resolve(path.isAbsolute(requestedPath) ? requestedPath : path.join(root, requestedPath)) : path.resolve(root)
  if (!isPathInside(path.resolve(root), workspaceDir)) throw new Error("workspaceDir must be inside the current user workspace")
  return workspaceDir
}

function resolveMissionRunArtifact(root: string, workspaceDir: string, fileName: string) {
  const allowedFiles = /^(?:satellite\.json|conversation\.json|run_manifest\.json|(?:orbit_keeping|electric_propulsion_transfer)\.values\.yaml|(?:orbit_keeping|electric_propulsion_transfer)\.script|(?:ReboostReport|OrbitAnalysisReport|ElectricTransferReport)\.txt|EphemerisFile1\.oem|gmat\.log|gmat_result\.json|(?:orbit|electric_transfer)_timeseries\.json)$/u
  const resolvedWorkspace = path.resolve(workspaceDir)
  if (!isPathInside(path.resolve(root), resolvedWorkspace) || !resolvedWorkspace.split(path.sep).includes("mission-runs") || !allowedFiles.test(fileName)) return null
  return path.join(resolvedWorkspace, fileName)
}

function response(document: Awaited<ReturnType<typeof loadOrCreateDigitalThread>>) {
  return {
    adapters: {
      gmat: {
        electricPropulsionTransfer: adaptDigitalThreadToGmat(document, "electric-propulsion-transfer"),
        orbitKeeping: adaptDigitalThreadToGmat(document, "orbit-keeping"),
      },
    },
    document,
  }
}

// Executed runs keep their visible satellite.json at the run root. Reading it
// here makes the Mission Studio table show the exact Simu-CIC configuration
// that the runner consumes, rather than an unrelated live planning workspace.
async function loadDigitalThreadForView(workspaceDir: string) {
  for (const fileName of ["satellite.json", "satellite.digital-thread.json"]) {
    const source = await fs.readFile(path.join(workspaceDir, fileName), "utf8").catch(() => null)
    if (source) return JSON.parse(source) as Awaited<ReturnType<typeof loadOrCreateDigitalThread>>
  }
  return loadOrCreateDigitalThread(workspaceDir)
}

export async function digitalThreadRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.get("/api/satellite-library", async (_req, reply) => {
    try { return reply.send({ definitions: await listSatelliteDefinitions() }) }
    catch (error) { return reply.status(500).send({ error: getErrorMessage(error, "failed to load satellite library") }) }
  })

  fastify.get<{ Params: { id: string }; Querystring: { version?: string } }>("/api/satellite-library/:id/download", async (req, reply) => {
    try {
      const definition = await getSatelliteDefinition(req.params.id, req.query.version)
      return reply
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="${definition.id}.${definition.version}.json"`)
        .send(`${JSON.stringify(definition, null, 2)}\n`)
    } catch (error) { return reply.status(404).send({ error: getErrorMessage(error, "satellite definition was not found") }) }
  })

  fastify.post<{ Body: { workspaceDir?: unknown } }>("/api/digital-thread/planning-runs", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const planningRun = await createPlanningRun(resolveWorkspaceDir(root, req.body?.workspaceDir))
      return reply.status(201).send({ planningRun })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to start a planning run") }) }
  })

  fastify.post<{ Body: { id?: unknown; version?: unknown; workspaceDir?: unknown } }>("/api/satellite-library/select", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const id = typeof req.body?.id === "string" ? req.body.id.trim() : ""
    if (!id) return reply.status(400).send({ error: "id must be a non-empty string" })
    try {
      const result = await selectSatelliteDefinition(resolveWorkspaceDir(root, req.body?.workspaceDir), id, typeof req.body?.version === "string" ? req.body.version : undefined)
      return reply.send(result)
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to select satellite definition") }) }
  })

  fastify.get<{ Querystring: { workspaceDir?: string } }>("/api/digital-thread/satellite", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try { return reply.send(response(await loadDigitalThreadForView(resolveWorkspaceDir(root, req.query.workspaceDir)))) }
    catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to load satellite digital thread") }) }
  })

  // The live source of truth is useful before a GMAT execution. Each executed
  // run additionally receives its own immutable satellite.digital-thread.json
  // snapshot, referenced from that run manifest.
  fastify.get<{ Querystring: { workspaceDir?: string } }>("/api/digital-thread/satellite/download", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const document = await loadDigitalThreadForView(resolveWorkspaceDir(root, req.query.workspaceDir))
      return reply
        .header("Content-Type", "application/json; charset=utf-8")
        .header("Content-Disposition", "attachment; filename=satellite.json")
        .send(`${JSON.stringify(document, null, 2)}\n`)
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to download satellite digital thread") }) }
  })

  // A draft owns its own live satellite.json. It starts when the first
  // mission message creates the draft and evolves with that discussion.
  fastify.get<{ Querystring: { draftId?: string; template?: string; workspaceDir?: string } }>("/api/digital-thread/satellite/draft/download", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const draftId = typeof req.query.draftId === "string" ? req.query.draftId : ""
    const template = req.query.template
    if (!draftId || (template !== "orbit-keeping" && template !== "electric-propulsion-transfer")) {
      return reply.status(400).send({ error: "draftId and a supported template are required" })
    }
    try {
      const workspaceDir = resolveWorkspaceDir(root, req.query.workspaceDir)
      const document = await loadOrCreateDigitalThread(draftDigitalThreadWorkspaceDir(workspaceDir, template, draftId))
      return reply.header("Content-Type", "application/json; charset=utf-8").header("Content-Disposition", "attachment; filename=satellite.json").send(`${JSON.stringify(document, null, 2)}\n`)
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to download draft satellite digital thread") }) }
  })

  fastify.get<{ Querystring: { file?: string; workspaceDir?: string } }>("/api/digital-thread/mission-run/download", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveWorkspaceDir(root, req.query.workspaceDir)
      const fileName = typeof req.query.file === "string" ? req.query.file : ""
      const filePath = resolveMissionRunArtifact(root, workspaceDir, fileName)
      const source = filePath ? await fs.readFile(filePath, "utf8").catch(() => null) : null
      if (source === null) return reply.status(404).send({ error: "mission-run file is not available" })
      const contentType = fileName.endsWith(".yaml") ? "application/x-yaml; charset=utf-8" : "application/json; charset=utf-8"
      return reply.header("Content-Type", contentType).header("Content-Disposition", `attachment; filename="${fileName}"`).send(source)
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to download mission-run file") }) }
  })

  fastify.get<{ Querystring: { workspaceDir?: string } }>("/api/digital-thread/mission-run/files", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveWorkspaceDir(root, req.query.workspaceDir)
      if (!workspaceDir.split(path.sep).includes("mission-runs")) return reply.status(400).send({ error: "workspaceDir is not a mission run" })
      const allowed = /^(?:satellite\.json|conversation\.json|run_manifest\.json|(?:orbit_keeping|electric_propulsion_transfer)\.values\.yaml|(?:orbit_keeping|electric_propulsion_transfer)\.script|(?:ReboostReport|OrbitAnalysisReport|ElectricTransferReport)\.txt|EphemerisFile1\.oem|gmat\.log|gmat_result\.json|(?:orbit|electric_transfer)_timeseries\.json)$/u
      const entries = await fs.readdir(workspaceDir, { withFileTypes: true })
      const files = await Promise.all(entries.filter(entry => entry.isFile() && allowed.test(entry.name)).map(async entry => ({ fileName: entry.name, mtimeMs: (await fs.stat(path.join(workspaceDir, entry.name))).mtimeMs })))
      return reply.send({ files: files.sort((left, right) => left.fileName.localeCompare(right.fileName)) })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to list mission-run files") }) }
  })

  fastify.get<{ Querystring: { workspaceDir?: string } }>("/api/digital-thread/satellite/conversation", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try { return reply.send({ conversation: await loadMissionConversation(resolveWorkspaceDir(root, req.query.workspaceDir)) }) }
    catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to load mission conversation") }) }
  })

  fastify.post<{ Body: { attitudeMode?: unknown; groundStationIds?: unknown; workspaceDir?: unknown } }>("/api/digital-thread/satellite/simu-cic", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const attitudeMode = typeof req.body?.attitudeMode === "string" ? req.body.attitudeMode : null
    const groundStationIds = req.body?.groundStationIds
    if (!attitudeMode || !Array.isArray(groundStationIds) || !groundStationIds.every(id => typeof id === "string")) {
      return reply.status(400).send({ error: "attitudeMode and groundStationIds are required" })
    }
    if (attitudeMode === "nadir_pointing" && groundStationIds.length) {
      return reply.status(422).send({ error: "Nadir pointing does not use ground stations" })
    }
    if (attitudeMode === "ground_station_tracking" && !groundStationIds.length) {
      return reply.status(422).send({ error: "Select at least one predefined ground station for station tracking" })
    }
    try {
      const workspaceDir = resolveWorkspaceDir(root, req.body?.workspaceDir)
      const document = await loadOrCreateDigitalThread(workspaceDir)
      const request = {
        attitude_mode: attitudeMode,
        ground_station_ids: groundStationIds,
        simultaneous_visibility_policy: attitudeMode === "ground_station_tracking" ? "first_visible_station_wins" : null,
      }
      assertValidSimuCicRequest(request)
      document.analysis_requests.simu_cic = request
      const values = document.provenance.values && typeof document.provenance.values === "object" && !Array.isArray(document.provenance.values)
        ? document.provenance.values as { [key: string]: import("./digitalThreadStore.js").JsonValue }
        : {}
      values["analysis_requests.simu_cic"] = { source: "simu_cic_configuration", recorded_at: new Date().toISOString() }
      document.provenance.values = values
      await saveDigitalThread(workspaceDir, document)
      return reply.send(response(document))
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to save Simu-CIC configuration") }) }
  })

  fastify.post<{ Body: { message?: unknown; workspaceDir?: unknown } }>("/api/digital-thread/satellite/messages", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!message) return reply.status(400).send({ error: "message must be a non-empty string" })
    try {
      const workspaceDir = resolveWorkspaceDir(root, req.body?.workspaceDir)
      const result = await updateDigitalThreadWithLlm({ connection: resolveModelBackend(config, "chatModel"), message, workspaceDir })
      return reply.send({ ...response(result.document), message: result.message })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to update satellite digital thread") }) }
  })
}
