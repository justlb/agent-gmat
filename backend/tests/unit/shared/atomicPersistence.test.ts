import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { appendRunConversation } from "../../../src/digitalThread/missionConversationStore.js"
import { updateRunWorkflowLog } from "../../../src/opalis/workflowRunLog.js"

test("simultaneous run writes retain every conversation turn and workflow stage", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "atomic-run-write-"))
  try {
    await Promise.all([
      appendRunConversation(runDir, { answer: "first", askedAt: "2026-08-16T00:00:00Z", channel: "gmat-draft", question: "one" }),
      appendRunConversation(runDir, { answer: "second", askedAt: "2026-08-16T00:00:01Z", channel: "opalis", question: "two" }),
      updateRunWorkflowLog(runDir, "simu_cic", "completed", "CIC complete"),
      updateRunWorkflowLog(runDir, "rf_comlink", "running", "RF running"),
      updateRunWorkflowLog(runDir, "gmat", "completed", "GMAT complete"),
    ])
    const conversation = JSON.parse(await fs.readFile(path.join(runDir, "conversation.json"), "utf8")) as Array<{ question: string }>
    const workflow = JSON.parse(await fs.readFile(path.join(runDir, "workflow-status.json"), "utf8")) as { stages: Record<string, { status: string }> }
    assert.deepEqual(conversation.map(turn => turn.question).sort(), ["one", "two"])
    assert.equal(workflow.stages.simu_cic.status, "completed")
    assert.equal(workflow.stages.rf_comlink.status, "running")
    assert.equal(workflow.stages.gmat.status, "completed")
  } finally {
    await fs.rm(runDir, { force: true, recursive: true })
  }
})
