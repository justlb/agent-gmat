import assert from "node:assert/strict"
import { mkdtemp, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import {
  extractResponseText,
  loadProbeConfig,
  runChatModelProbe,
} from "./check_chat_model_endpoint.mjs"

describe("chat model endpoint probe", () => {
  it("sends exactly one minimal Responses API request", async () => {
    const calls = []
    const result = await runChatModelProbe({
      config: {
        apiKey: "secret-test-key",
        baseUrl: "https://model.example.test/v1",
        model: "test-model",
      },
      fetchImpl: async (input, init) => {
        calls.push({ input, init })
        return new Response(JSON.stringify({ output_text: "GMAT_PROBE_OK" }), { status: 200 })
      },
      timeoutMs: 1_000,
    })

    assert.equal(calls.length, 1)
    assert.equal(calls[0].input, "https://model.example.test/v1/responses")
    assert.equal(calls[0].init.method, "POST")
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      input: "Reply with exactly: GMAT_PROBE_OK",
      max_output_tokens: 16,
      model: "test-model",
    })
    assert.equal(calls[0].init.headers.Authorization, "Bearer secret-test-key")
    assert.equal(result.ok, true)
    assert.equal(result.responseText, "GMAT_PROBE_OK")
    assert.doesNotMatch(JSON.stringify(result), /secret-test-key/u)
  })

  it("does not retry after an HTTP error", async () => {
    let callCount = 0
    await assert.rejects(
      runChatModelProbe({
        config: {
          apiKey: "secret-test-key",
          baseUrl: "https://model.example.test/v1",
          model: "test-model",
        },
        fetchImpl: async () => {
          callCount += 1
          return new Response("failure", { status: 503 })
        },
      }),
      /HTTP 503/u,
    )
    assert.equal(callCount, 1)
  })

  it("loads config with environment overrides without exposing the key", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "gmat-llm-probe-"))
    const configPath = path.join(directory, "config.json")
    await writeFile(configPath, JSON.stringify({
      chatModel: {
        apiKey: "file-key",
        baseUrl: "https://file.example.test/v1/",
        model: "file-model",
      },
    }))

    const config = await loadProbeConfig(configPath, {
      CHAT_MODEL_API_KEY: "env-key",
      CHAT_MODEL_BASE_URL: "https://env.example.test/v1/",
      CHAT_MODEL_NAME: "env-model",
    })

    assert.deepEqual(config, {
      apiKey: "env-key",
      baseUrl: "https://env.example.test/v1",
      model: "env-model",
    })
  })

  it("extracts text from compatible nested Responses payloads", () => {
    assert.equal(extractResponseText({
      output: [{ content: [{ type: "output_text", text: " GMAT_PROBE_OK " }] }],
    }), "GMAT_PROBE_OK")
  })
})
