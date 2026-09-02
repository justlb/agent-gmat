import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import type { FastifyInstance } from "fastify"

import { updateRunWorkflowLog } from "../../src/opalis/workflowRunLog.js"
import { startMissionPipeline } from "../../src/runs/missionPipeline.routes.js"
import { createMissionRun } from "../../src/runs/missionRunService.js"

function delay(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

describe("mission pipeline orchestration", () => {
  it("runs Simu-CIC first, then starts OPALIS and RF-COMLINK in parallel", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mission-pipeline-"))
    const run = await createMissionRun(root)
    const runPath = path.relative(root, run.workspaceDir).split(path.sep).join("/")
    await updateRunWorkflowLog(run.workspaceDir, "gmat", "completed", "GMAT completed in the controlled Hohmann scenario.")

    const events: string[] = []
    let completePipeline: (() => void) | undefined
    const pipelineCompleted = new Promise<void>(resolve => { completePipeline = resolve })
    const fakeFastify = {
      inject: async ({ url }: { url: string }) => {
        if (url === "/api/opalis/simu-cic/run") {
          events.push("simu-cic:start")
          await updateRunWorkflowLog(run.workspaceDir, "simu_cic", "running", "Simu-CIC calculation is running.")
          await delay(10)
          await updateRunWorkflowLog(run.workspaceDir, "simu_cic", "completed", "Simu-CIC completed.")
          events.push("simu-cic:complete")
        } else if (url === "/api/opalis/run-scenario") {
          events.push("opalis:start")
          await updateRunWorkflowLog(run.workspaceDir, "opalis", "running", "OPALIS calculation is running.")
          await delay(25)
          await updateRunWorkflowLog(run.workspaceDir, "opalis", "completed", "OPALIS completed.")
          events.push("opalis:complete")
        } else if (url === "/api/rf-comlink/run") {
          events.push("rf-comlink:start")
          await updateRunWorkflowLog(run.workspaceDir, "rf_comlink", "running", "RF-COMLINK calculation is running.")
          await delay(25)
          await updateRunWorkflowLog(run.workspaceDir, "rf_comlink", "completed", "RF-COMLINK completed.")
          events.push("rf-comlink:complete")
          completePipeline?.()
        } else {
          throw new Error(`unexpected orchestrator call: ${url}`)
        }
        return { json: () => ({}), statusCode: 200 }
      },
    } as unknown as FastifyInstance

    const initial = await startMissionPipeline({ fastify: fakeFastify, headers: {}, root, runDir: run.workspaceDir, runPath })
    assert.equal(initial.stages.gmat.status, "completed")
    await pipelineCompleted

    assert.deepEqual(events.slice(0, 4), ["simu-cic:start", "simu-cic:complete", "opalis:start", "rf-comlink:start"])
    assert.equal(events.includes("opalis:complete"), true)
    const workflow = JSON.parse(await fs.readFile(path.join(run.workspaceDir, "workflow-status.json"), "utf8")) as { stages: Record<string, { status: string }> }
    assert.deepEqual(Object.fromEntries(Object.entries(workflow.stages).map(([name, stage]) => [name, stage.status])), {
      gmat: "completed", simu_cic: "completed", opalis: "completed", rf_comlink: "completed",
    })
  })
})
