import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import { parseDocument } from "yaml"

import { adaptDigitalThreadToGmat, syncDigitalThreadFromGmatDraft } from "../../src/digitalThread/gmatDigitalThreadAdapter.js"
import { createPlanningRun, draftDigitalThreadWorkspaceDir, loadOrCreateDigitalThread } from "../../src/digitalThread/digitalThreadStore.js"
import { selectSatelliteDefinition } from "../../src/digitalThread/satelliteLibrary.js"
import { createElectricPropulsionDraft, discussElectricPropulsionDraft, draftToElectricPropulsionChanges } from "../../src/gmat/electricPropulsionDraft.js"
import { generateElectricPropulsionMission } from "../../src/gmat/electricPropulsion.service.js"
import { defaultElectricPropulsionTemplatePath } from "../../src/gmat/electricPropulsionTemplate.js"
import { extractElectricPropulsionValues } from "../../src/gmat/electricPropulsionValues.js"

const connection = { apiKey: "test", baseUrl: "https://model.example.test/v1", model: "test" }

function fakeLlm(updates: Array<[string, string | number]>) {
  return async () => new Response(JSON.stringify({
    output_text: `message: Mission inputs recorded.\nupdates: ${JSON.stringify(updates.map(([path, value]) => ({ path, value })) )}`,
  }), { status: 200 })
}

