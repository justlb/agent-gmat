import assert from "node:assert/strict"
import { describe, it } from "node:test"

import { parseElectricPropulsionReport } from "../../src/gmat/electricPropulsionRunner.js"

describe("electric-propulsion report parser", () => {
  it("keeps numeric samples while ignoring GMAT headers, blank lines, and malformed rows", () => {
    const report = [
      "GMAT ReportFile: ElectricTransferReport",
      "ElapsedDays SMA ECC INC RAAN AOP TA FuelMass TotalMass ThrustPowerAvailable MassFlowRate",
      "",
      "0 6678 0 15 0 0 0 5 15 1.2 -0.0000013",
      "this is not a GMAT data row",
      "2 6680.2 0.0001 15 0 0 1.1 4.9 14.9 1.15 -0.0000011",
      "3 6681", // incomplete row
    ].join("\n")

    assert.deepEqual(parseElectricPropulsionReport(report), [
      { elapsedDays: 0, semiMajorAxisKm: 6678, eccentricity: 0, inclinationDeg: 15, raanDeg: 0, argPeriapsisDeg: 0, trueAnomalyDeg: 0, fuelMassKg: 5, totalMassKg: 15, powerAvailableKw: 1.2, massFlowRateKgPerSec: -0.0000013 },
      { elapsedDays: 2, semiMajorAxisKm: 6680.2, eccentricity: 0.0001, inclinationDeg: 15, raanDeg: 0, argPeriapsisDeg: 0, trueAnomalyDeg: 1.1, fuelMassKg: 4.9, totalMassKg: 14.9, powerAvailableKw: 1.15, massFlowRateKgPerSec: -0.0000011 },
    ])
  })

  it("continues to read reports generated before mass-flow reporting was added", () => {
    const report = "0 6678 0 15 0 0 0 5 15 1.2"

    assert.deepEqual(parseElectricPropulsionReport(report), [
      { elapsedDays: 0, semiMajorAxisKm: 6678, eccentricity: 0, inclinationDeg: 15, raanDeg: 0, argPeriapsisDeg: 0, trueAnomalyDeg: 0, fuelMassKg: 5, totalMassKg: 15, powerAvailableKw: 1.2 },
    ])
  })
})
