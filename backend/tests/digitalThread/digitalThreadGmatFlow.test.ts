import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { adaptDigitalThreadToGmat, syncDigitalThreadFromGmatDraft } from "../../src/digitalThread/gmatDigitalThreadAdapter.js"
import { draftDigitalThreadWorkspaceDir, initializeDraftDigitalThread, loadOrCreateDigitalThread, saveDigitalThread, updateDigitalThread } from "../../src/digitalThread/digitalThreadStore.js"
import { createPlanningRun } from "../../src/runs/missionRunService.js"
import { getSatelliteDefinition, selectSatelliteDefinition } from "../../src/digitalThread/satelliteLibrary.js"

describe("digital thread to GMAT flow", () => {
  it("serializes simultaneous source-of-truth updates without losing either field", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "digital-thread-concurrent-update-"))
    try {
      await Promise.all([
        updateDigitalThread(workspaceDir, document => { document.analysis_requests.simu_cic = { attitude_mode: "nadir_pointing", ground_station_ids: [], simultaneous_visibility_policy: null } }),
        updateDigitalThread(workspaceDir, document => { document.digital_thread.satellite_definition = { id: "test-satellite", version: "1.0.0" } }),
      ])
      const saved = await loadOrCreateDigitalThread(workspaceDir)
      assert.equal((saved.digital_thread.satellite_definition as { id?: string }).id, "test-satellite")
      assert.equal((saved.analysis_requests.simu_cic as { attitude_mode?: string }).attitude_mode, "nadir_pointing")
      assert.equal(Number(saved.digital_thread.revision), 2)
    } finally { await fs.rm(workspaceDir, { force: true, recursive: true }) }
  })

  it("starts empty, applies the selected satellite, and preserves satellite values while recording mission values", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "digital-thread-gmat-flow-"))

    const empty = await loadOrCreateDigitalThread(workspaceDir)
    assert.equal(empty.satellite.bus.physical.mass_kg.dry, null)
    assert.equal(empty.digital_thread.satellite_definition, undefined)

    await selectSatelliteDefinition(workspaceDir, "ref-starlink-v1-5-public-rf", "1.0.0")
    const selected = await loadOrCreateDigitalThread(workspaceDir)
    assert.equal(selected.satellite.bus.physical.mass_kg.dry, 296)
    assert.match(String(selected.satellite.bus.propulsion_subsystem.type), /Krypton Hall-effect/u)
    assert.equal(selected.satellite.bus.electrical_subsystem.solar_panels.total_power_generated_watts, 4200)

    const satelliteBaseline = adaptDigitalThreadToGmat(selected, "electric-propulsion-transfer")
    assert.equal(satelliteBaseline.values["spacecraft.dryMassKg"], 296)
    assert.equal(satelliteBaseline.values["spacecraft.initialFuelMassKg"], 10)
    assert.equal(satelliteBaseline.values["power.initialMaxPowerKw"], 4.2)
    assert.equal(satelliteBaseline.values["power.busLoadKw"], 2.8, "electric-propulsion mission allocation takes precedence over nominal bus load")

    await syncDigitalThreadFromGmatDraft(workspaceDir, {
      templateId: "electric-propulsion-transfer",
      values: {
        ...satelliteBaseline.values,
        "initialOrbit.smaKm": 7300,
        "transfer.finalAltitudeKm": 800,
      },
    })

    const afterMission = await loadOrCreateDigitalThread(workspaceDir)
    assert.equal(afterMission.satellite.bus.physical.mass_kg.dry, 296, "a mission must not alter the selected satellite dry mass")
    assert.equal(afterMission.satellite.bus.propulsion_subsystem.electric_thruster.propellant_mass_kg, 10, "a mission must not alter satellite propellant capacity")
    assert.equal(afterMission.analysis_requests.gmat.electric_propulsion_transfer.initial_orbit.semi_major_axis_km, 7300)
    assert.equal(afterMission.analysis_requests.gmat.electric_propulsion_transfer.target_final_altitude_km, 800)

    const missionValues = adaptDigitalThreadToGmat(afterMission, "electric-propulsion-transfer")
    assert.equal(missionValues.values["initialOrbit.smaKm"], 7300, "mission orbit takes precedence over the satellite reference orbit")
    assert.equal(missionValues.values["transfer.finalAltitudeKm"], 800)
    assert.equal(missionValues.values["spacecraft.dryMassKg"], 296, "satellite mass is still used to build the GMAT YAML")
  })

  it("isolates each GMAT draft while retaining the selected satellite", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "digital-thread-draft-isolation-"))
    await selectSatelliteDefinition(workspaceDir, "ref-starlink-v1-5-public-rf", "1.0.0")

    const firstWorkspace = draftDigitalThreadWorkspaceDir(workspaceDir, "electric-propulsion-transfer", "draft_first")
    const first = await initializeDraftDigitalThread(workspaceDir, "electric-propulsion-transfer", "draft_first")
    assert.equal(first.satellite.bus.physical.mass_kg.dry, 296)
    assert.equal(first.analysis_requests.gmat.electric_propulsion_transfer.target_final_altitude_km, null)
    first.analysis_requests.gmat.electric_propulsion_transfer.target_final_altitude_km = 800
    await saveDigitalThread(firstWorkspace, first)

    const secondWorkspace = draftDigitalThreadWorkspaceDir(workspaceDir, "electric-propulsion-transfer", "draft_second")
    const second = await initializeDraftDigitalThread(workspaceDir, "electric-propulsion-transfer", "draft_second")
    assert.notEqual(first.digital_thread.thread_id, second.digital_thread.thread_id)
    assert.equal(second.satellite.bus.physical.mass_kg.dry, 296)
    assert.equal(second.analysis_requests.gmat.electric_propulsion_transfer.target_final_altitude_km, null)
    assert.equal((await loadOrCreateDigitalThread(secondWorkspace)).analysis_requests.gmat.electric_propulsion_transfer.target_final_altitude_km, null)
  })

  it("keeps satellite physical values owned by satellite.json when a draft is synchronized", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "digital-thread-satellite-owned-"))
    await selectSatelliteDefinition(workspaceDir, "ref-starlink-v1-5-public-rf", "1.0.0")
    const baseline = await loadOrCreateDigitalThread(workspaceDir)
    const seed = adaptDigitalThreadToGmat(baseline, "electric-propulsion-transfer")

    await syncDigitalThreadFromGmatDraft(workspaceDir, {
      templateId: "electric-propulsion-transfer",
      values: {
        ...seed.values,
        "spacecraft.dryMassKg": 320,
        "spacecraft.initialFuelMassKg": 8,
        "power.initialMaxPowerKw": 5,
        "power.busLoadKw": 2.4,
      },
    })

    const synchronized = await loadOrCreateDigitalThread(workspaceDir)
    assert.equal(synchronized.satellite.bus.physical.mass_kg.dry, 296)
    assert.equal(synchronized.satellite.bus.electrical_subsystem.solar_panels.total_power_generated_watts, 4200)

    const adapted = adaptDigitalThreadToGmat(synchronized, "electric-propulsion-transfer")
    assert.equal(adapted.values["spacecraft.dryMassKg"], seed.values["spacecraft.dryMassKg"])
    assert.equal(adapted.values["spacecraft.initialFuelMassKg"], seed.values["spacecraft.initialFuelMassKg"])
    assert.equal(adapted.values["power.initialMaxPowerKw"], seed.values["power.initialMaxPowerKw"])
    assert.equal(adapted.values["power.busLoadKw"], seed.values["power.busLoadKw"])
  })
  it("replaces the complete physical definition when the user changes satellite", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "digital-thread-satellite-switch-"))
    await selectSatelliteDefinition(workspaceDir, "ref-starlink-v1-5-public-rf", "1.0.0")
    await selectSatelliteDefinition(workspaceDir, "ref-leo-orbit-keeping", "1.0.0")

    const selected = await loadOrCreateDigitalThread(workspaceDir)
    assert.equal((selected.digital_thread.satellite_definition as { id?: unknown } | undefined)?.id, "ref-leo-orbit-keeping")
    assert.equal(selected.satellite.bus.physical.mass_kg.dry, 300)
    assert.equal(selected.satellite.bus.propulsion_subsystem.electric_thruster, undefined)
  })

  it("creates an empty satellite.json at the beginning of a planning run", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "digital-thread-planning-run-"))
    const planningRun = await createPlanningRun(workspaceDir)
    const document = await loadOrCreateDigitalThread(planningRun.workspaceDir)

    assert.match(planningRun.planningRunId, /^\d{2}-\d{2}-\d{2}_\d{2}-\d{2}/u)
    assert.equal(document.satellite.bus.physical.mass_kg.dry, null)
    assert.equal(document.digital_thread.satellite_definition, undefined)
    await fs.access(path.join(planningRun.workspaceDir, "satellite.json"))
    await fs.access(path.join(planningRun.workspaceDir, "conversation.json"))
    await fs.access(path.join(planningRun.workspaceDir, "run_manifest.json"))
    await fs.access(path.join(planningRun.workspaceDir, "workflow-status.json"))
  })

  it("never carries a satellite or Simu-CIC configuration from an earlier planning run", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "digital-thread-planning-selection-"))
    const previousRun = await createPlanningRun(workspaceDir)
    await selectSatelliteDefinition(previousRun.workspaceDir, "ref-starlink-v1-5-public-rf", "1.0.0")
    const previous = await loadOrCreateDigitalThread(previousRun.workspaceDir)
    previous.analysis_requests.simu_cic = {
      attitude_mode: "ground_station_tracking",
      ground_station_ids: ["bremen"],
      simultaneous_visibility_policy: "first_visible_station_wins",
    }
    await saveDigitalThread(previousRun.workspaceDir, previous)
    const nextRun = await createPlanningRun(workspaceDir)
    const document = await loadOrCreateDigitalThread(nextRun.workspaceDir)

    assert.equal(document.digital_thread.satellite_definition, undefined)
    assert.equal(document.satellite.bus.physical.mass_kg.dry, null)
    assert.equal(document.analysis_requests.simu_cic.attitude_mode, "nadir_pointing")
    assert.deepEqual(document.analysis_requests.simu_cic.ground_station_ids, [])
    await assert.rejects(fs.access(path.join(workspaceDir, "digital-thread", "satellite.json")))
  })
})