describe("digital thread mission consistency", () => {
  it("keeps one electric mission coherent from LLM input through GMAT artifacts", async () => {
    const workspace = await fs.mkdtemp(path.join(os.tmpdir(), "mission-consistency-"))
    const planning = await createPlanningRun(workspace)

    // Physical data comes only from the selected satellite definition.
    await selectSatelliteDefinition(planning.workspaceDir, "ref-starlink-v1-5-public-rf", "1.0.0")
    const selected = await loadOrCreateDigitalThread(planning.workspaceDir)
    const seed = adaptDigitalThreadToGmat(selected, "electric-propulsion-transfer")
    assert.equal(seed.values["spacecraft.dryMassKg"], 296)
    assert.equal(seed.values["spacecraft.initialFuelMassKg"], 10)
    assert.equal(seed.values["power.initialMaxPowerKw"], 4.2)
    assert.equal(seed.values["power.busLoadKw"], 2.8)

    const initialDraft = await createElectricPropulsionDraft(planning.workspaceDir, seed.values, seed.requiredDraftPaths)
    const userMessage = "I want an electric propulsion transfer from a 300 km circular Earth orbit. Use 2026-08-01T00:00:00Z, inc=0, for 3 days."
    const draft = await discussElectricPropulsionDraft({
      connection,
      draft: initialDraft,
      message: userMessage,
      workspaceDir: planning.workspaceDir,
      fetchImpl: fakeLlm([
        ["initialOrbit.utcGregorian", "2026-08-01T00:00:00Z"],
        ["initialOrbit.altitudeKm", 300],
        ["initialOrbit.eccentricity", 0],
        ["initialOrbit.inclinationDeg", 0],
        ["transfer.burnDurationDays", 3],
      ]),
    })

    // The deterministic adapter must derive SMA, while the LLM only supplied altitude.
    assert.equal(draft.values["initialOrbit.smaKm"], 6678.1363)
    assert.equal(draft.values["transfer.burnDurationDays"], 3)
    assert.equal(draft.values["spacecraft.dryMassKg"], 296)

    const draftThreadDir = draftDigitalThreadWorkspaceDir(planning.workspaceDir, "electric-propulsion-transfer", draft.draftId)
    await syncDigitalThreadFromGmatDraft(draftThreadDir, draft)
    await syncDigitalThreadFromGmatDraft(planning.workspaceDir, draft)

    const rootThread = await loadOrCreateDigitalThread(planning.workspaceDir)
    const draftThread = await loadOrCreateDigitalThread(draftThreadDir)
    for (const document of [rootThread, draftThread]) {
      assert.equal(document.satellite.bus.physical.mass_kg.dry, 296, "mission chat must not change satellite mass")
      assert.equal(document.satellite.orbit.reference_epoch_utc, "2026-08-01T00:00:00.000Z")
      assert.equal(document.satellite.orbit.keplerian_elements.semi_major_axis_km, 6678.1363)
      assert.equal(document.satellite.orbit.keplerian_elements.eccentricity, 0)
      assert.equal(document.satellite.orbit.keplerian_elements.inclination_deg, 0)
      assert.equal(document.analysis_requests.gmat.electric_propulsion_transfer.burn_duration_days, 3)
    }

    const savedSatellite = JSON.parse(await fs.readFile(path.join(planning.workspaceDir, "satellite.json"), "utf8"))
    assert.equal(savedSatellite.satellite.orbit.keplerian_elements.semi_major_axis_km, 6678.1363)
    const savedDraftYaml = parseDocument(await fs.readFile(path.join(planning.workspaceDir, "electric_propulsion_transfer.values.yaml"), "utf8")).toJS() as { values: Record<string, unknown> }
    assert.equal(savedDraftYaml.values["initialOrbit.smaKm"], 6678.1363)
    assert.equal(savedDraftYaml.values["transfer.burnDurationDays"], 3)

    // Rendering is tested independently of an actual GMAT executable.  The
    // selected Starlink reference is deliberately power-limited, so it may be
    // blocked by the engineering guard; rendering still verifies every file
    // receives the exact confirmed values when a run is allowed.
    const template = await fs.readFile(defaultElectricPropulsionTemplatePath(), "utf8")
    const values = extractElectricPropulsionValues(template)
    const renderableDraft = { ...draft, confirmed: true, status: "confirmed" as const, safety: { ...draft.safety, checks: [] } }
    const changes = draftToElectricPropulsionChanges(renderableDraft, values)
    const generated = await generateElectricPropulsionMission({ artifactId: "consistency", changes, request: userMessage, workspaceDir: planning.workspaceDir })
    const script = await fs.readFile(generated.scriptPath, "utf8")
    const renderedYaml = parseDocument(await fs.readFile(generated.valuesPath, "utf8")).toJS() as { slots: Array<{ context: string; value: string }> }
    const manifest = JSON.parse(await fs.readFile(generated.manifestPath, "utf8")) as { inputs: { script: string; values: string }; templateId: string }

    assert.match(script, /DefaultSC\.SMA\s*= 6678\.1363;/u)
    assert.match(script, /DefaultSC\.ECC\s*= 0;/u)
    assert.match(script, /DefaultSC\.INC\s*= 0;/u)
    assert.match(script, /DefaultSC\.DryMass\s*= 296;/u)
    assert.match(script, /ElectricTank1\.FuelMass\s*= 10;/u)
    assert.match(script, /daysofpropagation\s*= 3;/u)
    assert.match(script, /ElectricThruster1\.ThrustModel = FixedEfficiency;/u)
    assert.match(script, /ElectricThruster1\.Isp = 1600;/u)
    assert.match(script, /ElectricThruster1\.DutyCycle = 0\.25;/u)
    const calibration = JSON.parse(await fs.readFile(path.join(generated.runDir, "electric_propulsion_calibration.json"), "utf8")) as { nominalThrustNewtons: number; dutyCycle: number }
    assert.equal(calibration.nominalThrustNewtons, 0.01)
    assert.equal(calibration.dutyCycle, 0.25)
    assert.ok(renderedYaml.slots.some(slot => slot.context.startsWith("DefaultSC.SMA =") && slot.value === "6678.1363"))
    assert.equal(manifest.templateId, "electric-propulsion-transfer")
    assert.equal(manifest.inputs.script, "electric_propulsion_transfer.script")
    assert.equal(manifest.inputs.values, "electric_propulsion_transfer.values.yaml")
  })
})
