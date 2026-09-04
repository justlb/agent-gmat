import fs from "node:fs/promises"
import path from "node:path"

import type { FastifyInstance, FastifyRequest } from "fastify"

import { getRequestUserWorkspaceRoot, runWithRequestContext } from "../server/requestContext.js"
import { getErrorMessage } from "../shared/index.js"
import { resolveMissionRun } from "./runWorkspace.js"
import { loadRunWorkflowLog } from "../opalis/workflowRunLog.js"
import { failRunStage } from "./runLifecycle.js"
import { acquireMissionPipelineLock, releaseMissionPipelineLock } from "./missionPipelineLock.js"

type Body = { runPath?: unknown }
type StageResult = { error?: string; ok: boolean }

const CIC_CONSUMER_INPUTS = [
  "Sat_SUN_ANGLE_SA_1.TXT", "Sat_SATELLITE_ECLIPSE.TXT", "Sat_EARTH_ANGLE_SA_1.TXT", "Sat_SATELLITE_ALTITUDE.TXT",
  "Sat_EARTH_DIRECTION-SATELLITE_FRAME.TXT", "Sat_GEOGRAPHICAL_COORDINATES.TXT",
  "Sat_SATELLITE_DIRECTION-GROUND_STATION_1_FRAME.TXT",
] as const

/** Simu-CIC's GUI can expose its process completion before Windows has
 * flushed the last CIC files.  OPALIS and RF-COMLINK consume those files
 * immediately, so the orchestrator waits for the complete shared set rather
 * than turning a transient write into two downstream failures. */
async function waitForCicConsumerInputs(runDir: string, timeoutMs = 10_000) {
  const cicDir = path.join(runDir, "opalis", "02-simu-cic", "02-fichiers-cic", "Sat")
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const entries = await fs.readdir(cicDir, { withFileTypes: true }).catch(() => [])
    const names = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name))
    if (CIC_CONSUMER_INPUTS.every(name => names.has(name))) return true
    await new Promise(resolve => setTimeout(resolve, 250))
  }
  return false
}

export type StartMissionPipelineInput = {
  fastify: FastifyInstance
  headers: FastifyRequest["headers"]
  root: string
  runDir: string
  runPath: string
}

/** Starts the downstream stages for a run that has already been validated by
 * its caller. This avoids re-parsing the run path when the GMAT draft route
 * hands off an execution it has just created. */
export async function startMissionPipeline({ fastify, headers, root, runDir, runPath }: StartMissionPipelineInput) {
  if (!acquireMissionPipelineLock(runDir, "full_pipeline")) {
    throw Object.assign(new Error("The full mission pipeline is already running for this run"), { statusCode: 409 })
  }
  try {
    const initial = await loadRunWorkflowLog(runDir)
    if (initial.stages.gmat.status !== "completed") {
      throw Object.assign(new Error("GMAT must complete successfully before the mission pipeline can start"), { statusCode: 422 })
    }

    const call = async (url: string): Promise<StageResult> => {
      // Child routes use the authenticated workspace from AsyncLocalStorage.
      // Preserve it explicitly for every in-process dispatch.
      // `content-length` describes the browser's outer request body, not this
      // newly-built `{ runPath }` payload. Passing it through makes Fastify
      // reject the internal dispatch with HTTP 400 before Simu-CIC starts.
      const childHeaders = { ...headers }
      delete childHeaders["content-length"]
      delete childHeaders["transfer-encoding"]
      const response = await runWithRequestContext({ userWorkspaceRoot: root }, () => fastify.inject({ method: "POST", url, headers: childHeaders, payload: { runPath } }))
      if (response.statusCode >= 200 && response.statusCode < 300) return { ok: true }
      const payload = response.json() as { error?: unknown; message?: unknown }
      const message = typeof payload.message === "string" ? payload.message : null
      const error = typeof payload.error === "string" ? payload.error : null
      return { error: message && error ? `${error}: ${message}` : error ?? message ?? `request failed (${response.statusCode})`, ok: false }
    }

    // Return immediately so the UI can poll workflow-status.json while the
    // tools run. Each tool route persists its own running/completed/failed
    // status, which survives a browser refresh.
    void (async () => {
      try {
        const simuCic = await call("/api/opalis/simu-cic/run")
        if (!simuCic.ok) {
          const workflow = await loadRunWorkflowLog(runDir)
          if (workflow.stages.simu_cic.status === "not_started") {
            await failRunStage(runDir, "simu_cic", `Pipeline could not start Simu-CIC: ${simuCic.error ?? "unknown dispatch error"}`)
          }
          return
        }
        // Simu-CIC is the producer of the shared CIC inputs. Do not dispatch
        // either consumer merely because the HTTP call returned: its persisted
        // lifecycle state must explicitly confirm completion first.
        const afterSimuCic = await loadRunWorkflowLog(runDir)
        if (afterSimuCic.stages.simu_cic.status !== "completed") return
        if (!await waitForCicConsumerInputs(runDir)) {
          const message = "Simu-CIC completed without making all CIC inputs available to OPALIS and RF-COMLINK."
          await Promise.all([failRunStage(runDir, "opalis", message), failRunStage(runDir, "rf_comlink", message)])
          return
        }
        const [opalis, rfComlink] = await Promise.all([call("/api/opalis/run-scenario"), call("/api/rf-comlink/run")])
        const workflow = await loadRunWorkflowLog(runDir)
        if (!opalis.ok && workflow.stages.opalis.status === "not_started") {
          await failRunStage(runDir, "opalis", `Pipeline could not start OPALIS: ${opalis.error ?? "unknown dispatch error"}`)
        }
        if (!rfComlink.ok && workflow.stages.rf_comlink.status === "not_started") {
          await failRunStage(runDir, "rf_comlink", `Pipeline could not start RF-COMLINK: ${rfComlink.error ?? "unknown dispatch error"}`)
        }
      } finally { releaseMissionPipelineLock(runDir, "full_pipeline") }
    })()
    return initial
  } catch (error) {
    releaseMissionPipelineLock(runDir, "full_pipeline")
    throw error
  }
}

/**
 * Single backend entry point for the downstream mission workflow.  It keeps
 * Simu-CIC serial (it produces the shared CIC inputs), then starts OPALIS and
 * RF-COMLINK concurrently.  Individual tool routes remain the authority for
 * validation, lifecycle persistence and artifact generation.
 */
export async function missionPipelineRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: Body }>("/api/gmat/mission-pipeline/run", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const run = root ? resolveMissionRun(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!run) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      const initial = await startMissionPipeline({ fastify, headers: req.headers, root, runDir: run.runDir, runPath: run.runPath })
      return reply.code(202).send({ ok: true, runPath: req.body?.runPath, workflow: initial })
    } catch (error) {
      const statusCode = typeof (error as { statusCode?: unknown }).statusCode === "number" ? (error as { statusCode: number }).statusCode : 422
      return reply.status(statusCode).send({ error: getErrorMessage(error, "mission pipeline failed") })
    }
  })
}
