import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { analyzeChemicalHohmannRunWithLlm } from "../../src/gmat/chemicalHohmannAnalysis.js"

test("chemical Hohmann analysis receives immutable run comparison entries", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "chemical-hohmann-analysis-"))
  try {
    await Promise.all([
      fs.writeFile(path.join(runDir, "run_manifest.json"), JSON.stringify({ runId: "active-run", templateId: "chemical-hohmann-transfer" })),
      fs.writeFile(path.join(runDir, "gmat_result.json"), JSON.stringify({ status: "completed" })),
    ])
    let prompt = ""
    const result = await analyzeChemicalHohmannRunWithLlm({
      connection: { apiKey: "test", baseUrl: "https://model.example.test/v1", model: "test" }, question: "What changed?", runDir,
      relatedRuns: [
        { completedAt: "2026-08-16T10:00:00Z", missionValues: { "transfer.targetRadiusKm": 7000 }, result: { status: "completed" }, runId: "version-1", runPath: "artifact-history/gmat/version-1" },
        { completedAt: "2026-08-16T11:00:00Z", missionValues: { "transfer.targetRadiusKm": 8000 }, result: { status: "completed" }, runId: "version-2", runPath: "artifact-history/gmat/version-2" },
      ],
      fetchImpl: async (_input, init) => {
        prompt = String(init?.body)
        return new Response(JSON.stringify({ output_text: "The target radius changed." }), { status: 200 })
      },
    })
    assert.equal(result.answer, "The target radius changed.")
    assert.match(prompt, /artifact-history\/gmat\/version-2/u)
    assert.match(prompt, /targetRadiusKm/u)
  } finally {
    await fs.rm(runDir, { force: true, recursive: true })
  }
})
