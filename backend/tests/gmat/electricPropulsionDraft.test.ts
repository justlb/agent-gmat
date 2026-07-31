import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { confirmElectricPropulsionDraft, createElectricPropulsionDraft, discussElectricPropulsionDraft, draftToElectricPropulsionChanges } from "../../src/gmat/electricPropulsionDraft.js"
import { defaultElectricPropulsionTemplatePath } from "../../src/gmat/electricPropulsionTemplate.js"
import { extractElectricPropulsionValues } from "../../src/gmat/electricPropulsionValues.js"

const connection = { apiKey: "test", baseUrl: "https://model.example.test/v1", model: "test" }

describe("electric-propulsion transfer mission draft", () => {
  it("requires the Keplerian state, masses, and burn duration before confirmation", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "electric-draft-"))
    const initial = await createElectricPropulsionDraft(workspaceDir)
    assert.deepEqual(initial.missing, [
      "initialOrbit.epoch", "initialOrbit.smaKm", "initialOrbit.eccentricity", "initialOrbit.inclinationDeg", "spacecraft.dryMassKg", "spacecraft.initialFuelMassKg", "transfer.burnDurationDays",
    ])
    const updates = [
      ["initialOrbit.epoch", "21545"], ["initialOrbit.smaKm", 7191.938817629013], ["initialOrbit.eccentricity", 0.02454974900598137],
      ["initialOrbit.inclinationDeg", 12.85008005658097],
      ["spacecraft.dryMassKg", 850], ["spacecraft.initialFuelMassKg", 756], ["transfer.burnDurationDays", 2],
    ].map(([fieldPath, value]) => ({ path: fieldPath, value }))
    const ready = await discussElectricPropulsionDraft({
      connection, draft: initial, message: "Set the transfer inputs.", workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: `message: Inputs recorded.\nupdates: ${JSON.stringify(updates)}` }), { status: 200 }),
    })
    assert.equal(ready.status, "ready")
    assert.ok(ready.safety.assumptions.some(item => item.label === "Initial RAAN" && item.value === "0 deg"))
    const confirmed = await confirmElectricPropulsionDraft(workspaceDir, ready.draftId)
    const template = await fs.readFile(defaultElectricPropulsionTemplatePath(), "utf8")
    const values = extractElectricPropulsionValues(template)
    const changes = draftToElectricPropulsionChanges(confirmed, values)
    assert.ok(changes.some(change => change.id.includes("DefaultSC_SMA") && change.value === "7191.938817629013"))
    assert.ok(changes.some(change => change.id.includes("ElectricTank1_FuelMass") && change.value === "756"))
    const durationSlot = values.slots.find(slot => slot.context.startsWith("daysofpropagation ="))
    const reportSlot = values.slots.find(slot => slot.context.startsWith("ElectricTransferReport.Add ="))
    assert.ok(durationSlot)
    assert.ok(reportSlot)
    assert.ok(changes.some(change => change.id === durationSlot.id && change.value === "2"))
    assert.ok(!changes.some(change => change.id === reportSlot.id))
  })

  it("blocks Keplerian elements with a periapsis inside the atmospheric safety altitude", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "electric-draft-"))
    const initial = await createElectricPropulsionDraft(workspaceDir)
    const updates = [
      ["initialOrbit.epoch", "21545"], ["initialOrbit.smaKm", 6500], ["initialOrbit.eccentricity", 0.01],
      ["initialOrbit.inclinationDeg", 12.85], ["initialOrbit.raanDeg", 306.6], ["initialOrbit.argPeriapsisDeg", 314.2], ["initialOrbit.trueAnomalyDeg", 99.9],
      ["spacecraft.dryMassKg", 850], ["spacecraft.initialFuelMassKg", 756], ["transfer.burnDurationDays", 2],
    ].map(([fieldPath, value]) => ({ path: fieldPath, value }))
    const blocked = await discussElectricPropulsionDraft({
      connection, draft: initial, message: "Set an unsafe state.", workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: `message: Inputs recorded.\nupdates: ${JSON.stringify(updates)}` }), { status: 200 }),
    })
    assert.equal(blocked.status, "blocked")
    assert.ok(blocked.safety.checks.some(check => check.code === "initial_periapsis" && check.severity === "error"))
  })

  it("blocks a power setup whose optimistic thrust power is below the thruster threshold", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "electric-draft-"))
    const initial = await createElectricPropulsionDraft(workspaceDir)
    const blocked = await discussElectricPropulsionDraft({
      connection, draft: initial, message: "Use an undersized solar array.", workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: "message: Power inputs recorded.\nupdates:\n  - path: power.initialMaxPowerKw\n    value: 0.8\n  - path: propulsion.minimumUsablePowerKw\n    value: 0.638\n  - path: propulsion.maximumUsablePowerKw\n    value: 7.266" }), { status: 200 }),
    })
    assert.equal(blocked.status, "blocked")
    assert.ok(blocked.safety.checks.some(check => check.code === "initial_power_below_minimum" && check.severity === "error"))
  })

  it("blocks a minimum usable power equal to the maximum usable power", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "electric-draft-"))
    const initial = await createElectricPropulsionDraft(workspaceDir)
    const blocked = await discussElectricPropulsionDraft({
      connection, draft: initial, message: "Use an invalid thruster power interval.", workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: "message: Power inputs recorded.\nupdates:\n  - path: propulsion.minimumUsablePowerKw\n    value: 1\n  - path: propulsion.maximumUsablePowerKw\n    value: 1" }), { status: 200 }),
    })
    assert.equal(blocked.status, "blocked")
    assert.ok(blocked.safety.checks.some(check => check.code === "power_range" && check.severity === "error"))
  })

  it("derives SMA from perigee altitude and eccentricity", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "electric-draft-"))
    const initial = await createElectricPropulsionDraft(workspaceDir)
    const updated = await discussElectricPropulsionDraft({
      connection, draft: initial, message: "Use a 500 km perigee altitude and eccentricity 0.1.", workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: "message: Perigee inputs recorded.\nupdates:\n  - path: initialOrbit.periapsisAltitudeKm\n    value: 500\n  - path: initialOrbit.eccentricity\n    value: 0.1" }), { status: 200 }),
    })
    assert.ok(Math.abs(Number(updated.values["initialOrbit.smaKm"]) - 7642.373666666667) < 1e-9)
  })

  it("converts a Cartesian initial state into the Keplerian GMAT inputs", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "electric-draft-"))
    const initial = await createElectricPropulsionDraft(workspaceDir)
    const updates = [
      ["initialOrbit.epoch", "21545"], ["initialState.xKm", 7000], ["initialState.yKm", 0], ["initialState.zKm", 0],
      ["initialState.vxKmPerSec", 0], ["initialState.vyKmPerSec", 7.546053290107542], ["initialState.vzKmPerSec", 0],
      ["spacecraft.dryMassKg", 850], ["spacecraft.initialFuelMassKg", 756], ["transfer.burnDurationDays", 2],
    ].map(([fieldPath, value]) => ({ path: fieldPath, value }))
    const updated = await discussElectricPropulsionDraft({
      connection, draft: initial, message: "Use this Cartesian initial state.", workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: `message: Cartesian state recorded.\nupdates: ${JSON.stringify(updates)}` }), { status: 200 }),
    })
    assert.equal(updated.status, "ready")
    assert.ok(Math.abs(Number(updated.values["initialOrbit.smaKm"]) - 7000) < 1e-6)
    assert.ok(Math.abs(Number(updated.values["initialOrbit.eccentricity"])) < 1e-9)
    assert.match(updated.assistantMessage ?? "", /Cartesian state converted to Keplerian elements/u)
  })

  it("returns the Cartesian equivalent of complete Keplerian inputs in the draft discussion", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "electric-draft-"))
    const initial = await createElectricPropulsionDraft(workspaceDir)
    const updates = [
      ["initialOrbit.epoch", "21545"], ["initialOrbit.smaKm", 7000], ["initialOrbit.eccentricity", 0], ["initialOrbit.inclinationDeg", 0],
      ["coordinateConversion.request", "keplerian_to_cartesian"],
    ].map(([fieldPath, value]) => ({ path: fieldPath, value }))
    const updated = await discussElectricPropulsionDraft({
      connection, draft: initial, message: "Convert the Keplerian orbit to Cartesian.", workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: `message: Conversion requested.\nupdates: ${JSON.stringify(updates)}` }), { status: 200 }),
    })
    assert.match(updated.assistantMessage ?? "", /Keplerian elements converted to Cartesian state: X=7000\.000000 km/u)
  })
})
