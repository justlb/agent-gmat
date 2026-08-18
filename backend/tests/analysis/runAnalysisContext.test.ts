import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { after, describe, it } from "node:test"

import { writeRunAnalysisContext } from "../../src/analysis/runAnalysisContext.js"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "run-analysis-context-"))
after(() => fs.rm(root, { force: true, recursive: true }))

describe("run analysis context", () => {
  it("consolidates immutable inputs, GMAT metrics, workflow state and OPALIS warnings", async () => {
    const runDir = path.join(root, "run-a")
    await fs.mkdir(path.join(runDir, "digital-thread"), { recursive: true })
    await fs.mkdir(path.join(runDir, "opalis", "03-opalis", "02-resultats"), { recursive: true })
    await fs.writeFile(path.join(runDir, "run_manifest.json"), JSON.stringify({ runId: "run-a", templateId: "electric-propulsion-transfer" }))
    await fs.writeFile(path.join(runDir, "gmat_result.json"), JSON.stringify({ status: "completed", reportSampleCount: 4, executionDurationMs: 120 }))
    await fs.writeFile(path.join(runDir, "electric_transfer_timeseries.json"), JSON.stringify([{ altitude_km: 300, fuel_kg: 2.3 }, { altitude_km: 310, fuel_kg: 2.1 }]))
    await fs.writeFile(path.join(runDir, "digital-thread", "satellite.json"), JSON.stringify({
      satellite_definition_id: "ref-leo-electric",
      satellite: { identity: { name: "Test satellite" } },
      orbit: { reference_epoch_utc: "2026-08-01T00:00:00Z", keplerian_elements: { semi_major_axis_km: 6678.1363, eccentricity: 0, inclination_deg: 0 } },
      analysis_requests: { gmat: { electric_propulsion_transfer: { duration_days: 3 } }, simu_cic: { attitude_mode: "nadir_pointing" } },
    }))
    await fs.writeFile(path.join(runDir, "opalis", "03-opalis", "02-resultats", "calculated-opalis.json"), JSON.stringify({ simulation_executed: true, initial_soc: 0.9, final_soc: 0.15, stop_condition: "eBattMin reached" }))

    const { context, output } = await writeRunAnalysisContext(runDir)
    assert.equal(context.run.template, "electric-propulsion-transfer")
    assert.equal(context.configuration.satellite.name, "Test satellite")
    assert.equal((context.results.gmat as { time_series: { metrics: { altitude_km: { last: number } } } }).time_series.metrics.altitude_km.last, 310)
    assert.ok(context.verdicts.some(item => item.tool === "OPALIS" && /battery minimum/u.test(item.message)))
    assert.ok((await fs.stat(output)).isFile())
  })
})
