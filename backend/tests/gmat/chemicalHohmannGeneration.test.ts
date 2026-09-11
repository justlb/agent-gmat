import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

import { addHohmannEphemerisWriter, parseChemicalHohmannReport, renderChemicalHohmannScript } from "../../src/gmat/chemicalHohmann.service.js"
import { defaultChemicalHohmannTemplatePath } from "../../src/gmat/chemicalHohmannTemplate.js"

test("chemical Hohmann renderer changes only declared GMAT slots", async () => {
  const template = await fs.readFile(defaultChemicalHohmannTemplatePath(), "utf8")
  const rendered = renderChemicalHohmannScript(template, {
    "initialOrbit.epoch": "31253.5", "initialOrbit.smaKm": 6678.1363, "initialOrbit.eccentricity": 0, "initialOrbit.inclinationDeg": 51.6,
    "propulsion.ispSeconds": 320, "spacecraft.dryMassKg": 300, "spacecraft.initialFuelMassKg": 100, "spacecraft.dragAreaM2": 2, "spacecraft.dragCoefficient": 2.2,
    "transfer.targetRadiusKm": 7178.1363, "transfer.targetEccentricity": 0.005, "transfer.finalPropagationSeconds": 86400,
  })
  assert.match(rendered, /DefaultSC\.Epoch\s+=\s+'31253\.5';/u)
  assert.match(rendered, /DefaultSC\.SMA\s+=\s+6678\.1363;/u)
  assert.match(rendered, /DefaultSC\.ECC\s+=\s+0;/u)
  assert.match(rendered, /DefaultSC\.INC\s+=\s+51\.6;/u)
  assert.match(rendered, /DefaultSC\.RAAN\s+=\s+0;/u)
  assert.match(rendered, /DefaultSC\.AOP\s+=\s+0;/u)
  assert.match(rendered, /DefaultSC\.TA\s+=\s+0;/u)
  assert.match(rendered, /DefaultSC\.DryMass\s+=\s+300;/u)
  assert.match(rendered, /DefaultSC\.DragArea\s+=\s+2;/u)
  assert.match(rendered, /ChemicalTank1\.FuelMass\s+=\s+/u)
  assert.match(rendered, /DefaultSC\.Earth\.RMAG = 7178\.1363/u)
  assert.match(rendered, /DefaultSC\.Earth\.ECC = 0\.005/u)
  assert.match(rendered, /TOI\.Isp\s+=\s+320;/u)
  assert.match(rendered, /GOI\.Isp\s+=\s+320;/u)
  assert.doesNotMatch(rendered, /DefaultSC\.DisplayStateType\s+=\s+Cartesian;/u)
})

test("chemical Hohmann writer redirects the template OEM into the run without duplicating the subscriber", async () => {
  const template = await fs.readFile(defaultChemicalHohmannTemplatePath(), "utf8")
  const rendered = renderChemicalHohmannScript(template, {
    "initialOrbit.epoch": "31253.5", "initialOrbit.smaKm": 6678.1363, "initialOrbit.eccentricity": 0, "initialOrbit.inclinationDeg": 51.6,
    "spacecraft.dryMassKg": 300, "spacecraft.initialFuelMassKg": 100, "spacecraft.dragAreaM2": 2, "spacecraft.dragCoefficient": 2.2,
    "propulsion.ispSeconds": 320,
    "transfer.targetRadiusKm": 7178.1363, "transfer.targetEccentricity": 0.005, "transfer.finalPropagationSeconds": 86400,
  })
  const written = addHohmannEphemerisWriter(rendered, "/tmp/run/EphemerisFile1.oem", "/tmp/run/ReportFile1.txt")
  assert.equal(written.match(/^Create EphemerisFile EphemerisFile1;$/gmu)?.length, 1)
  assert.match(written, /EphemerisFile1\.Filename\s*=\s*'\/tmp\/run\/EphemerisFile1\.oem';/u)
  assert.match(written, /ReportFile1\.Filename\s*=\s*'\/tmp\/run\/ReportFile1\.txt';/u)
  assert.match(written, /DC1\.ReportFile\s*=\s*'\/tmp\/run\/DifferentialCorrectorDC1\.data';/u)
  assert.equal(written.match(/^Toggle[^\n]*EphemerisFile1[^\n]*On;$/gmu)?.length, 1)
  assert.equal(written.match(/^Report ReportFile1 DefaultSC\.ElapsedSecs DefaultSC\.Earth\.Altitude DefaultSC\.ChemicalTank1\.FuelMass;$/gmu)?.length, 3)
  assert.match(written, /While 'Sample post-transfer trajectory for OEM output' DefaultSC\.ElapsedSecs < 86400/u)
  assert.doesNotMatch(written, /Propagate 'Prop One Day'/u)
})

test("chemical Hohmann writer injects the subscriber into tutorial-style templates", () => {
  const tutorial = [
    "Create Spacecraft DefaultSC;",
    "BeginMissionSequence;",
    "Propagate 'Prop One Day' DefaultProp(DefaultSC) {DefaultSC.ElapsedSecs = 86400};",
  ].join("\n")
  const written = addHohmannEphemerisWriter(tutorial, "/tmp/run/EphemerisFile1.oem")
  assert.equal(written.match(/^Create EphemerisFile EphemerisFile1;$/gmu)?.length, 1)
  assert.equal(written.match(/^Toggle EphemerisFile1 On;$/gmu)?.length, 1)
  assert.match(written, /While 'Sample post-transfer trajectory for OEM output' DefaultSC\.ElapsedSecs < 86400/u)
})

test("chemical Hohmann report parser converts 3-column GMAT output into time-series samples", () => {
  const report = [
    "DefaultSC.ElapsedSecs DefaultSC.Earth.Altitude DefaultSC.ChemicalTank1.FuelMass",
    "0 300.000 100.000000000",
    "60 310.500 99.800000000",
    "120 3.201e+02 9.960e+01",
  ].join("\n")
  const samples = parseChemicalHohmannReport(report)
  assert.equal(samples.length, 3)
  assert.equal(samples[0].elapsedDays, 0)
  assert.equal(samples[0].altitudeKm, 300)
  assert.equal(samples[0].fuelMassKg, 100)
  assert.equal(samples[2].elapsedDays, 120 / 86_400)
  assert.equal(samples[2].fuelMassKg, 99.6)
})
