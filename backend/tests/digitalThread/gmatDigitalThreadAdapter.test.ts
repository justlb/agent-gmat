import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { adaptDigitalThreadToGmat } from "../../src/digitalThread/gmatDigitalThreadAdapter.js"
import type { DigitalThreadDocument } from "../../src/digitalThread/digitalThreadStore.js"

function documentWithSolar(solarPanels: Record<string, number | string | null>): DigitalThreadDocument {
  return {
    schema_version: 1,
    digital_thread: { revision: 1 },
    provenance: { derivations: [], values: {} },
    satellite: {
      orbit: { reference_epoch_utc: "2026-08-15T00:00:00Z", reference_epoch_tai_mod_julian: null, keplerian_elements: { semi_major_axis_km: 6878, eccentricity: 0.0012, inclination_deg: 98.2, raan_deg: 45.7, arg_of_perigee_deg: 90, true_anomaly_deg: 123.4 } },
      bus: {
        physical: { mass_kg: { dry: 1250, propellant: 430 }, drag_area_m2: 2, drag_coefficient: 2.2 },
        propulsion_subsystem: { type: "Hall-effect electric propulsion", electric_thruster: { propellant_mass_kg: 430, minimum_usable_power_kw: 0.638, maximum_usable_power_kw: 7.266 } },
        electrical_subsystem: { solar_panels: solarPanels, spacecraft_bus_load_kw: 0.3, system_margin_percent: 5 },
      },
    },
    analysis_requests: { gmat: { electric_propulsion_transfer: { target_final_altitude_km: 550 }, orbit_keeping: {} } },
  }
}

describe("GMAT digital-thread adapter", () => {
  it("maps rated solar-array power and all transfer inputs", () => {
    const result = adaptDigitalThreadToGmat(documentWithSolar({ total_power_generated_watts: 8500 }), "electric-propulsion-transfer")
    assert.equal(result.ready, true)
    assert.equal(result.values["power.initialMaxPowerKw"], 8.5)
    assert.equal(result.values["power.busLoadKw"], 0.3)
    assert.equal(result.values["power.systemMarginPercent"], 5)
    assert.equal(result.values["spacecraft.dragAreaM2"], 2)
    assert.equal(result.values["spacecraft.dragCoefficient"], 2.2)
    assert.ok(result.derivations.some(item => item.output === "power.initialMaxPowerKw"))
  })

  it("derives solar power from area and efficiency when rated power is absent", () => {
    const result = adaptDigitalThreadToGmat(documentWithSolar({ total_power_generated_watts: null, total_area_m2: 10, efficiency_percent: 30 }), "electric-propulsion-transfer")
    assert.equal(result.values["power.initialMaxPowerKw"], 4.083)
  })

  it("uses mission orbit values before the selected satellite baseline", () => {
    const document = documentWithSolar({ total_power_generated_watts: 8500 })
    ;((document.analysis_requests.gmat.electric_propulsion_transfer as Record<string, unknown>).initial_orbit = {
      epoch_tai_mod_julian: "31270.25", semi_major_axis_km: 7300, eccentricity: 0.02, inclination_deg: 12, raan_deg: 1, arg_of_perigee_deg: 2, true_anomaly_deg: 3,
    })
    const result = adaptDigitalThreadToGmat(document, "electric-propulsion-transfer")
    assert.equal(result.values["initialOrbit.epoch"], "31270.25")
    assert.equal(result.values["initialOrbit.smaKm"], 7300)
    assert.equal(result.values["initialOrbit.inclinationDeg"], 12)
  })

  it("blocks execution when the solar model is incomplete", () => {
    const result = adaptDigitalThreadToGmat(documentWithSolar({ total_power_generated_watts: null, total_area_m2: null, efficiency_percent: 31.5 }), "electric-propulsion-transfer")
    assert.equal(result.ready, false)
    assert.ok(result.guards.some(guard => guard.code === "missing_solar_power_model"))
  })

  it("maps a chemical Hohmann-transfer request from the run-local digital thread", () => {
    const document = documentWithSolar({ total_power_generated_watts: 8500 })
    document.satellite.bus.propulsion_subsystem = {
      type: "Bipropellant chemical propulsion",
      specific_impulse_seconds: 320,
    }
    document.satellite.bus.physical = {
      mass_kg: { dry: 300, propellant: 100 },
      drag_area_m2: 2,
      drag_coefficient: 2.2,
    }
    ;((document.analysis_requests.gmat as Record<string, unknown>).chemical_hohmann_transfer = {
      initial_orbit: {
        epoch_tai_mod_julian: "31253.5", semi_major_axis_km: 6678.1363, eccentricity: 0, inclination_deg: 51.6,
        raan_deg: 0, arg_of_perigee_deg: 0, true_anomaly_deg: 0,
      },
      target_orbit: { radius_km: 7178.1363, eccentricity: 0.005 },
      final_propagation_seconds: 86400,
    })

    const result = adaptDigitalThreadToGmat(document, "chemical-hohmann-transfer")
    assert.equal(result.ready, true)
    assert.equal(result.values["transfer.targetRadiusKm"], 7178.1363)
    assert.equal(result.values["propulsion.ispSeconds"], 320)
    assert.equal(result.values["spacecraft.dragAreaM2"], 2)
  })
})
