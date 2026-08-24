import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { completeRunStage, deferRunStage, invalidateDownstreamFromGmat, invalidateDownstreamFromSimuCic, invalidateRunFrom } from "../../src/runs/runLifecycle.js"
import { loadRunWorkflowLog } from "../../src/opalis/workflowRunLog.js"

test("a new GMAT result invalidates every dependent calculation", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "mission-run-lifecycle-"))
  try {
    await completeRunStage(runDir, "gmat", "GMAT complete")
    await completeRunStage(runDir, "simu_cic", "CIC complete")
    await completeRunStage(runDir, "opalis", "OPALIS complete")
    await completeRunStage(runDir, "rf_comlink", "RF complete")

    await invalidateDownstreamFromGmat(runDir)
    const workflow = await loadRunWorkflowLog(runDir)
    assert.equal(workflow.stages.gmat.status, "completed")
    assert.equal(workflow.stages.simu_cic.status, "not_started")
    assert.equal(workflow.stages.opalis.status, "not_started")
    assert.equal(workflow.stages.rf_comlink.status, "not_started")
  } finally {
    await fs.rm(runDir, { force: true, recursive: true })
  }
})

test("a changed Simu-CIC configuration preserves GMAT and resets its consumers", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "mission-run-lifecycle-"))
  try {
    await completeRunStage(runDir, "gmat", "GMAT complete")
    await completeRunStage(runDir, "simu_cic", "CIC complete")
    await completeRunStage(runDir, "opalis", "OPALIS complete")
    await completeRunStage(runDir, "rf_comlink", "RF complete")

    await invalidateDownstreamFromSimuCic(runDir)
    const workflow = await loadRunWorkflowLog(runDir)
    assert.equal(workflow.stages.gmat.status, "completed")
    assert.deepEqual(
      [workflow.stages.simu_cic.status, workflow.stages.opalis.status, workflow.stages.rf_comlink.status],
      ["not_started", "not_started", "not_started"],
    )
  } finally {
    await fs.rm(runDir, { force: true, recursive: true })
  }
})

test("a satellite change invalidates the complete mission run", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "mission-run-lifecycle-"))
  try {
    await completeRunStage(runDir, "gmat", "GMAT complete")
    await invalidateRunFrom(runDir, "gmat", "Satellite changed.")
    const workflow = await loadRunWorkflowLog(runDir)
    assert.deepEqual(
      [workflow.stages.gmat.status, workflow.stages.simu_cic.status, workflow.stages.opalis.status, workflow.stages.rf_comlink.status],
      ["not_started", "not_started", "not_started", "not_started"],
    )
  } finally {
    await fs.rm(runDir, { force: true, recursive: true })
  }
})

test("a generated script is not reported as an executed GMAT calculation", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "mission-run-lifecycle-"))
  try {
    await deferRunStage(runDir, "gmat", "Script generated; simulation not executed.")
    const workflow = await loadRunWorkflowLog(runDir)
    assert.equal(workflow.stages.gmat.status, "not_started")
    assert.match(workflow.stages.gmat.message ?? "", /not executed/)
  } finally {
    await fs.rm(runDir, { force: true, recursive: true })
  }
})
