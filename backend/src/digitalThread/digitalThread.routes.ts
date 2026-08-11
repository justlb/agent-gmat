import path from "node:path"
import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { adaptDigitalThreadToGmat } from "./gmatDigitalThreadAdapter.js"
import { loadOrCreateDigitalThread, saveDigitalThread, updateDigitalThreadWithLlm } from "./digitalThreadStore.js"
import { listSatelliteDefinitions, selectSatelliteDefinition } from "./satelliteLibrary.js"
import { assertValidSimuCicRequest } from "../opalis/groundStationCatalog.js"
import { loadMissionConversation } from "./missionConversationStore.js"

function resolveWorkspaceDir(root: string, requested: unknown) {
  const workspaceDir = typeof requested === "string" && requested.trim() ? path.resolve(requested) : path.resolve(root)
  if (!isPathInside(path.resolve(root), workspaceDir)) throw new Error("workspaceDir must be inside the current user workspace")
  return workspaceDir
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

export async function digitalThreadRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.get("/api/satellite-library", async (_req, reply) => {
    try { return reply.send({ definitions: await listSatelliteDefinitions() }) }
    catch (error) { return reply.status(500).send({ error: getErrorMessage(error, "failed to load satellite library") }) }
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
    try { return reply.send(response(await loadOrCreateDigitalThread(resolveWorkspaceDir(root, req.query.workspaceDir)))) }
    catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to load satellite digital thread") }) }
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
