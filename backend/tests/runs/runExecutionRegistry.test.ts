import assert from "node:assert/strict"
import test from "node:test"

import { activeRunStages, runStageExclusively } from "../../src/runs/runExecutionRegistry.js"

test("one run stage cannot execute concurrently", async () => {
  let release!: () => void
  const pending = new Promise<void>(resolve => { release = resolve })
  const first = runStageExclusively("/tmp/mission-run", "simu_cic", async () => { await pending; return "done" })
  assert.deepEqual(activeRunStages("/tmp/mission-run"), ["simu_cic"])
  await assert.rejects(() => runStageExclusively("/tmp/mission-run", "simu_cic", async () => "duplicate"), /already running/u)
  release()
  assert.equal(await first, "done")
  assert.deepEqual(activeRunStages("/tmp/mission-run"), [])
})
