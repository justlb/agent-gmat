import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createChemicalHohmannDraft, discussChemicalHohmannDraft, recordChemicalHohmannDraftRun } from "../../src/gmat/chemicalHohmannDraft.js"

test("chemical Hohmann discussion sends the saved conversation and current values to the next LLM turn", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "chemical-hohmann-memory-"))
  try {
    const connection = { apiKey: "test", baseUrl: "https://example.test/v1", model: "test-model" }
    const first = await discussChemicalHohmannDraft({
      connection,
      draft: await createChemicalHohmannDraft(workspaceDir),
      message: "Start from 300 km.",
      workspaceDir,
      fetchImpl: async () => new Response(JSON.stringify({ output_text: "message: Initial altitude recorded.\nupdates:\n  - path: initialOrbit.altitudeKm\n    value: 300" }), { status: 200 }),
    })
    let prompt = ""
    await discussChemicalHohmannDraft({
      connection,
      draft: first,
      message: "Use 15 degrees inclination.",
      workspaceDir,
      fetchImpl: async (_input, init) => {
        prompt = String(init?.body)
        return new Response(JSON.stringify({ output_text: "message: Inclination recorded.\nupdates:\n  - path: initialOrbit.inclinationDeg\n    value: 15" }), { status: 200 })
      },
    })
    assert.match(prompt, /Start from 300 km\./u)
    assert.match(prompt, /initialOrbit\.smaKm/u)
    assert.match(prompt, /6678\.1363/u)
  } finally {
    await fs.rm(workspaceDir, { force: true, recursive: true })
  }
})

test("chemical Hohmann executions are retained in the shared run comparison index", async () => {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "chemical-hohmann-runs-"))
  try {
    const draft = await createChemicalHohmannDraft(workspaceDir)
    const confirmed = { ...draft, confirmed: true, missing: [], status: "confirmed" as const }
    await fs.writeFile(path.join(workspaceDir, "gmat", "chemical-hohmann-transfer", "drafts", draft.draftId, "draft.json"), `${JSON.stringify(confirmed, null, 2)}\n`)
    const saved = await recordChemicalHohmannDraftRun(workspaceDir, draft.draftId, {
      completedAt: "2026-08-16T12:00:00.000Z", result: { status: "completed" }, runId: "2026-08-16T12-00-00-000Z", runPath: "artifact-history/gmat/2026-08-16T12-00-00-000Z",
    })
    assert.equal(saved.runs.length, 1)
    const comparison = JSON.parse(await fs.readFile(path.join(workspaceDir, "gmat", "chemical-hohmann-transfer", "drafts", draft.draftId, "run-comparison.json"), "utf8")) as { entries: Array<{ run_id: string }> }
    assert.deepEqual(comparison.entries.map(entry => entry.run_id), ["2026-08-16T12-00-00-000Z"])
  } finally {
    await fs.rm(workspaceDir, { force: true, recursive: true })
  }
})
