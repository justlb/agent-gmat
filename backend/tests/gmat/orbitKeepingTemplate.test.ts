import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import {
  defaultOrbitKeepingTemplatePath,
  renderOrbitKeepingBaseline,
} from "../../src/gmat/orbitKeepingTemplate.js"

describe("orbit keeping reference template", () => {
  it("renders an exact deterministic copy of the reference script", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-orbit-keeping-"))
    const outputPath = path.join(directory, "mission.script")
    const templatePath = defaultOrbitKeepingTemplatePath()

    const result = await renderOrbitKeepingBaseline({ outputPath, templatePath })
    const [expected, actual] = await Promise.all([
      fs.readFile(templatePath, "utf8"),
      fs.readFile(outputPath, "utf8"),
    ])

    assert.equal(actual, expected)
    assert.equal(result.bytesWritten, Buffer.byteLength(expected, "utf8"))
    assert.match(actual, /Create Spacecraft DefaultSC;/u)
    assert.match(actual, /BeginMissionSequence;/u)
    assert.match(actual, /While DefaultSC\.ChemicalTank1\.FuelMass > fuelReserve/u)
    assert.match(actual, /Target 'Circular Reboost' DefaultDC/u)
  })
})
