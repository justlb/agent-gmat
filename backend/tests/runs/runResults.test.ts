import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"
import { listResultRuns, resultRunStatus } from "../../src/runs/runResults.js"
import { loadRunWorkflowLog, updateRunWorkflowLog } from "../../src/opalis/workflowRunLog.js"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "run-results-"))
after(() => fs.rm(root, { recursive: true, force: true }))

describe("Results run archive", () => {
  it("requires all four stages to succeed and distinguishes partial, running, failed and unstarted runs", async () => {
    const workflow = await loadRunWorkflowLog(root)
    assert.equal(resultRunStatus("drafting", workflow), "not_started")
    assert.equal(resultRunStatus("completed", workflow), "partial")
    workflow.stages.gmat.status = "completed"
    workflow.stages.simu_cic.status = "running"
    assert.equal(resultRunStatus("completed", workflow), "running")
    workflow.stages.simu_cic.status = "failed"
    assert.equal(resultRunStatus("completed", workflow), "failed")
    for (const stage of Object.values(workflow.stages)) stage.status = "completed"
    assert.equal(resultRunStatus("completed", workflow), "completed")
    assert.equal(resultRunStatus("timeout", workflow), "failed")
  })

  it("includes failed runs without time series, sorts dates and excludes non-run folders", async () => {
    const collection = path.join(root, "gmat", "mission-runs")
    for (const [id, status, date] of [["26-09-04_10-00", "completed", "2026-09-04T10:00:00Z"], ["26-09-04_11-00", "failed", "2026-09-04T11:00:00Z"]]) {
      const runDir = path.join(collection, id)
      await fs.mkdir(runDir, { recursive: true })
      await fs.writeFile(path.join(runDir, "run_manifest.json"), JSON.stringify({ templateId: "orbit-keeping", status, createdAt: date }))
      await updateRunWorkflowLog(runDir, "gmat", status as "completed" | "failed", null)
    }
    await fs.mkdir(path.join(collection, "drafts"))
    const runs = await listResultRuns(root)
    assert.equal(runs.length, 2)
    assert.equal(runs[0].runId, "26-09-04_11-00")
    assert.equal(runs[0].status, "failed")
    assert.equal(runs[1].status, "partial")
    assert.deepEqual(await listResultRuns(root, path.join(collection, runs[0].runId)), runs)
    await assert.rejects(listResultRuns(root, "../other-user"), /inside the current user workspace/u)
  })
})
