import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { loadRFComlinkResultSummary } from "../../src/rfComlink/rfComlinkResults.js"

test("RF-COMLINK extracts only labelled report indicators with their source", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "rf-comlink-results-"))
  try {
    const output = path.join(root, "rf-comlink", "03-results")
    await fs.mkdir(output, { recursive: true })
    await fs.writeFile(path.join(output, "rf-comlink-results.json"), JSON.stringify({
      link_files: ["uplink.rfcl"],
      reports: [{ path: "uplink-report.txt", text: "Link Margin: 3.5 dB\nAvailability = 99.9 %\nData Rate is 12.5 Mbps" }],
      scenario: "calculated.rfcl",
      schema_version: 1,
      sha256: "abc123",
    }))

    const summary = await loadRFComlinkResultSummary(root)
    assert.deepEqual(summary?.indicators, [
      { metric: "link margin", source_report: "uplink-report.txt", unit: "dB", value: 3.5 },
      { metric: "availability", source_report: "uplink-report.txt", unit: "%", value: 99.9 },
      { metric: "data rate", source_report: "uplink-report.txt", unit: "Mbps", value: 12.5 },
    ])
    assert.deepEqual(summary?.link_budgets, [])
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
