import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { adaptDigitalThreadToGmat, syncDigitalThreadFromGmatDraft } from "../../src/digitalThread/gmatDigitalThreadAdapter.js"
import { loadOrCreateDigitalThread } from "../../src/digitalThread/digitalThreadStore.js"
import { selectSatelliteDefinition } from "../../src/digitalThread/satelliteLibrary.js"

describe("digital thread to GMAT flow", () => {
  it("starts empty, applies the selected satellite, and preserves satellite values while recording mission values", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "digital-thread-gmat-flow-"))

    const empty = await loadOrCreateDigitalThread(workspaceDir)
    assert.equal(empty.satellite.bus.physical.mass_kg.dry, null)
    assert.equal(empty.digital_thread.satellite_definition, undefined)

    await selectSatelliteDefinition(workspaceDir, "ref-leo-electric", "1.0.0")
    const selected = await loadOrCreateDigitalThread(workspaceDir)
    assert.equal(selected.satellite.bus.physical.mass_kg.dry, 850)
    assert.equal(selected.satellite.bus.propulsion_subsystem.type, "Electric propulsion")
    assert.equal(selected.satellite.bus.electrical_subsystem.solar_panels.total_power_generated_watts, 15000)

    const satelliteBaseline = adaptDigitalThreadToGmat(selected, "electric-propulsion-transfer")
    assert.equal(satelliteBaseline.ready, true)
    assert.equal(satelliteBaseline.values["spacecraft.dryMassKg"], 850)
    assert.equal(satelliteBaseline.values["spacecraft.initialFuelMassKg"], 756)
    assert.equal(satelliteBaseline.values["power.initialMaxPowerKw"], 15)
    assert.equal(satelliteBaseline.values["power.busLoadKw"], 1.5)

    await syncDigitalThreadFromGmatDraft(workspaceDir, {
      templateId: "electric-propulsion-transfer",
      values: {
        ...satelliteBaseline.values,
        "initialOrbit.smaKm": 7300,
        "transfer.burnDurationDays": 7,
      },
    })

    const afterMission = await loadOrCreateDigitalThread(workspaceDir)
    assert.equal(afterMission.satellite.bus.physical.mass_kg.dry, 850, "a mission must not alter the selected satellite dry mass")
    assert.equal(afterMission.satellite.bus.propulsion_subsystem.electric_thruster.propellant_mass_kg, 756, "a mission must not alter satellite propellant capacity")
    assert.equal(afterMission.analysis_requests.gmat.electric_propulsion_transfer.initial_orbit.semi_major_axis_km, 7300)
    assert.equal(afterMission.analysis_requests.gmat.electric_propulsion_transfer.burn_duration_days, 7)

    const missionValues = adaptDigitalThreadToGmat(afterMission, "electric-propulsion-transfer")
    assert.equal(missionValues.values["initialOrbit.smaKm"], 7300, "mission orbit takes precedence over the satellite reference orbit")
    assert.equal(missionValues.values["transfer.burnDurationDays"], 7)
    assert.equal(missionValues.values["spacecraft.dryMassKg"], 850, "satellite mass is still used to build the GMAT YAML")
  })
})
