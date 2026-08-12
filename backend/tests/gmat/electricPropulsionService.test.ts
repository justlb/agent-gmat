import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { generateElectricPropulsionMission, summarizeElectricPropulsionExecution } from "../../src/gmat/electricPropulsion.service.js"
import { parseElectricPropulsionReport } from "../../src/gmat/electricPropulsionRunner.js"
import { defaultElectricPropulsionTemplatePath } from "../../src/gmat/electricPropulsionTemplate.js"
import { applyElectricPropulsionValueChanges, extractElectricPropulsionValues, renderElectricPropulsionValues } from "../../src/gmat/electricPropulsionValues.js"

describe("electric-propulsion transfer renderer", () => {
  it("preserves the fixed tutorial template byte-for-byte when no validated value changes are applied", async () => {
    const template = await fs.readFile(defaultElectricPropulsionTemplatePath(), "utf8")
    const values = extractElectricPropulsionValues(template)
    assert.equal(renderElectricPropulsionValues(template, values), template)
    assert.match(template, /DefaultSC\.ECC = 1\.279570234560536e-16;/u)
    assert.match(template, /DefaultSC\.INC = 0;/u)
    assert.match(template, /DefaultSC\.DryMass = 850;/u)
    assert.match(template, /ElectricTank1\.FuelMass = 756;/u)
    assert.match(template, /SolarPowerSystem1\.InitialMaxPower = 15;/u)
    assert.match(template, /Create EphemerisFile EphemerisFile1;/u)
    assert.match(template, /EphemerisFile1\.FileFormat = CCSDS-OEM;/u)
    assert.match(template, /DefaultProp_ForceModel\.GravityField\.Earth\.StmLimit = 100;/u)
  })

  it("parses the Keplerian report schema", () => {
    assert.deepEqual(parseElectricPropulsionReport("2 7191.938817629013 0.02454974900598137 12.85008005658097 306.6148021947984 314.1905515359921 99.8877493320488 755.5 1605.5 1.2\n"), [{
      elapsedDays: 2, semiMajorAxisKm: 7191.938817629013, eccentricity: 0.02454974900598137, inclinationDeg: 12.85008005658097,
      raanDeg: 306.6148021947984, argPeriapsisDeg: 314.1905515359921, trueAnomalyDeg: 99.8877493320488,
      fuelMassKg: 755.5, totalMassKg: 1605.5, powerAvailableKw: 1.2,
    }])
  })

  it("flags a completed run with no power eligible for thrust and no propellant use", () => {
    const result = summarizeElectricPropulsionExecution({
      completedAt: "2026-01-01T00:00:00.000Z", durationMs: 1, exitCode: 0, logPath: "gmat.log", reportPath: "ElectricTransferReport.txt", status: "completed",
      samples: [
        { elapsedDays: 0, semiMajorAxisKm: 7000, eccentricity: 0, inclinationDeg: 0, raanDeg: 0, argPeriapsisDeg: 0, trueAnomalyDeg: 0, fuelMassKg: 5, totalMassKg: 15, powerAvailableKw: 0.4983 },
        { elapsedDays: 2, semiMajorAxisKm: 7001, eccentricity: 0, inclinationDeg: 0, raanDeg: 0, argPeriapsisDeg: 0, trueAnomalyDeg: 1, fuelMassKg: 5, totalMassKg: 15, powerAvailableKw: 0 },
      ],
    }, 0.5)
    assert.equal(result.powerEligibleSampleCount, 0)
    assert.equal(result.fuelUsedBetweenReportsKg, 0)
    assert.ok(result.warnings?.some(warning => /No report sample reached/u.test(warning)))
    assert.ok(result.warnings?.some(warning => /Fuel mass did not change/u.test(warning)))
  })

  it("writes only validated changes and binds the GMAT report to the immutable run directory", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-electric-service-"))
    const template = await fs.readFile(defaultElectricPropulsionTemplatePath(), "utf8")
    const values = extractElectricPropulsionValues(template)
    const change = (context: string, value: string) => {
      const slot = context === "daysofpropagation"
        ? values.slots.find(candidate => candidate.context.startsWith("daysofpropagation ="))
        : values.slots.find(candidate => candidate.context.startsWith(`${context} =`))
      assert.ok(slot, `missing ${context}`)
      return { id: slot.id, value }
    }
    const result = await generateElectricPropulsionMission({
      artifactId: "test-mission", request: "validated transfer", workspaceDir,
      changes: [change("DefaultSC.Epoch", "'21545'"), change("DefaultSC.SMA", "7191.938817629013"), change("DefaultSC.ECC", "0.02454974900598137"), change("DefaultSC.INC", "12.85008005658097"), change("DefaultSC.DryMass", "850"), change("ElectricTank1.FuelMass", "756"), change("daysofpropagation", "2")],
    })
    const script = await fs.readFile(result.scriptPath, "utf8")
    assert.equal(result.result.status, "generated")
    assert.match(result.scriptPath, /gmat[\\/]electric-propulsion-transfer[\\/]test-mission[\\/]electric_propulsion_transfer\.script$/u)
    assert.match(script, /daysofpropagation\s*= 2/u)
    assert.match(script, /DefaultSC\.DisplayStateType\s*= Keplerian/u)
    assert.match(script, /DefaultSC\.SMA\s*= 7191\.938817629013/u)
    assert.match(script, /DefaultSC\.RAAN\s*= 0;/u)
    assert.match(script, /DefaultSC\.AOP\s*= 0;/u)
    assert.match(script, /DefaultSC\.TA\s*= 0;/u)
    assert.match(script, /ElectricTransferReport\.Filename\s*= '.*ElectricTransferReport\.txt';/u)
    assert.match(script, /ElectricTransferReport\.Add\s*= \{DefaultSC\.ElapsedDays, DefaultSC\.SMA,/u)
    assert.match(script, /EphemerisFile1\.Filename\s*= 'EphemerisFile1\.oem';/u)
    assert.match(result.ephemerisPath, /gmat[\\/]electric-propulsion-transfer[\\/]test-mission[\\/]EphemerisFile1\.oem$/u)
    assert.match(script, /DefaultSC\.SolarPowerSystem1\.ThrustPowerAvailable/u)
    await fs.access(result.valuesPath)
    await fs.access(result.manifestPath)
    const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8")) as { templateSha256?: unknown }
    assert.match(String(manifest.templateSha256), /^[a-f0-9]{64}$/u)
  })

  it("calibrates the generated script from the selected satellite without modifying the reference template", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-electric-calibration-"))
    await fs.writeFile(path.join(workspaceDir, "satellite.json"), JSON.stringify({
      satellite: { bus: { propulsion_subsystem: {
        nominal_thrust_newtons: 0.01,
        nominal_duty_cycle: 0.25,
        specific_impulse_seconds: 1600,
        electric_thruster: { nominal_thruster_power_kw: 1 },
      } } },
    }), "utf8")
    const template = await fs.readFile(defaultElectricPropulsionTemplatePath(), "utf8")
    const values = extractElectricPropulsionValues(template)
    const duration = values.slots.find(slot => slot.context.startsWith("daysofpropagation ="))
    assert.ok(duration)
    const result = await generateElectricPropulsionMission({
      artifactId: "calibrated", request: "calibrated transfer", workspaceDir,
      changes: [{ id: duration.id, value: "21" }],
    })
    const generatedScript = await fs.readFile(result.scriptPath, "utf8")
    const calibration = JSON.parse(await fs.readFile(path.join(result.runDir, "electric_propulsion_calibration.json"), "utf8")) as { dutyCycle: number; fixedEfficiency: number; ispSeconds: number; nominalPowerKw: number; nominalThrustNewtons: number }
    assert.match(generatedScript, /ElectricThruster1\.ThrustModel = FixedEfficiency;/u)
    assert.match(generatedScript, /ElectricThruster1\.Isp = 1600;/u)
    assert.match(generatedScript, /ElectricThruster1\.FixedEfficiency = 0\.3138128;/u)
    assert.match(generatedScript, /ElectricThruster1\.DutyCycle = 0\.25;/u)
    assert.equal(calibration.nominalThrustNewtons, 0.01)
    assert.equal(calibration.nominalPowerKw, 1)
    assert.equal(calibration.dutyCycle, 0.25)
    assert.equal(calibration.fixedEfficiency, 0.3138128)
    assert.equal(calibration.ispSeconds, 1600)
    assert.equal(await fs.readFile(defaultElectricPropulsionTemplatePath(), "utf8"), template)
  })

  it("rejects a patch that tries to change the fixed report structure", async () => {
    const template = await fs.readFile(defaultElectricPropulsionTemplatePath(), "utf8")
    const values = extractElectricPropulsionValues(template)
    const reportSlot = values.slots.find(slot => slot.context.startsWith("ElectricTransferReport.Add ="))
    assert.ok(reportSlot)
    assert.throws(() => applyElectricPropulsionValueChanges(values, [{ id: reportSlot.id, value: "3" }]), /fixed report structure/u)
  })
})
