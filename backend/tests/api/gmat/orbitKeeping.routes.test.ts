import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"
import Fastify from "fastify"

import { createTestConfig } from "../../helpers/testConfig.js"
import { createTestServer } from "../../helpers/createTestServer.js"
import { defaultOrbitKeepingTemplatePath } from "../../../src/gmat/orbitKeepingTemplate.js"
import { extractOrbitKeepingValues } from "../../../src/gmat/orbitKeepingValues.js"

describe("POST /api/gmat/orbit-keeping/generate", () => {
  it("returns generated artefacts inside the requesting user's workspace", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-orbit-route-"))
    const template = await fs.readFile(defaultOrbitKeepingTemplatePath(), "utf8")
    const values = extractOrbitKeepingValues(template)
    const dryMassId = values.slots.find((slot) => slot.context.includes("DefaultSC.DryMass"))?.id
    const dragAreaId = values.slots.find((slot) => slot.context.includes("DefaultSC.DragArea"))?.id
    assert.ok(dryMassId)
    assert.ok(dragAreaId)
    let modelCalls = 0
    const fakeModel = Fastify()
    fakeModel.post("/v1/responses", async () => {
      modelCalls += 1
      if (modelCalls > 1) return { output_text: "Run analysis: the saved result is available without rerunning GMAT." }
      return {
        output_text: `changes:\n  - id: ${dryMassId}\n    value: '200'\n  - id: ${dragAreaId}\n    value: '10'`,
      }
    })
    await fakeModel.listen({ host: "127.0.0.1", port: 0 })
    const address = fakeModel.server.address()
    assert.ok(address && typeof address !== "string")

    const server = await createTestServer({
      config: createTestConfig({
        chatModel: { baseUrl: `http://127.0.0.1:${address.port}/v1` },
        workspace: { usersRoot: path.join(tempRoot, "users") },
      }),
    })
    try {
      const versionDir = path.join(tempRoot, "users", "alice", "workspaces", "gmat", "versions", "v0001")
      const response = await server.inject({
        method: "POST",
        url: "/api/gmat/orbit-keeping/generate",
        headers: { "x-codex-user-id": "alice" },
        payload: { request: "Change dry mass to 200 kg and drag area to 10 m2.", workspaceDir: versionDir },
      })
      const body = response.json() as { changes: Array<{ id: string; value: string }>; runPath: string; scriptPath: string; valuesPath: string }
      const aliceRoot = path.join(tempRoot, "users", "alice")

      assert.equal(response.statusCode, 200)
      assert.equal(modelCalls, 1)
      assert.equal(body.changes.length, 2)
      assert.ok(body.scriptPath.startsWith(versionDir))
      assert.ok(body.valuesPath.startsWith(versionDir))
      assert.equal(body.scriptPath.includes("output_data"), false)
      const [script, values] = await Promise.all([fs.readFile(body.scriptPath, "utf8"), fs.readFile(body.valuesPath, "utf8")])
      assert.match(script, /DefaultSC\.DryMass\s+= 200;/u)
      assert.match(script, /DefaultSC\.DragArea\s+= 10;/u)
      assert.match(values, /value: "200"/u)
      assert.match(values, /value: "10"/u)

      const runDirectory = path.basename(path.dirname(body.scriptPath))
      const listResponse = await server.inject({
        method: "GET",
        url: "/api/gmat/orbit-keeping/files",
        headers: { "x-codex-user-id": "alice" },
      })
      assert.equal(listResponse.statusCode, 200)
      const listedFiles = listResponse.json().files as Array<{ fileName: string; relativePath: string }>
      assert.deepEqual(listedFiles.map(file => file.fileName).sort(), [
        "gmat_result.json",
        "orbit_keeping.script",
        "orbit_keeping.values.yaml",
        "run_manifest.json",
      ])
      assert.match(runDirectory, /^\d{2}-\d{2}-\d{2}_\d{2}-\d{2}$/u)

      const downloadResponse = await server.inject({
        method: "GET",
        url: `/api/gmat/orbit-keeping/files/download?relativePath=${encodeURIComponent(listedFiles.find(file => file.fileName.endsWith(".script"))?.relativePath ?? "")}`,
        headers: { "x-codex-user-id": "alice" },
      })
      assert.equal(downloadResponse.statusCode, 200)
      assert.match(downloadResponse.body, /DefaultSC\.DryMass\s+= 200;/u)

      const scriptMtimeBeforeAnalysis = (await fs.stat(body.scriptPath)).mtimeMs
      const analysisResponse = await server.inject({
        method: "POST",
        url: "/api/gmat/orbit-keeping/analyze",
        headers: { "x-codex-user-id": "alice" },
        payload: { question: "What happened in this run?", runPath: body.runPath },
      })
      assert.equal(analysisResponse.statusCode, 200)
      assert.match(analysisResponse.json().answer, /without rerunning GMAT/u)
      assert.equal(modelCalls, 2)
      assert.equal((await fs.stat(body.scriptPath)).mtimeMs, scriptMtimeBeforeAnalysis)
      await fs.access(path.join(path.dirname(body.scriptPath), "conversation.json"))
    } finally {
      await server.close()
      await fakeModel.close()
    }
  })

  it("rejects an empty request before contacting the model", async () => {
    const server = await createTestServer()
    try {
      const response = await server.inject({ method: "POST", url: "/api/gmat/orbit-keeping/generate", payload: { request: "  " } })
      assert.equal(response.statusCode, 400)
      assert.deepEqual(response.json(), { error: "request must be a non-empty string" })
    } finally {
      await server.close()
    }
  })

  it("rejects a workspace outside the requesting user's root", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-orbit-route-"))
    const server = await createTestServer({
      config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }),
    })
    try {
      const response = await server.inject({
        method: "POST",
        url: "/api/gmat/orbit-keeping/generate",
        headers: { "x-codex-user-id": "alice" },
        payload: { request: "Change dry mass to 100 kg.", workspaceDir: path.join(tempRoot, "other-user") },
      })
      assert.equal(response.statusCode, 422)
      assert.deepEqual(response.json(), { error: "workspaceDir must be inside the current user workspace" })
    } finally {
      await server.close()
    }
  })
})
