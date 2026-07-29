import assert from "node:assert/strict"
import fs from "node:fs/promises"
import { describe, it } from "node:test"

import { defaultOrbitKeepingTemplatePath } from "../../src/gmat/orbitKeepingTemplate.js"
import { editOrbitKeepingValuesWithLlm } from "../../src/gmat/orbitKeepingLlmEdit.js"
import { extractOrbitKeepingValues } from "../../src/gmat/orbitKeepingValues.js"

const connection = {
  apiKey: "test-key",
  baseUrl: "https://model.example.test/v1",
  model: "test-model",
}

describe("orbit keeping one-call LLM editor", () => {
  it("uses one LLM request and applies only returned value changes", async () => {
    const template = await fs.readFile(defaultOrbitKeepingTemplatePath(), "utf8")
    const values = extractOrbitKeepingValues(template)
    const dryMassId = values.slots.find((slot) => slot.context.includes("DefaultSC.DryMass"))?.id
    const dragAreaId = values.slots.find((slot) => slot.context.includes("DefaultSC.DragArea"))?.id
    assert.ok(dryMassId)
    assert.ok(dragAreaId)
    const calls: RequestInit[] = []
    const result = await editOrbitKeepingValuesWithLlm({
      connection,
      request: "Change dry mass to 100 kg and drag area to 30 m2.",
      values,
      fetchImpl: async (_input, init) => {
        calls.push(init ?? {})
        return new Response(JSON.stringify({
          output_text: [
            "changes:",
            `  - id: ${dryMassId}`,
            "    value: '100'",
            `  - id: ${dragAreaId}`,
            "    value: '30'",
          ].join("\n"),
        }), { status: 200 })
      },
    })

    assert.equal(calls.length, 1)
    assert.equal(JSON.parse(String(calls[0].body)).model, "test-model")
    assert.equal(result.values.slots.find((slot) => slot.id === dryMassId)?.value, "100")
    assert.equal(result.values.slots.find((slot) => slot.id === dragAreaId)?.value, "30")
  })

  it("does not retry when the model returns an error", async () => {
    const template = await fs.readFile(defaultOrbitKeepingTemplatePath(), "utf8")
    let calls = 0
    await assert.rejects(
      editOrbitKeepingValuesWithLlm({
        connection,
        request: "Change the drag area to 30.",
        values: extractOrbitKeepingValues(template),
        fetchImpl: async () => {
          calls += 1
          return new Response("failure", { status: 503 })
        },
      }),
      /HTTP 503/u,
    )
    assert.equal(calls, 1)
  })
})
