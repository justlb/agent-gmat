import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createMissionRun } from "../../src/runs/missionRunService.js"
import { loadRunWorkflowLog } from "../../src/opalis/workflowRunLog.js"

test("a new mission run is complete and independent before it is returned", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "mission-run-service-"))
  const now = new Date(2026, 7, 24, 12, 34, 0, 0)
  try {
    const first = await createMissionRun(root, now)
    const second = await createMissionRun(root, now)
    assert.equal(first.planningRunId, "26-08-24_12-34")
    assert.equal(second.planningRunId, "26-08-24_12-34_02")

    for (const run of [first, second]) {
      const files = await fs.readdir(run.workspaceDir)
      for (const required of ["satellite.json", "conversation.json", "run_manifest.json", "workflow-status.json"]) {
        assert.ok(files.includes(required), `${required} must exist before the run is returned`)
      }
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(run.workspaceDir, "conversation.json"), "utf8")), [])
      const manifest = JSON.parse(await fs.readFile(path.join(run.workspaceDir, "run_manifest.json"), "utf8")) as { runId: string; status: string }
      assert.equal(manifest.runId, run.planningRunId)
      assert.equal(manifest.status, "drafting")
      const workflow = await loadRunWorkflowLog(run.workspaceDir)
      assert.deepEqual(Object.values(workflow.stages).map(stage => stage.status), ["not_started", "not_started", "not_started", "not_started"])
    }
  } finally {
    await fs.rm(root, { force: true, recursive: true })
  }
})
