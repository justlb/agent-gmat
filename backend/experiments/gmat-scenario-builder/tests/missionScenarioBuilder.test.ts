import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { buildChemicalTransferScript, generateChemicalTransferScript } from "../src/missionScenarioBuilder.js"
import { defaultOrbitKeepingTemplatePath } from "../../../src/gmat/orbitKeepingTemplate.js"

describe("block-built mission scenarios", () => {
  it("builds a chemical, 2D Hohmann transfer from approved orbit-keeping blocks", async () => {
    const source = await fs.readFile(defaultOrbitKeepingTemplatePath(), "utf8")
    const built = buildChemicalTransferScript(source, {
      initialEccentricity: 0,
      initialFuelMassKg: 15,
      initialInclinationDeg: 0,
      initialSmaKm: 6678.1363,
      targetSmaKm: 6878.1363,
    })

    assert.deepEqual(built.scenario, { family: "transfer", propulsion: "chemical", propagationDimension: "2d" })
    assert.ok(built.blocks.includes("orbit-keeping:chemical-hardware"))
    assert.ok(built.blocks.includes("chemical-transfer:hohmann-sequence"))
    assert.match(built.script, /Create ChemicalTank ChemicalTank1;/u)
    assert.match(built.script, /Maneuver 'Transfer injection' TOI\(DefaultSC\);/u)
    assert.match(built.script, /Maneuver 'Transfer circularization' GOI\(DefaultSC\);/u)
    assert.match(built.script, /DefaultSC\.SMA = 6678\.1363;/u)
    assert.match(built.script, /ChemicalTank1\.FuelMass = 15;/u)
    assert.ok(built.transfer.firstBurnDeltaVKmPerSec > 0)
    assert.ok(built.transfer.secondBurnDeltaVKmPerSec > 0)
  })

  it("writes the generated scenario independently from the reference template", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "chemical-transfer-"))
    const outputPath = path.join(directory, "chemical_transfer.script")
    const generated = await generateChemicalTransferScript({
      inputs: { initialEccentricity: 0, initialFuelMassKg: 15, initialInclinationDeg: 15, initialSmaKm: 6878.1363, targetSmaKm: 6678.1363 },
      outputPath,
    })
    assert.equal((await fs.readFile(outputPath, "utf8")), generated.script)
    assert.equal(generated.transfer.arrivalEvent, "periapsis")
    await fs.rm(directory, { force: true, recursive: true })
  })

  it("refuses a transfer when the requested fuel cannot preserve the reserve", async () => {
    const source = await fs.readFile(defaultOrbitKeepingTemplatePath(), "utf8")
    assert.throws(() => buildChemicalTransferScript(source, {
      initialEccentricity: 0, initialFuelMassKg: 10, initialInclinationDeg: 0, initialSmaKm: 6678.1363, targetSmaKm: 6878.1363,
    }), /chemical transfer needs at least/u)
  })
})
