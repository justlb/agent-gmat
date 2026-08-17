import assert from "node:assert/strict"
import test from "node:test"

import { runGmatCompatibilityCampaign } from "../../scripts/gmatCompatibilityCampaign.js"

test("GMAT compatibility campaign evaluates every satellite/template pair without mutating the library", async () => {
  const report = await runGmatCompatibilityCampaign()
  assert.equal(report.summary.total, 12)
  assert.deepEqual(report.summary, { blocked: 7, failed: 0, passed: 5, total: 12 })
  assert.ok(report.cases.some(item => item.template === "chemical-3d-transfer" && item.render === "passed"))
  assert.ok(report.cases.some(item => item.template === "electric-propulsion-transfer" && item.render === "blocked"))
})
