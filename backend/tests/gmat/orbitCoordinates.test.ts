import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { cartesianToKeplerian, keplerianToCartesian, semiMajorAxisFromPeriapsisAltitude } from "../../src/gmat/orbitCoordinates.js"

function assertClose(actual: number, expected: number, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`)
}

describe("Earth Keplerian and Cartesian coordinate conversions", () => {
  it("derives semi-major axis from perigee altitude and eccentricity", () => {
    assertClose(semiMajorAxisFromPeriapsisAltitude(500, 0.1), 7642.373666666667)
  })

  it("round-trips non-degenerate Keplerian elements through Cartesian coordinates", () => {
    const elements = {
      semiMajorAxisKm: 7191.938817629013,
      eccentricity: 0.02454974900598137,
      inclinationDeg: 12.85008005658097,
      raanDeg: 306.6148021947984,
      argPeriapsisDeg: 314.1905515359921,
      trueAnomalyDeg: 99.8877493320488,
    }
    const recovered = cartesianToKeplerian(keplerianToCartesian(elements))
    assertClose(recovered.semiMajorAxisKm, elements.semiMajorAxisKm)
    assertClose(recovered.eccentricity, elements.eccentricity)
    assertClose(recovered.inclinationDeg, elements.inclinationDeg)
    assertClose(recovered.raanDeg, elements.raanDeg)
    assertClose(recovered.argPeriapsisDeg, elements.argPeriapsisDeg)
    assertClose(recovered.trueAnomalyDeg, elements.trueAnomalyDeg)
  })
})
