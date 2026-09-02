import assert from "node:assert/strict"
import fs from "node:fs/promises"
import path from "node:path"
import { describe, it } from "node:test"

import { loadConfig } from "../../src/config.js"
import { selectSatelliteDefinition } from "../../src/digitalThread/satelliteLibrary.js"
import { loadRunWorkflowLog } from "../../src/opalis/workflowRunLog.js"
import { createMissionRun } from "../../src/runs/missionRunService.js"
import { resolveUserWorkspaceRoot } from "../../src/workspaces/workspacePaths.js"
import { createTestServer } from "../helpers/createTestServer.js"

const execute = process.env.RUN_REAL_MISSION_PIPELINE === "1"

async function waitForTerminalWorkflow(runDir: string, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const workflow = await loadRunWorkflowLog(runDir)
    const statuses = Object.values(workflow.stages).map(stage => stage.status)
    // The orchestrator deliberately responds 202 before its detached task is
    // scheduled. Do not mistake that initial all-not-started snapshot for a
    // finished workflow.
    if (
      workflow.stages.simu_cic.status !== "not_started"
      && workflow.stages.opalis.status !== "not_started"
      && workflow.stages.rf_comlink.status !== "not_started"
      && !statuses.includes("running")
    ) return workflow
    await new Promise(resolve => setTimeout(resolve, 1_000))
  }
  throw new Error(`mission pipeline did not settle within ${timeoutMs / 1_000} seconds`)
}

describe("real Chemical Hohmann mission pipeline", { skip: !execute }, () => {
  it("executes GMAT then drives Simu-CIC, OPALIS and RF-COMLINK", { timeout: 180_000 }, async () => {
    const config = loadConfig()
    const userId = "pipeline-verification"
    const root = resolveUserWorkspaceRoot(config, userId)
    const run = await createMissionRun(root)
    await selectSatelliteDefinition(run.workspaceDir, "ref-leo-orbit-keeping", "1.0.0")
    const server = await createTestServer({ config })
    const headers = { [config.auth.headerName]: userId }
    const workspaceDir = path.relative(root, run.workspaceDir).split(path.sep).join("/")
    try {
      const attitude = await server.inject({
        method: "POST",
        url: "/api/digital-thread/satellite/simu-cic",
        headers,
        payload: { attitudeMode: "ground_station_tracking", groundStationIds: ["kourou"], workspaceDir },
      })
      assert.equal(attitude.statusCode, 200, attitude.body)
      const base = "/api/gmat/templates/chemical-hohmann-transfer"
      const created = await server.inject({ method: "POST", url: `${base}/drafts`, headers, payload: { workspaceDir } })
      assert.equal(created.statusCode, 200, created.body)
      const draftId = (created.json() as { draftId: string }).draftId
      for (const [fieldPath, value] of [
        ["initialOrbit.epoch", "31258.66709490726"],
        ["initialOrbit.smaKm", "6678.1363"],
        ["initialOrbit.eccentricity", "0"],
        ["initialOrbit.inclinationDeg", "0"],
        ["transfer.targetRadiusKm", "7378.1363"],
      ]) {
        const updated = await server.inject({ method: "PATCH", url: `${base}/drafts/${draftId}/values`, headers, payload: { path: fieldPath, value, workspaceDir } })
        assert.equal(updated.statusCode, 200, updated.body)
      }
      const response = await server.inject({ method: "POST", url: `${base}/drafts/${draftId}/run-full-pipeline`, headers, payload: { workspaceDir } })
      assert.equal(response.statusCode, 202, response.body)
      const workflow = await waitForTerminalWorkflow(run.workspaceDir)
      assert.deepEqual(Object.fromEntries(Object.entries(workflow.stages).map(([name, stage]) => [name, stage.status])), {
        gmat: "completed", simu_cic: "completed", opalis: "completed", rf_comlink: "completed",
      })
    } finally {
      await server.close()
      await fs.access(run.workspaceDir)
    }
  })
})
