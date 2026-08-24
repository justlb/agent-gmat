import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { validateDigitalThreadDocument } from "../../src/digitalThread/digitalThreadSchema.js"

const valid = {
  schema_version: 1,
  digital_thread: {},
  satellite: { orbit: { keplerian_elements: { eccentricity: 0, semi_major_axis_km: null } } },
  analysis_requests: { simu_cic: { attitude_mode: "nadir_pointing", ground_station_ids: [] }, rf_comlink: { selected_ground_station_id: null } },
  provenance: {},
}

describe("digital thread runtime schema", () => {
  it("accepts a minimal valid per-run document", () => {
    assert.deepEqual(validateDigitalThreadDocument(valid), [])
  })

  it("rejects malformed orbital and Simu-CIC values before a tool can run", () => {
    const invalid = structuredClone(valid)
    invalid.satellite.orbit.keplerian_elements.eccentricity = 1.2
    invalid.analysis_requests.simu_cic.attitude_mode = "bremen"
    assert.match(validateDigitalThreadDocument(invalid).join("\n"), /eccentricity must be in \[0, 1\)/)
    assert.match(validateDigitalThreadDocument(invalid).join("\n"), /attitude_mode must be nadir_pointing or ground_station_tracking/)
  })

  it("rejects physically impossible orbit, power and attitude combinations", () => {
    const invalid = structuredClone(valid) as typeof valid & {
      satellite: typeof valid.satellite & { bus: Record<string, unknown> }
      analysis_requests: typeof valid.analysis_requests & { rf_comlink: { selected_ground_station_id: string | null }; simu_cic: { attitude_mode: string; ground_station_ids: string[] } }
    }
    invalid.satellite.orbit.keplerian_elements.semi_major_axis_km = 6300
    invalid.satellite.bus = {
      propulsion_subsystem: { electric_thruster: { minimum_usable_power_kw: 5, maximum_usable_power_kw: 2 } },
      electrical_subsystem: { solar_panels: { efficiency_percent: 130 } },
    }
    invalid.analysis_requests.simu_cic = { attitude_mode: "ground_station_tracking", ground_station_ids: ["kourou"] }
    invalid.analysis_requests.rf_comlink.selected_ground_station_id = "kiruna"
    const errors = validateDigitalThreadDocument(invalid).join("\n")
    assert.match(errors, /semi_major_axis_km must be above/)
    assert.match(errors, /minimum usable power must not exceed/)
    assert.match(errors, /efficiency_percent must be in/)
    assert.match(errors, /selected ground station must be tracked/)
  })

  it("rejects ground stations attached to nadir pointing", () => {
    const invalid = structuredClone(valid)
    invalid.analysis_requests.simu_cic.ground_station_ids = ["bremen"]
    assert.match(validateDigitalThreadDocument(invalid).join("\n"), /nadir pointing must not define ground stations/)
  })
})
