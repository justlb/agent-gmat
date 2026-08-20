import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { loadOpalisTimeSeries } from "../../src/opalis/opalisResults.js"

test("loads the OPALIS electrical time-series exported by the Python pipeline", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "opalis-results-"))
  const resultDir = path.join(runDir, "opalis", "03-opalis", "02-resultats")
  await fs.mkdir(resultDir, { recursive: true })
  await fs.writeFile(path.join(resultDir, "calculated-opalis-timeseries.json"), JSON.stringify({
    available_row_properties: ["SocBattery", "VBatt", "Esa", "Dod"],
    sample_interval_rows: 5,
    source_row_count: 10,
    samples: [{ index: 0, time_seconds: 0, soc_percent: 92, battery_voltage_v: 52.3, solar_energy_wh: 18.4, depth_of_discharge_percent: 8 }],
  }))

  const series = await loadOpalisTimeSeries(runDir)

  assert.deepEqual(series, {
    availableRowProperties: ["SocBattery", "VBatt", "Esa", "Dod"],
    sampleIntervalRows: 5,
    sourceRowCount: 10,
    samples: [{ index: 0, time_seconds: 0, soc_percent: 92, battery_voltage_v: 52.3, solar_energy_wh: 18.4, depth_of_discharge_percent: 8 }],
  })
})
