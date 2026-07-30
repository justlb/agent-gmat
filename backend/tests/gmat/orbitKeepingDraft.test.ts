import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { assertOrbitKeepingSimulationSafety, confirmOrbitKeepingDraft, createOrbitKeepingDraft, discussOrbitKeepingDraft, draftToOrbitKeepingChanges, recordOrbitKeepingDraftRun } from "../../src/gmat/orbitKeepingDraft.js"
import { defaultOrbitKeepingTemplatePath } from "../../src/gmat/orbitKeepingTemplate.js"
import { applyOrbitKeepingValueChanges, extractOrbitKeepingValues } from "../../src/gmat/orbitKeepingValues.js"

const connection = { apiKey: "test", baseUrl: "https://model.example.test/v1", model: "test" }

describe("orbit keeping mission draft", () => {
  it("requires every template field before confirming and maps only validated fields to YAML slots", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-draft-"))
    const initial = await createOrbitKeepingDraft(workspaceDir)
    assert.equal(initial.status, "collecting")
    assert.ok(initial.missing.includes("initialOrbit.epoch"))

    const updates = [
      ["initialOrbit.epoch", "21545"], ["initialOrbit.smaKm", 6578.1363], ["initialOrbit.eccentricity", 0],
      ["initialOrbit.inclinationDeg", 0], ["initialOrbit.raanDeg", 0], ["initialOrbit.argPeriapsisDeg", 0], ["initialOrbit.trueAnomalyDeg", 0],
      ["spacecraft.dryMassKg", 300], ["spacecraft.initialFuelMassKg", 200], ["spacecraft.dragAreaM2", 15], ["spacecraft.dragCoefficient", 2.5],
      ["propulsion.ispSeconds", 300], ["stationKeeping.minimumAltitudeKm", 190], ["stationKeeping.targetSmaKm", 6578.1363], ["stationKeeping.fuelReserveKg", 7], ["endOfLife.finalAltitudeKm", 150],
    ].map(([fieldPath, value]) => ({ path: fieldPath, value }))
    const discussed = await discussOrbitKeepingDraft({
      connection,
      draft: initial,
      message: "Complete the mission configuration.",
      workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: `message: Complete\nupdates: ${JSON.stringify(updates)}` }), { status: 200 }),
    })
    assert.equal(discussed.status, "ready")
    const confirmed = await confirmOrbitKeepingDraft(workspaceDir, discussed.draftId)
    assert.equal(confirmed.status, "confirmed")
    const template = await fs.readFile(defaultOrbitKeepingTemplatePath(), "utf8")
    const changes = draftToOrbitKeepingChanges(confirmed, extractOrbitKeepingValues(template))
    assert.ok(changes.some(change => change.id.includes("DefaultSC_DryMass") && change.value === "300"))
    assert.ok(changes.some(change => change.id.includes("ChemicalTank1_FuelMass") && change.value === "200"))
    const withRun = await recordOrbitKeepingDraftRun(workspaceDir, confirmed.draftId, {
      changes,
      completedAt: "2026-07-30T10:00:00Z",
      result: { minimumReportedAltitudeKm: 180, status: "completed" },
      runId: "26-07-30_10-00",
      runPath: "gmat/orbit-keeping/26-07-30_10-00",
    })
    assert.equal(withRun.runs.length, 1)
    assert.equal(withRun.runs[0].runId, "26-07-30_10-00")
  })

  it("accepts a standard Responses API output block when output_text is absent", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-draft-"))
    const initial = await createOrbitKeepingDraft(workspaceDir)
    const draft = await discussOrbitKeepingDraft({
      connection,
      draft: initial,
      message: "Set the dry mass to 100 kg.",
      workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({
        output: [{ content: [{ text: "message: Dry mass recorded.\nupdates:\n  - path: spacecraft.dryMassKg\n    value: 100" }] }],
      }), { status: 200 }),
    })
    assert.equal(draft.values["spacecraft.dryMassKg"], 100)
    assert.equal(draft.assistantMessage, "Dry mass recorded.")
  })

  it("converts an explicit initial altitude to SMA and keeps optional angles at template defaults", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-draft-"))
    const initial = await createOrbitKeepingDraft(workspaceDir)
    const draft = await discussOrbitKeepingDraft({
      connection,
      draft: initial,
      message: "Use a 200 km initial altitude.",
      workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: "message: I recorded a 200 km initial altitude. What inclination should be used?\nupdates:\n  - path: initialOrbit.altitudeKm\n    value: 200" }), { status: 200 }),
    })
    assert.equal(draft.values["initialOrbit.smaKm"], 6578.1363)
    assert.equal(draft.values["stationKeeping.targetSmaKm"], 6578.1363)
    assert.equal(draft.missing.includes("initialOrbit.raanDeg"), false)
    assert.equal(draft.missing.includes("initialOrbit.argPeriapsisDeg"), false)
    assert.equal(draft.missing.includes("initialOrbit.trueAnomalyDeg"), false)
    assert.equal(draft.conversation.length, 1)
  })

  it("does not require optional propulsion, drag, end-of-life, or target-SMA values", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-draft-"))
    const draft = await createOrbitKeepingDraft(workspaceDir)
    for (const optional of [
      "spacecraft.dragAreaM2", "spacecraft.dragCoefficient", "propulsion.ispSeconds",
      "stationKeeping.targetSmaKm", "stationKeeping.fuelReserveKg", "endOfLife.finalAltitudeKm",
    ]) {
      assert.equal(draft.missing.includes(optional), false)
    }
  })

  it("confirms and renders a draft containing only the essential mission inputs", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-draft-"))
    const initial = await createOrbitKeepingDraft(workspaceDir)
    const requiredUpdates = [
      { path: "initialOrbit.epoch", value: "21545" }, { path: "initialOrbit.smaKm", value: 6578.1363 },
      { path: "initialOrbit.eccentricity", value: 0 }, { path: "initialOrbit.inclinationDeg", value: 51.6 },
      { path: "spacecraft.dryMassKg", value: 100 }, { path: "spacecraft.initialFuelMassKg", value: 50 },
      { path: "stationKeeping.minimumAltitudeKm", value: 180 },
    ]
    const ready = await discussOrbitKeepingDraft({
      connection,
      draft: initial,
      message: "Set the essential inputs.",
      workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: `message: Essential inputs recorded.\nupdates: ${JSON.stringify(requiredUpdates)}` }), { status: 200 }),
    })
    assert.equal(ready.status, "ready")
    const confirmed = await confirmOrbitKeepingDraft(workspaceDir, ready.draftId)
    const template = await fs.readFile(defaultOrbitKeepingTemplatePath(), "utf8")
    const changes = draftToOrbitKeepingChanges(confirmed, extractOrbitKeepingValues(template))
    assert.ok(changes.some(change => change.id.includes("targetSMA") && change.value === "6578.1363"))
    assert.equal(changes.some(change => change.id.includes("DefaultSC_DragArea")), false)
  })

  it("blocks confirmation when the initial or target perigee enters the atmosphere", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-draft-"))
    const initial = await createOrbitKeepingDraft(workspaceDir)
    const updates = [
      { path: "initialOrbit.epoch", value: "21545" }, { path: "initialOrbit.smaKm", value: 6500 },
      { path: "initialOrbit.eccentricity", value: 0.01 }, { path: "initialOrbit.inclinationDeg", value: 0 },
      { path: "spacecraft.dryMassKg", value: 100 }, { path: "spacecraft.initialFuelMassKg", value: 50 },
      { path: "stationKeeping.minimumAltitudeKm", value: 190 },
    ]
    const blocked = await discussOrbitKeepingDraft({
      connection,
      draft: initial,
      message: "Set an unsafe initial orbit.",
      workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: `message: Unsafe inputs recorded.\nupdates: ${JSON.stringify(updates)}` }), { status: 200 }),
    })
    assert.equal(blocked.status, "blocked")
    assert.ok(blocked.safety.checks.some(check => check.code === "initial_perigee" && check.severity === "error"))
    await assert.rejects(() => confirmOrbitKeepingDraft(workspaceDir, blocked.draftId), /physical sanity checks failed/u)
  })

  it("rejects a calendar epoch when the template uses TAIModJulian", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-draft-"))
    const initial = await createOrbitKeepingDraft(workspaceDir)
    await assert.rejects(() => discussOrbitKeepingDraft({
      connection,
      draft: initial,
      message: "Set the epoch.",
      workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: "message: Epoch recorded.\nupdates:\n  - path: initialOrbit.epoch\n    value: '2026-07-30'" }), { status: 200 }),
    }), /numeric TAIModJulian/u)
  })

  it("converts a UTC calendar epoch to the numeric TAIModJulian value used by GMAT", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-draft-"))
    const initial = await createOrbitKeepingDraft(workspaceDir)
    const updated = await discussOrbitKeepingDraft({
      connection,
      draft: initial,
      message: "Use 01 Jan 2000 11:59:28 UTC.",
      workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: "message: Epoch converted.\nupdates:\n  - path: initialOrbit.utcGregorian\n    value: 2000-01-01T11:59:28Z" }), { status: 200 }),
    })
    assert.equal(updated.values["initialOrbit.epoch"], "21545")
  })

  it("enforces physical checks on the direct generation path", async () => {
    const template = await fs.readFile(defaultOrbitKeepingTemplatePath(), "utf8")
    const values = extractOrbitKeepingValues(template)
    const unsafeSma = values.slots.find(slot => slot.context.includes("DefaultSC.SMA"))
    assert.ok(unsafeSma)
    const unsafe = applyOrbitKeepingValueChanges(values, [{ id: unsafeSma.id, value: "6400" }])
    assert.throws(() => assertOrbitKeepingSimulationSafety(unsafe), /physical sanity checks failed/u)
  })

  it("blocks non-positive masses and a reboost threshold above the initial orbit", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-draft-"))
    const initial = await createOrbitKeepingDraft(workspaceDir)
    const updates = [
      { path: "initialOrbit.epoch", value: "21545" }, { path: "initialOrbit.smaKm", value: 6578.1363 },
      { path: "initialOrbit.eccentricity", value: 0 }, { path: "initialOrbit.inclinationDeg", value: 0 },
      { path: "spacecraft.dryMassKg", value: 100 }, { path: "spacecraft.initialFuelMassKg", value: 0 },
      { path: "stationKeeping.minimumAltitudeKm", value: 250 },
    ]
    await assert.rejects(() => discussOrbitKeepingDraft({
      connection,
      draft: initial,
      message: "Set unsafe values.",
      workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: `message: Unsafe inputs recorded.\nupdates: ${JSON.stringify(updates)}` }), { status: 200 }),
    }), /initialFuelMassKg must be at least 0.001/u)

    const validFuelUpdates = updates.map(update => update.path === "spacecraft.initialFuelMassKg" ? { ...update, value: 10 } : update)
    const blocked = await discussOrbitKeepingDraft({
      connection,
      draft: initial,
      message: "Set an excessive reboost threshold.",
      workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: `message: Inputs recorded.\nupdates: ${JSON.stringify(validFuelUpdates)}` }), { status: 200 }),
    })
    assert.equal(blocked.status, "blocked")
    assert.ok(blocked.safety.checks.some(check => check.code === "reboost_above_initial_orbit"))
  })

  it("rejects a final altitude below 150 km", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-draft-"))
    const initial = await createOrbitKeepingDraft(workspaceDir)
    await assert.rejects(() => discussOrbitKeepingDraft({
      connection,
      draft: initial,
      message: "Set final altitude to 149 km.",
      workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: "message: Final altitude recorded.\nupdates:\n  - path: endOfLife.finalAltitudeKm\n    value: 149" }), { status: 200 }),
    }), /endOfLife.finalAltitudeKm must be at least 150/u)
  })
})
