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
    // Validated with GMAT Console 2026a on 2026-09-02. Hashes use LF so
    // Windows/WSL checkout policy cannot invalidate an unchanged template.
    sha256: "ea2372c9c35efce890ff6fbf0e50eb19819f08a8273cf94df6dc003d81e5f2ae",
    render: (template: string) => renderOrbitKeepingValues(template, extractOrbitKeepingValues(template)),
  },
  {
    id: "electric-propulsion-transfer",
    path: defaultElectricPropulsionTemplatePath,
    // Approved electric-transfer reference after the calibrated propulsion
    // parameters were updated and validated manually in GMAT.
    sha256: "38f943aa815d6a7e506f783ae9338b60483e791bc6ab88df14d72974403507d6",
    render: (template: string) => renderElectricPropulsionValues(template, extractElectricPropulsionValues(template)),
  },
] as const

describe("GMAT reference templates", () => {
  for (const reference of REFERENCE_TEMPLATES) {
    it(`${reference.id} remains the approved reference and round-trips unchanged`, async () => {
      const template = await fs.readFile(reference.path(), "utf8")
      const sha256 = createHash("sha256").update(template.replace(/\r\n/gu, "\n")).digest("hex")

      assert.equal(sha256, reference.sha256)
      assert.equal(reference.render(template), template)
    })
  }
})
