import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { validateGmatMissionGuardrails } from "../../src/gmat/missionGuardrails.js"

describe("GMAT mission guardrails", () => {
  const earthOrbit = {
    "initialOrbit.eccentricity": 0,
    "initialOrbit.inclinationDeg": 45,
    "initialOrbit.smaKm": 6778.1363,
  }

  it("rejects impossible bound-orbit values", () => {
    const guards = validateGmatMissionGuardrails("electric-propulsion-transfer", {
      ...earthOrbit,
      "initialOrbit.eccentricity": 1,
      "initialOrbit.inclinationDeg": 181,
    })
    assert.ok(guards.some(guard => guard.code === "eccentricity_bounds"))
    assert.ok(guards.some(guard => guard.code === "inclination_bounds"))
  })

  it("limits orbit keeping to a safe LEO mission", () => {
    const guards = validateGmatMissionGuardrails("orbit-keeping", {
      ...earthOrbit,
      "initialOrbit.smaKm": 42164,
      "stationKeeping.minimumAltitudeKm": 300,
      "spacecraft.initialFuelMassKg": 101,
    })
    assert.ok(guards.some(guard => guard.code === "orbit_keeping_leo_only"))
    assert.ok(guards.some(guard => guard.code === "orbit_keeping_fuel_range"))
  })

  it("rejects incoherent electric power combinations", () => {
    const guards = validateGmatMissionGuardrails("electric-propulsion-transfer", {
      ...earthOrbit,
      "transfer.finalAltitudeKm": 500,
      "spacecraft.initialFuelMassKg": 2,
      "propulsion.minimumUsablePowerKw": 2,
      "propulsion.maximumUsablePowerKw": 1,
      "power.initialMaxPowerKw": 4.2,
      "power.busLoadKw": 3.5,
      "power.systemMarginPercent": 20,
    })
    assert.ok(guards.some(guard => guard.code === "thruster_power_range"))
    assert.ok(guards.some(guard => guard.code === "insufficient_initial_thrust_power"))
  })

  it("rejects an electric target altitude below the initial SMA-derived altitude", () => {
    const guards = validateGmatMissionGuardrails("electric-propulsion-transfer", {
      ...earthOrbit,
      "transfer.finalAltitudeKm": 300,
    })
    assert.ok(guards.some(guard => guard.code === "electric_altitude_order"))
  })

  it("enforces the LEO-to-GEO envelope for the Chemical 3D template", () => {
    const guards = validateGmatMissionGuardrails("chemical-3d-transfer", {
      "initialOrbit.altitudeKm": 2_500,
      "initialOrbit.eccentricity": 0,
      "initialOrbit.inclinationDeg": 28.5,
      "transfer.finalAltitudeKm": 20_000,
    })
    assert.ok(guards.some(guard => guard.code === "chemical_3d_initial_leo"))
    assert.ok(guards.some(guard => guard.code === "chemical_3d_target_altitude"))
  })
})
