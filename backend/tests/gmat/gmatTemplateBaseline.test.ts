import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import { describe, it } from "node:test"

import { defaultElectricPropulsionTemplatePath } from "../../src/gmat/electricPropulsionTemplate.js"
import { extractElectricPropulsionValues, renderElectricPropulsionValues } from "../../src/gmat/electricPropulsionValues.js"
import { defaultOrbitKeepingTemplatePath } from "../../src/gmat/orbitKeepingTemplate.js"
import { extractOrbitKeepingValues, renderOrbitKeepingValues } from "../../src/gmat/orbitKeepingValues.js"

/**
 * These hashes deliberately make a GMAT template change an explicit review
 * decision. Update a hash only after validating the new script manually in
 * GMAT Console/GUI and recording the reason in the change.
 */
const REFERENCE_TEMPLATES = [
  {
    id: "orbit-keeping",
    path: defaultOrbitKeepingTemplatePath,
    sha256: "da8ecc5676b8b159cc73cab84d076b0c6c130bbdffe39c4bed2547e75af99e2e",
    render: (template: string) => renderOrbitKeepingValues(template, extractOrbitKeepingValues(template)),
  },
  {
    id: "electric-propulsion-transfer",
    path: defaultElectricPropulsionTemplatePath,
    sha256: "83dd351fbf5081dc5d5bc72caad7cb55facf30643c1773533350387d942f6e15",
    render: (template: string) => renderElectricPropulsionValues(template, extractElectricPropulsionValues(template)),
  },
] as const

describe("GMAT reference templates", () => {
  for (const reference of REFERENCE_TEMPLATES) {
    it(`${reference.id} remains the approved reference and round-trips unchanged`, async () => {
      const template = await fs.readFile(reference.path(), "utf8")
      const sha256 = createHash("sha256").update(template).digest("hex")

      assert.equal(sha256, reference.sha256)
      assert.equal(reference.render(template), template)
    })
  }
})
