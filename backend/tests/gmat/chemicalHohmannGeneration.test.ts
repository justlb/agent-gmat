import assert from "node:assert/strict"
import fs from "node:fs/promises"
import test from "node:test"

import { renderChemicalHohmannScript } from "../../src/gmat/chemicalHohmann.service.js"
import { defaultChemicalHohmannTemplatePath } from "../../src/gmat/chemicalHohmannTemplate.js"

test("chemical Hohmann renderer changes only declared GMAT slots", async () => {
  const template = await fs.readFile(defaultChemicalHohmannTemplatePath(), "utf8")
  const rendered = renderChemicalHohmannScript(template, {
    "initialOrbit.epoch": "31253.5", "initialOrbit.smaKm": 6678.1363, "initialOrbit.eccentricity": 0, "initialOrbit.inclinationDeg": 51.6,
    "propulsion.ispSeconds": 320, "spacecraft.dryMassKg": 300, "spacecraft.dragAreaM2": 2, "spacecraft.dragCoefficient": 2.2,
    "transfer.targetRadiusKm": 7178.1363, "transfer.targetEccentricity": 0.005, "transfer.finalPropagationSeconds": 86400,
  })
  assert.match(rendered, /DefaultSC\.Epoch\s+=\s+'31253\.5';/u)
  assert.match(rendered, /DefaultSC\.Earth\.RMAG = 7178\.1363/u)
  assert.match(rendered, /TOI\.Isp\s+=\s+320;/u)
  assert.match(rendered, /GOI\.Isp\s+=\s+320;/u)
})
