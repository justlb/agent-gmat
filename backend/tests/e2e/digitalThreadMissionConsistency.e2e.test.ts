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
    assert.equal(seed.values["power.busLoadKw"], 1.5)
    assert.equal(seed.values["spacecraft.dragAreaM2"], 2)
    assert.equal(seed.values["spacecraft.dragCoefficient"], 2.2)
    assert.equal(selected.satellite.bus.opalis.power_distribution.constant_load_w, 1500)
    assert.equal(selected.satellite.bus.opalis.power_distribution.margin_w, 840)

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
        ["transfer.finalAltitudeKm", 550],
      ]),
    })

    // The deterministic adapter must derive SMA, while the LLM only supplied altitude.
    assert.equal(draft.values["initialOrbit.smaKm"], 6678.1363)
    assert.equal(draft.values["transfer.finalAltitudeKm"], 550)
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
      assert.equal(document.analysis_requests.gmat.electric_propulsion_transfer.target_final_altitude_km, 550)
    }

    const savedSatellite = JSON.parse(await fs.readFile(path.join(planning.workspaceDir, "satellite.json"), "utf8"))
    assert.equal(savedSatellite.satellite.orbit.keplerian_elements.semi_major_axis_km, 6678.1363)
    const savedDraftYaml = parseDocument(await fs.readFile(path.join(planning.workspaceDir, "electric_propulsion_transfer.values.yaml"), "utf8")).toJS() as {
      values: Record<string, unknown>
    }
    assert.equal(savedDraftYaml.values["initialOrbit.smaKm"], 6678.1363)
    assert.equal(savedDraftYaml.values["transfer.finalAltitudeKm"], 550)

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
    const renderedYaml = parseDocument(await fs.readFile(generated.valuesPath, "utf8")).toJS() as {
      slots: Array<{ context: string; value: string }>
      script_calibration: { fixedEfficiency: number; ispSeconds: number; nominalThrustNewtons: number }
    }
    const manifest = JSON.parse(await fs.readFile(generated.manifestPath, "utf8")) as { inputs: { script: string; values: string }; templateId: string }

    assert.match(script, /DefaultSC\.SMA\s*= 6678\.1363;/u)
    assert.match(script, /DefaultSC\.ECC\s*= 0;/u)
    assert.match(script, /DefaultSC\.INC\s*= 0;/u)
    assert.match(script, /DefaultSC\.DryMass\s*= 296;/u)
    assert.match(script, /DefaultSC\.DragArea\s*= 2;/u)
    assert.match(script, /DefaultSC\.Cd\s*= 2\.2;/u)
    assert.match(script, /ElectricTank1\.FuelMass\s*= 10;/u)
    assert.match(script, /targetFinalAltitudeKm\s*= 550;/u)
    assert.match(script, /ElectricThruster1\.ThrustModel = FixedEfficiency;/u)
    assert.match(script, /ElectricThruster1\.Isp = 4200;/u)
    assert.match(script, /ElectricThruster1\.FixedEfficiency = 0\.73549875;/u)
    assert.match(script, /ElectricThruster1\.DutyCycle = 1;/u)
    const calibration = JSON.parse(await fs.readFile(path.join(generated.runDir, "electric_propulsion_calibration.json"), "utf8")) as { nominalThrustNewtons: number; dutyCycle: number; fixedEfficiency: number; declaredFixedEfficiency: number }
    assert.equal(calibration.nominalThrustNewtons, 0.15)
    assert.equal(calibration.dutyCycle, 1)
    assert.equal(calibration.fixedEfficiency, 0.73549875)
    assert.equal(calibration.declaredFixedEfficiency, 0.73549875)
    assert.ok(renderedYaml.slots.some(slot => slot.context.startsWith("DefaultSC.SMA =") && slot.value === "6678.1363"))
    assert.equal(renderedYaml.script_calibration.nominalThrustNewtons, 0.15)
    assert.equal(renderedYaml.script_calibration.ispSeconds, 4200)
    assert.equal(renderedYaml.script_calibration.fixedEfficiency, 0.73549875)
    assert.equal(manifest.templateId, "electric-propulsion-transfer")
    assert.equal(manifest.inputs.script, "electric_propulsion_transfer.script")
    assert.equal(manifest.inputs.values, "electric_propulsion_transfer.values.yaml")
  })
})
