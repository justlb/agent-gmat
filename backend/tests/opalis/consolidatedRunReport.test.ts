import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { writeConsolidatedRunReport } from "../../src/opalis/consolidatedRunReport.js"
import { updateRunWorkflowLog } from "../../src/opalis/workflowRunLog.js"

test("the consolidated report refreshes RF-COMLINK data without duplicating raw reports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "consolidated-report-"))
  try {
    const rfOutput = path.join(root, "rf-comlink", "03-results")
    await fs.mkdir(rfOutput, { recursive: true })
    await Promise.all([
      fs.writeFile(path.join(root, "run_manifest.json"), JSON.stringify({ runId: "26-09-09_12-00", templateId: "chemical-hohmann-transfer", status: "completed" })),
      fs.writeFile(path.join(root, "gmat_result.json"), JSON.stringify({ status: "completed" })),
      fs.writeFile(path.join(root, "satellite.json"), JSON.stringify({ satellite: { identity: { name: "TestSat" } } })),
      fs.writeFile(path.join(rfOutput, "rf-comlink-results.json"), JSON.stringify({
        link_files: ["link.rfcl"], reports: [{ path: "link-report.txt", text: "Link Margin: 4.2 dB" }], scenario: "calculated.rfcl", schema_version: 1, sha256: "abc",
      })),
    ])
    for (const stage of ["gmat", "simu_cic", "opalis", "rf_comlink"] as const) await updateRunWorkflowLog(root, stage, "completed", null)

    const written = await writeConsolidatedRunReport(root)
    const report = JSON.parse(await fs.readFile(written.output, "utf8")) as { schema_version: number; rf_comlink: { indicators: unknown[]; reports: Array<Record<string, unknown>> }; workflow: { stages: { rf_comlink: { status: string } } } }
    assert.equal(report.schema_version, 2)
    assert.equal(report.workflow.stages.rf_comlink.status, "completed")
    assert.deepEqual(report.rf_comlink.indicators, [{ metric: "link margin", source_report: "link-report.txt", unit: "dB", value: 4.2 }])
    assert.deepEqual(report.rf_comlink.reports, [{ character_count: 19, path: "link-report.txt" }])
    assert.equal("text" in report.rf_comlink.reports[0], false)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
