import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { adaptDigitalThreadToRFComlink } from "../../src/rfComlink/rfComlinkDigitalThreadAdapter.js"
import type { DigitalThreadDocument } from "../../src/digitalThread/digitalThreadStore.js"

function documentWithRFLink(): DigitalThreadDocument {
  return {
    schema_version: 1,
    digital_thread: {},
    provenance: {},
    satellite: { bus: { rf_comlink: { links: [{ id: "housekeeping", name: "Housekeeping telemetry", direction: "SpaceEarth", requires_ground_station_tracking: true, spacecraft_antenna: { boresight_body_axis: "+Z" }, system: { frequency_band: "S", frequency_mhz: 2200 } }] } },
    analysis_requests: { simu_cic: { attitude_mode: "ground_station_tracking", ground_station_ids: ["kourou"] }, rf_comlink: { selected_ground_station_id: "kourou" } },
  }
}

describe("RF-COMLINK digital-thread contract", () => {
  it("does not fabricate a link when a satellite has no RF definition", () => {
    const document = documentWithRFLink()
    document.satellite.bus.rf_comlink.links = []
    const adapted = adaptDigitalThreadToRFComlink(document)
    assert.equal(adapted.validation.status, "blocked")
    assert.deepEqual(adapted.links, [])
    assert.ok(adapted.validation.missing.includes("satellite.bus.rf_comlink.links"))
  })

  it("accepts a declared link only when its selected station is configured for Simu-CIC", () => {
    const adapted = adaptDigitalThreadToRFComlink(documentWithRFLink())
    assert.equal(adapted.validation.status, "ready")
    assert.deepEqual(adapted.links, [{ id: "housekeeping", name: "Housekeeping telemetry", direction: "SpaceEarth", requiresGroundStationTracking: true }])
    assert.equal(adapted.selectedGroundStationId, "kourou")
  })

  it("blocks a directional RF link when Simu-CIC is not configured to track a station", () => {
    const document = documentWithRFLink()
    document.analysis_requests.simu_cic.attitude_mode = "nadir_pointing"
    const adapted = adaptDigitalThreadToRFComlink(document)
    assert.equal(adapted.validation.status, "blocked")
    assert.ok(adapted.validation.missing.includes("analysis_requests.simu_cic.attitude_mode=ground_station_tracking"))
  })
})
