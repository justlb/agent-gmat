import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { defaultOrbitKeepingTemplatePath } from "../../src/gmat/orbitKeepingTemplate.js"
import {
  extractOrbitKeepingValues,
  renderOrbitKeepingFromValues,
  renderOrbitKeepingValues,
  writeDefaultOrbitKeepingValues,
} from "../../src/gmat/orbitKeepingValues.js"

describe("orbit keeping values renderer", () => {
  it("renders requested value changes without changing the template structure", async () => {
    const template = await fs.readFile(defaultOrbitKeepingTemplatePath(), "utf8")
    const values = extractOrbitKeepingValues(template)
    const replace = (needle: string, value: string) => {
      const slot = values.slots.find((candidate) => candidate.context.includes(needle))
      assert.ok(slot, `slot ${needle} must exist`)
      slot.value = value
    }
    replace("DefaultSC.DryMass", "100")
    replace("DefaultSC.DragArea", "30")
    replace("minAltitude =", "180")

    const rendered = renderOrbitKeepingValues(template, values)
    assert.match(rendered, /DefaultSC\.DryMass\s+= 100;/u)
    assert.match(rendered, /DefaultSC\.DragArea\s+= 30;/u)
    assert.match(rendered, /minAltitude = 180;/u)
    assert.match(rendered, /BeginMissionSequence;/u)
    assert.match(rendered, /Target 'Hohmann Transfer'/u)
  })

  it("writes a default values YAML and renders it back to the exact reference", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-orbit-values-"))
    const valuesPath = path.join(directory, "values.yaml")
    const outputPath = path.join(directory, "mission.script")
    const templatePath = defaultOrbitKeepingTemplatePath()

    await writeDefaultOrbitKeepingValues({ outputPath: valuesPath, templatePath })
    await renderOrbitKeepingFromValues({ outputPath, valuesPath, templatePath })

    assert.equal(await fs.readFile(outputPath, "utf8"), await fs.readFile(templatePath, "utf8"))
  })
})
