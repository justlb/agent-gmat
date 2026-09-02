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
    assert.match(rendered, /Target 'Circular Reboost'/u)
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

  it("keeps new immutable template defaults when rendering an older values file", () => {
    const previousTemplate = "Create Variable duration;\nduration = 30;\n"
    const values = extractOrbitKeepingValues(previousTemplate)
    const currentTemplate = "Create Variable duration;\nduration = 30;\nCreate EphemerisFile EphemerisFile1;\nEphemerisFile1.Filename = 'EphemerisFile1.oem';\n"
    assert.equal(renderOrbitKeepingValues(currentTemplate, values), currentTemplate)
  })

  it("matches a historical YAML context even when YAML wrapped its command", () => {
    const previousTemplate = "Target 'Circular Reboost' DefaultDC {SolveMode = Solve, ExitMode = DiscardAndContinue};\n"
    const values = extractOrbitKeepingValues(previousTemplate)
    values.slots[0].context = "Target 'Circular Reboost' DefaultDC {SolveMode = Solve, ExitMode =\n  DiscardAndContinue};"
    const currentTemplate = "Create EphemerisFile EphemerisFile1;\nTarget 'Circular Reboost' DefaultDC {SolveMode = Solve, ExitMode = DiscardAndContinue};\n"
    assert.equal(renderOrbitKeepingValues(currentTemplate, values), currentTemplate)
  })

  it("matches every literal from a historical command with the same context", () => {
    const previousTemplate = "Target 'Circular Reboost' DefaultDC {SolveMode = Solve, ExitMode = DiscardAndContinue, ShowProgressWindow = true};\n"
    const values = extractOrbitKeepingValues(previousTemplate)
    for (const slot of values.slots) {
      slot.context = "Target 'Circular Reboost' DefaultDC {SolveMode = Solve, ExitMode =\n  DiscardAndContinue, ShowProgressWindow = true};"
    }
    const currentTemplate = "Create EphemerisFile EphemerisFile1;\nTarget 'Circular Reboost' DefaultDC {SolveMode = Solve, ExitMode = DiscardAndContinue, ShowProgressWindow = true};\n"
    assert.equal(renderOrbitKeepingValues(currentTemplate, values), currentTemplate)
  })

  it("migrates a historical assignment whose generated filename changed", () => {
    const previousTemplate = "ReboostReport.Filename = 'D:/old/run/ReboostReport.txt';\n"
    const values = extractOrbitKeepingValues(previousTemplate)
    const currentTemplate = "Create EphemerisFile EphemerisFile1;\nReboostReport.Filename = 'ReboostReport.txt';\n"
    assert.equal(renderOrbitKeepingValues(currentTemplate, values), "Create EphemerisFile EphemerisFile1;\nReboostReport.Filename = 'D:/old/run/ReboostReport.txt';\n")
  })
})
