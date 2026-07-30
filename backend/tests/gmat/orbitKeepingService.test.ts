import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { generateOrbitKeepingMission } from "../../src/gmat/orbitKeeping.service.js"
import { defaultOrbitKeepingTemplatePath } from "../../src/gmat/orbitKeepingTemplate.js"
import { extractOrbitKeepingValues } from "../../src/gmat/orbitKeepingValues.js"

const connection = { apiKey: "test-key", baseUrl: "https://model.example.test/v1", model: "test-model" }

describe("orbit keeping service", () => {
  it("makes exactly one LLM request and writes the requested values into an unchanged template", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-orbit-service-"))
    const sourceTemplate = await fs.readFile(defaultOrbitKeepingTemplatePath(), "utf8")
    const sourceValues = extractOrbitKeepingValues(sourceTemplate)
    const dryMassId = sourceValues.slots.find((slot) => slot.context.includes("DefaultSC.DryMass"))?.id
    const dragAreaId = sourceValues.slots.find((slot) => slot.context.includes("DefaultSC.DragArea"))?.id
    assert.ok(dryMassId)
    assert.ok(dragAreaId)
    let calls = 0
    const progress: Array<{ key: string; status: string }> = []
    const result = await generateOrbitKeepingMission({
      connection,
      request: "Change dry mass to 200 kg and drag area to 10 m2.",
      workspaceDir,
      artifactId: "test-mission",
      fetchImpl: async () => {
        calls += 1
        return new Response(JSON.stringify({ output_text: `changes:\n  - id: ${dryMassId}\n    value: '200'\n  - id: ${dragAreaId}\n    value: '10'` }), { status: 200 })
      },
      onProgress: event => progress.push({ key: event.key, status: event.status }),
    })

    assert.equal(calls, 1)
    assert.deepEqual(progress, [
      { key: "load_template", status: "running" },
      { key: "load_template", status: "completed" },
      { key: "llm_patch", status: "running" },
      { key: "llm_patch", status: "completed" },
      { key: "render_script", status: "running" },
      { key: "render_script", status: "completed" },
      { key: "save_results", status: "running" },
      { key: "save_results", status: "completed" },
    ])
    assert.match(result.valuesPath, /gmat[\\/]orbit-keeping[\\/]test-mission[\\/]orbit_keeping\.values\.yaml$/u)
    const [sourceScript, script, values] = await Promise.all([
      fs.readFile(defaultOrbitKeepingTemplatePath(), "utf8"),
      fs.readFile(result.scriptPath, "utf8"),
      fs.readFile(result.valuesPath, "utf8"),
    ])
    assert.match(script, /DefaultSC\.DryMass\s+= 200;/u)
    assert.match(script, /DefaultSC\.DragArea\s+= 10;/u)
    assert.equal(
      script
        .replace("= 200;", "= 300;")
        .replace("= 10;", "= 15;")
        .replace(/ReboostReport\.Filename = '[^']+';/u, "ReboostReport.Filename = 'ReboostReport.txt';")
        .replace(/OrbitAnalysisReport\.Filename = '[^']+';/u, "OrbitAnalysisReport.Filename = 'OrbitAnalysisReport.txt';"),
      sourceScript,
    )
    assert.match(values, /value: "200"/u)
    assert.match(values, /value: "10"/u)
    assert.deepEqual(result.result, { reportSampleCount: 0, status: "generated", timeSeriesSampleCount: 0 })
    await Promise.all([
      fs.access(result.manifestPath),
      fs.access(result.resultPath),
      fs.access(result.timeSeriesPath),
    ])
  })

  it("does not retry or create artefacts when the LLM request fails", async () => {
    const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-orbit-service-"))
    let calls = 0
    await assert.rejects(
      generateOrbitKeepingMission({
        connection,
        request: "Change dry mass to 200 kg.",
        workspaceDir,
        fetchImpl: async () => {
          calls += 1
          return new Response("unavailable", { status: 503 })
        },
      }),
      /HTTP 503/u,
    )
    assert.equal(calls, 1)
    await assert.rejects(fs.access(path.join(workspaceDir, "gmat", "orbit-keeping")))
  })
})
