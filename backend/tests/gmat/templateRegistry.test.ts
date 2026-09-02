import assert from "node:assert/strict"
import test from "node:test"

import fs from "node:fs"
import path from "node:path"

import { allGmatTemplateDefinitions, gmatTemplateDefinition, isGmatTemplateId } from "../../src/gmat/templateRegistry.js"

test("GMAT template registry provides the shared identifiers and draft locations", () => {
  assert.equal(isGmatTemplateId("chemical-hohmann-transfer"), true)
  assert.equal(isGmatTemplateId("unknown-template"), false)
  assert.deepEqual(gmatTemplateDefinition("orbit-keeping").draftDirectory, ["gmat", "drafts"])
  assert.equal(gmatTemplateDefinition("electric-propulsion-transfer").analysisRequestKey, "electric_propulsion_transfer")
  assert.equal(gmatTemplateDefinition("chemical-2d-transfer").ui.missionInputFields.some(field => field.path === "targetOrbit.inclinationDeg"), false)
  assert.equal(gmatTemplateDefinition("chemical-3d-transfer").ui.missionInputFields.some(field => field.path === "targetOrbit.inclinationDeg"), true)
})

test("every GMAT template manifest declares a usable and distinct workflow contract", () => {
  const definitions = allGmatTemplateDefinitions()
  assert.equal(new Set(definitions.map(template => template.id)).size, definitions.length)
  // geo-gso-electric-station-keeping is the backwards-compatible name for
  // geo-electric-station-keeping and intentionally shares its storage key and
  // chat mode. Every non-alias scenario remains distinct.
  const canonicalDefinitions = definitions.filter(template => template.id !== "geo-gso-electric-station-keeping")
  assert.equal(new Set(canonicalDefinitions.map(template => template.analysisRequestKey)).size, canonicalDefinitions.length)
  assert.equal(new Set(canonicalDefinitions.map(template => template.chatMode)).size, canonicalDefinitions.length)
  assert.equal(gmatTemplateDefinition("geo-gso-electric-station-keeping").analysisRequestKey, gmatTemplateDefinition("geo-electric-station-keeping").analysisRequestKey)

  for (const template of definitions) {
    assert.ok(template.draftDirectory.length > 0, `${template.id} has a draft directory`)
    assert.ok(template.satelliteInputs.length > 0, `${template.id} declares satellite inputs`)
    assert.ok(template.downstreamAnalyses.includes("simu-cic"), `${template.id} supports Simu-CIC`)
    assert.ok(fs.existsSync(path.join(template.skillDirectory, template.gmatReferenceScript)), `${template.id} reference script exists`)
    assert.ok(template.ui.missionInputFields.length > 0, `${template.id} declares Mission Studio input fields`)
    assert.ok(template.ui.satelliteRequirements.length > 0, `${template.id} declares Mission Studio satellite requirements`)
  }
})
