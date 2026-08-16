import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { buildDraftRunComparisonEntries, writeDraftRunComparisonIndex } from "../../src/gmat/draftRunComparison.js"

test("run comparison index retains each immutable run and its complete input delta", async () => {
  const runs = [
    { completedAt: "2026-08-01T09:00:00Z", missionValues: { "initialOrbit.smaKm": 6678.1363, "spacecraft.initialFuelMassKg": 10 }, result: { status: "completed" }, runId: "run-1", runPath: "gmat/orbit-keeping/run-1" },
    { completedAt: "2026-08-01T10:00:00Z", missionValues: { "initialOrbit.smaKm": 6678.1363, "spacecraft.initialFuelMassKg": 8, "stationKeeping.minimumAltitudeKm": 250 }, result: { finalFuelMassKg: 6.2, status: "completed" }, runId: "run-2", runPath: "gmat/orbit-keeping/run-2" },
  ]
  const entries = buildDraftRunComparisonEntries(runs)
  assert.deepEqual(entries[1].changed_from_previous, [
    { from: 10, path: "spacecraft.initialFuelMassKg", to: 8 },
    { from: null, path: "stationKeeping.minimumAltitudeKm", to: 250 },
  ])

  const draftDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-run-comparison-"))
  const saved = await writeDraftRunComparisonIndex({ draftDirectory, runs, templateId: "orbit-keeping-earth-keplerian" })
  const persisted = JSON.parse(await fs.readFile(saved.output, "utf8")) as { entries: typeof entries; schema_version: number }
  assert.equal(persisted.schema_version, 1)
  assert.deepEqual(persisted.entries, entries)
})
