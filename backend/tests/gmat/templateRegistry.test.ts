import assert from "node:assert/strict"
import test from "node:test"

import { gmatTemplateDefinition, isGmatTemplateId } from "../../src/gmat/templateRegistry.js"

test("GMAT template registry provides the shared identifiers and draft locations", () => {
  assert.equal(isGmatTemplateId("chemical-hohmann-transfer"), true)
  assert.equal(isGmatTemplateId("unknown-template"), false)
  assert.deepEqual(gmatTemplateDefinition("orbit-keeping").draftDirectory, ["gmat", "drafts"])
  assert.equal(gmatTemplateDefinition("electric-propulsion-transfer").analysisRequestKey, "electric_propulsion_transfer")
})
