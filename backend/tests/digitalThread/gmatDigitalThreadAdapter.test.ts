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
        physical: { mass_kg: { dry: 1250, propellant: 430 } },
        propulsion_subsystem: { type: "Hall-effect electric propulsion", electric_thruster: { propellant_mass_kg: 430, minimum_usable_power_kw: 0.638, maximum_usable_power_kw: 7.266 } },
        electrical_subsystem: { solar_panels: solarPanels, spacecraft_bus_load_kw: 0.3, system_margin_percent: 5 },
      },
    },
    analysis_requests: { gmat: { electric_propulsion_transfer: { burn_duration_days: 20 }, orbit_keeping: {} } },
  }
}

describe("GMAT digital-thread adapter", () => {
  it("maps rated solar-array power and all transfer inputs", () => {
    const result = adaptDigitalThreadToGmat(documentWithSolar({ total_power_generated_watts: 8500 }), "electric-propulsion-transfer")
    assert.equal(result.ready, true)
    assert.equal(result.values["power.initialMaxPowerKw"], 8.5)
    assert.equal(result.values["power.busLoadKw"], 0.3)
    assert.equal(result.values["power.systemMarginPercent"], 5)
    assert.ok(result.derivations.some(item => item.output === "power.initialMaxPowerKw"))
  })

  it("derives solar power from area and efficiency when rated power is absent", () => {
    const result = adaptDigitalThreadToGmat(documentWithSolar({ total_power_generated_watts: null, total_area_m2: 10, efficiency_percent: 30 }), "electric-propulsion-transfer")
    assert.equal(result.values["power.initialMaxPowerKw"], 4.083)
  })

  it("blocks execution when the solar model is incomplete", () => {
    const result = adaptDigitalThreadToGmat(documentWithSolar({ total_power_generated_watts: null, total_area_m2: null, efficiency_percent: 31.5 }), "electric-propulsion-transfer")
    assert.equal(result.ready, false)
    assert.ok(result.guards.some(guard => guard.code === "missing_solar_power_model"))
  })
})
