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
    await fs.mkdir(path.join(run.runDir, "opalis", "02-simu-cic", "00-scenario-input"), { recursive: true })
    await fs.writeFile(path.join(run.runDir, "opalis", "02-simu-cic", "00-scenario-input", "simucic-input.scd"), "prepared")
    await fs.mkdir(path.join(run.runDir, "opalis", "02-simu-cic", "01-execution-complete"), { recursive: true })
    await fs.writeFile(path.join(run.runDir, "opalis", "02-simu-cic", "01-execution-complete", "run_123.scd"), "executed")

    const view = await buildRunViewModel(run)

    assert.equal(view.missionValues["initialOrbit.smaKm"], 6678.1363)
    assert.equal(view.missionValues["initialOrbit.altitudeKm"], 300)
    assert.equal(view.missionValues["spacecraft.initialFuelMassKg"], 5)
    assert.deepEqual(view.simuCic.ground_station_ids, ["kourou"])
    assert.equal(view.artifacts.some(artifact => artifact.id === "gmat-ephemeris"), true)
    assert.equal(view.artifacts.some(artifact => artifact.relativePath.includes("00-scenario-input")), false)
    assert.equal(view.artifacts.some(artifact => artifact.relativePath.endsWith("01-execution-complete/run_123.scd")), true)
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

  it("restores the required electrical LEO maintenance threshold from the run snapshot", async () => {
    await fs.writeFile(path.join(run.runDir, "satellite.json"), JSON.stringify({
      schema_version: 1,
      digital_thread: {},
      provenance: {},
      satellite: { orbit: { keplerian_elements: { semi_major_axis_km: 6628.1363, eccentricity: 0, inclination_deg: 0 }, reference_epoch_tai_mod_julian: 31253.5 }, bus: { physical: { mass_kg: { dry: 300 } } } },
      analysis_requests: { gmat: { electrical_leo_orbit_maintenance: { minimum_reboost_altitude_km: 230 } }, simu_cic: { attitude_mode: "nadir_pointing", ground_station_ids: [] } },
    }))
    await fs.writeFile(path.join(run.runDir, "run_manifest.json"), JSON.stringify({ templateId: "electrical-leo-orbit-maintenance" }))

    const view = await buildRunViewModel(run)

    assert.equal(view.missionValues["initialOrbit.altitudeKm"], 250)
    assert.equal(view.missionValues["initialOrbit.eccentricity"], 0)
    assert.equal(view.missionValues["initialOrbit.inclinationDeg"], 0)
    assert.equal(view.missionValues["stationKeeping.minimumAltitudeKm"], 230)
  })

  it("reports the orbit-keeping duration and fuel consumed from GMAT elapsed seconds", async () => {
    await fs.writeFile(path.join(run.runDir, "satellite.json"), JSON.stringify({
      schema_version: 1,
      digital_thread: {},
      provenance: {},
      satellite: { orbit: { keplerian_elements: { semi_major_axis_km: 6678.1363, eccentricity: 0, inclination_deg: 51.6 }, reference_epoch_tai_mod_julian: 31253.5 }, bus: { physical: { mass_kg: { dry: 300 } } } },
      analysis_requests: { gmat: { orbit_keeping: { initial_fuel_mass_kg: 10 } }, simu_cic: { attitude_mode: "nadir_pointing", ground_station_ids: [] } },
    }))
    await fs.writeFile(path.join(run.runDir, "run_manifest.json"), JSON.stringify({ templateId: "orbit-keeping" }))
    await fs.writeFile(path.join(run.runDir, "workflow-status.json"), JSON.stringify({ stages: { gmat: { status: "completed" }, simu_cic: { status: "not_started" }, opalis: { status: "not_started" }, rf_comlink: { status: "not_started" } } }))
    // OrbitAnalysisReport begins with DefaultSC.ElapsedSecs. The old JSON key
    // was epochA1ModJulian, so this also protects historical run artifacts.
    await fs.writeFile(path.join(run.runDir, "orbit_timeseries.json"), JSON.stringify([
      { epochA1ModJulian: 390348.6928020953, altitudeKm: 274.722, fuelMassKg: 6.5187, totalMassKg: 306.5187, semiMajorAxisKm: 6652.8583, eccentricity: 0, inclinationDeg: 51.6 },
      { epochA1ModJulian: 1324157.231627649, altitudeKm: 277.283, fuelMassKg: 3.017656, totalMassKg: 303.017656, semiMajorAxisKm: 6655.4193, eccentricity: 0, inclinationDeg: 51.6 },
    ]))

    const view = await buildRunViewModel(run)

    assert.equal(view.overview.simulatedMissionDuration?.value, "15.33 days")
    assert.equal(view.overview.fuelMassConsumed?.value, "6.982 kg")
    assert.match(view.overview.terminationCondition?.value ?? "", /orbit-keeping loop/u)
  })

  it("reports the Hohmann simulated mission duration at the GOI burn, ignoring the post-transfer sampling window", async () => {
    await fs.writeFile(path.join(run.runDir, "satellite.json"), JSON.stringify({
      schema_version: 1,
      digital_thread: {},
      provenance: {},
      satellite: { orbit: { keplerian_elements: { semi_major_axis_km: 6678.1363, eccentricity: 0, inclination_deg: 25 }, reference_epoch_tai_mod_julian: 31253.5 }, bus: { physical: { mass_kg: { dry: 300 } } } },
      analysis_requests: { gmat: { chemical_hohmann_transfer: { target_orbit: { radius_km: 7025, eccentricity: 0.005 } } }, simu_cic: { attitude_mode: "nadir_pointing", ground_station_ids: [] } },
    }))
    await fs.writeFile(path.join(run.runDir, "run_manifest.json"), JSON.stringify({ templateId: "chemical-hohmann-transfer" }))
    await fs.writeFile(path.join(run.runDir, "workflow-status.json"), JSON.stringify({ stages: { gmat: { status: "completed" }, simu_cic: { status: "not_started" }, opalis: { status: "not_started" }, rf_comlink: { status: "not_started" } } }))
    // TOI burn at 0.032 d, GOI burn at 0.064 d, then the 1-day sampling tail (must be ignored).
    await fs.writeFile(path.join(run.runDir, "chemical_hohmann_timeseries.json"), JSON.stringify([
      { elapsedDays: 0, altitudeKm: 300, fuelMassKg: 100 },
      { elapsedDays: 0.032, altitudeKm: 280, fuelMassKg: 96.37 },
      { elapsedDays: 0.064, altitudeKm: 400, fuelMassKg: 90.37 },
      { elapsedDays: 1.063, altitudeKm: 447, fuelMassKg: 90.37 },
    ]))

    const view = await buildRunViewModel(run)

    assert.equal(view.overview.simulatedMissionDuration?.value, "1.54 h")
    assert.match(view.overview.terminationCondition?.value ?? "", /GOI burn/u)
  })
})
