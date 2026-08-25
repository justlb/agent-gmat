/** Verifies that Mission Studio's saved-run view is projected from satellite.json. */
import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { after, before, describe, it } from "node:test"

import { buildRunViewModel } from "../../src/runs/runViewModel.js"
import type { MissionRunReference } from "../../src/runs/runWorkspace.js"

describe("canonical mission run view", () => {
  let root = ""
  let run: MissionRunReference

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-run-view-"))
    const runDir = path.join(root, "gmat", "mission-runs", "26-08-24_16-00")
    run = { root, runDir, runId: "26-08-24_16-00", runPath: "gmat/mission-runs/26-08-24_16-00" }
  })

  after(async () => { await fs.rm(root, { recursive: true, force: true }) })

  it("returns saved orbital, mission and Simu-CIC values from the run document", async () => {
    await fs.mkdir(run.runDir, { recursive: true })
    await fs.writeFile(path.join(run.runDir, "satellite.json"), JSON.stringify({
      schema_version: 1,
      digital_thread: {},
      provenance: {},
      satellite: { orbit: { keplerian_elements: { semi_major_axis_km: 6678.1363, eccentricity: 0, inclination_deg: 51.6 }, reference_epoch_tai_mod_julian: 31253.5 }, bus: { physical: { mass_kg: { dry: 300 }, drag_area_m2: 2, drag_coefficient: 2.2 } } },
      analysis_requests: { gmat: { orbit_keeping: { initial_fuel_mass_kg: 5, minimum_reboost_altitude_km: 250 } }, simu_cic: { attitude_mode: "ground_station_tracking", ground_station_ids: ["kourou"], simultaneous_visibility_policy: "first_visible_station_wins" } },
    }))
    await fs.writeFile(path.join(run.runDir, "run_manifest.json"), JSON.stringify({ templateId: "orbit-keeping" }))
    await fs.writeFile(path.join(run.runDir, "EphemerisFile1.oem"), "OEM")

    const view = await buildRunViewModel(run)

    assert.equal(view.missionValues["initialOrbit.smaKm"], 6678.1363)
    assert.equal(view.missionValues["initialOrbit.altitudeKm"], 300)
    assert.equal(view.missionValues["spacecraft.initialFuelMassKg"], 5)
    assert.deepEqual(view.simuCic.ground_station_ids, ["kourou"])
    assert.equal(view.artifacts.some(artifact => artifact.id === "gmat-ephemeris"), true)
  })

  it("projects Chemical 3D target values from its own satellite.json request", async () => {
    await fs.writeFile(path.join(run.runDir, "satellite.json"), JSON.stringify({
      schema_version: 1,
      digital_thread: {},
      provenance: {},
      satellite: { orbit: { keplerian_elements: { semi_major_axis_km: 6678.1363, eccentricity: 0, inclination_deg: 28.5 }, reference_epoch_tai_mod_julian: 31253.5 } },
      analysis_requests: { gmat: { chemical_3d_transfer: { final_altitude_km: 35786, final_inclination_deg: 0 } }, simu_cic: { attitude_mode: "nadir_pointing", ground_station_ids: [] } },
    }))
    await fs.writeFile(path.join(run.runDir, "run_manifest.json"), JSON.stringify({ templateId: "chemical-3d-transfer" }))

    const view = await buildRunViewModel(run)

    assert.equal(view.missionValues["initialOrbit.altitudeKm"], 300)
    assert.equal(view.missionValues["transfer.finalAltitudeKm"], 35786)
    assert.equal(view.missionValues["transfer.finalInclinationDeg"], 0)
  })
})
