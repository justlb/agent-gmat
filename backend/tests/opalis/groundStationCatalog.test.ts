import assert from "node:assert/strict"
import { describe, it } from "node:test"

import {
  PREDEFINED_GROUND_STATIONS,
  assertValidSimuCicRequest,
  getPredefinedGroundStation,
} from "../../src/opalis/groundStationCatalog.js"

describe("Simu-CIC predefined ground-station catalogue", () => {
  it("contains the 65 stations exported by Simu-CIC", () => {
    assert.equal(PREDEFINED_GROUND_STATIONS.length, 65)
    assert.deepEqual(getPredefinedGroundStation("kourou"), {
      id: "kourou",
      name: "Kourou",
      longitudeDeg: -52.64,
      latitudeDeg: 5.1,
      altitudeM: 94,
      minElevationDeg: 0,
    })
    assert.equal(getPredefinedGroundStation("aussaguel")?.latitudeDeg, 43.43)
  })

  it("accepts only unique identifiers from the fixed catalogue", () => {
    assert.doesNotThrow(() => assertValidSimuCicRequest({
      attitude_mode: "ground_station_tracking",
      ground_station_ids: ["kourou", "aussaguel"],
      simultaneous_visibility_policy: "first_visible_station_wins",
    }))
    assert.throws(() => assertValidSimuCicRequest({
      attitude_mode: "ground_station_tracking",
      ground_station_ids: ["custom-station"],
      simultaneous_visibility_policy: null,
    }), /unknown predefined Simu-CIC ground station/u)
    assert.throws(() => assertValidSimuCicRequest({
      attitude_mode: "ground_station_tracking",
      ground_station_ids: ["kourou", "kourou"],
      simultaneous_visibility_policy: null,
    }), /same station twice/u)
  })
})
