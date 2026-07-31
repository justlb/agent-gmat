import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { generateElectricPropulsionMission } from "../../src/gmat/electricPropulsion.service.js"
import { parseElectricPropulsionReport } from "../../src/gmat/electricPropulsionRunner.js"
import { defaultElectricPropulsionTemplatePath } from "../../src/gmat/electricPropulsionTemplate.js"
import { extractElectricPropulsionValues } from "../../src/gmat/electricPropulsionValues.js"

const E2E_ENABLED = process.env.OPEN_CODEX_WEB_E2E_GMAT_ELECTRIC === "1"
const GMAT_BIN = process.env.GMAT_ELECTRIC_TEST_BIN ?? ""

describe("electric-propulsion GMAT E2E", { skip: !E2E_ENABLED || !GMAT_BIN }, () => {
  it("renders the duration variable, runs GMAT, and parses a transfer report", { timeout: 180_000 }, async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-electric-e2e-"))
    const template = await fs.readFile(defaultElectricPropulsionTemplatePath(), "utf8")
    const values = extractElectricPropulsionValues(template)
    const slot = (prefix: string) => {
      const found = values.slots.find(candidate => candidate.context.startsWith(prefix))
      assert.ok(found, `template slot not found: ${prefix}`)
      return found
    }
    const change = (prefix: string, value: string) => ({ id: slot(prefix).id, value })

    const run = await generateElectricPropulsionMission({
      artifactId: "electric-e2e",
      changes: [
        change("DefaultSC.Epoch =", "'21545'"), change("DefaultSC.SMA =", "6678"), change("DefaultSC.ECC =", "0"),
        change("DefaultSC.INC =", "15"), change("DefaultSC.RAAN =", "0"), change("DefaultSC.AOP =", "0"),
        change("DefaultSC.TA =", "0"), change("DefaultSC.DryMass =", "10"), change("ElectricTank1.FuelMass =", "5"),
        change("daysofpropagation =", "2"),
      ],
      execution: { bin: GMAT_BIN, timeoutMs: 120_000 },
      request: "Electric transfer GMAT integration test",
      workspaceDir,
    })

    assert.equal(run.result.status, "completed", run.result.error)
    assert.ok(run.result.reportSampleCount > 0)
    const script = await fs.readFile(run.scriptPath, "utf8")
    const report = await fs.readFile(path.join(run.runDir, "ElectricTransferReport.txt"), "utf8")
    const samples = parseElectricPropulsionReport(report)
    assert.match(script, /daysofpropagation\s*= 2/u)
    assert.match(script, /DefaultSC\.ElapsedDays\s*= daysofpropagation/u)
    assert.match(script, /ElectricTransferReport\.Add\s*= \{DefaultSC\.ElapsedDays,/u)
    assert.ok(samples.length > 0)
    assert.ok(samples.every(sample => Number.isFinite(sample.semiMajorAxisKm) && Number.isFinite(sample.fuelMassKg)))
  })
})
