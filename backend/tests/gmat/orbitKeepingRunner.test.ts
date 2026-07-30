import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { parseOrbitKeepingReport, parseOrbitKeepingTimeSeriesReport, toGmatNativePath } from "../../src/gmat/orbitKeepingRunner.js"

describe("orbit keeping GMAT runner", () => {
  it("parses numeric report rows and ignores the header", () => {
    const samples = parseOrbitKeepingReport([
      "DefaultSC.A1ModJulian DefaultSC.ChemicalTank1.FuelMass DefaultSC.Earth.Altitude",
      "30123.5 199.2 190.0",
      "30124.5 198.8 201.4",
    ].join("\n"))
    assert.deepEqual(samples, [
      { altitudeKm: 190, epochA1ModJulian: 30123.5, fuelMassKg: 199.2 },
      { altitudeKm: 201.4, epochA1ModJulian: 30124.5, fuelMassKg: 198.8 },
    ])
  })

  it("parses the fixed engineering time-series report schema", () => {
    const samples = parseOrbitKeepingTimeSeriesReport([
      "epoch altitude fuel total sma ecc inc",
      "30123.5 190.0 199.2 499.2 6578.1 0.001 98.5",
    ].join("\n"))
    assert.deepEqual(samples, [{
      altitudeKm: 190,
      eccentricity: 0.001,
      epochA1ModJulian: 30123.5,
      fuelMassKg: 199.2,
      inclinationDeg: 98.5,
      semiMajorAxisKm: 6578.1,
      totalMassKg: 499.2,
    }])
  })

  it("converts a WSL path for the Windows GMAT executable", () => {
    assert.equal(
      toGmatNativePath("/mnt/c/JUSTINE/APP/run/orbit_keeping.script"),
      "C:\\JUSTINE\\APP\\run\\orbit_keeping.script",
    )
  })
})
