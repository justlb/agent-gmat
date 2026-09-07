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
    sha256: "e966bf098498daf09db2750d17b01bc47b83707d549c3e4f928279dc8924717b",
    render: (template: string) => renderOrbitKeepingValues(template, extractOrbitKeepingValues(template)),
  },
  {
    id: "electric-propulsion-transfer",
    path: defaultElectricPropulsionTemplatePath,
    // Approved electric-transfer reference after the calibrated propulsion
    // parameters were updated and validated manually in GMAT.
    sha256: "4bcc4011f989de86440ce2ae0a78cd456fffc01f9c07eab54c6d49aa94a3108b",
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
