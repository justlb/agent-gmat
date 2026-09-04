import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { after, it } from "node:test"
import Fastify from "fastify"
import { runViewRoutes } from "../../../src/runs/runView.routes.js"
import { missionAssistantRoutes } from "../../../src/gmat/missionAssistant.routes.js"
import { enterRequestContext } from "../../../src/server/requestContext.js"
import { createTestConfig } from "../../helpers/testConfig.js"

const root = await fs.mkdtemp(path.join(os.tmpdir(), "results-routes-"))
after(() => fs.rm(root, { recursive: true, force: true }))

it("scopes analysis and persisted history to the selected run, with current evidence and no execution", async t => {
  const app = Fastify()
  app.addHook("onRequest", async () => { enterRequestContext({ userWorkspaceRoot: root }) })
  await app.register(runViewRoutes)
  await app.register(missionAssistantRoutes, { config: createTestConfig() })
  const runPath = "gmat/mission-runs/26-09-04_12-00"
  const runDir = path.join(root, runPath)
  await fs.mkdir(runDir, { recursive: true })
  const manifest = JSON.stringify({ runId: "26-09-04_12-00", status: "failed", templateId: "electrical-leo-orbit-maintenance" })
  await fs.writeFile(path.join(runDir, "run_manifest.json"), manifest)
  await fs.writeFile(path.join(runDir, "gmat_result.json"), JSON.stringify({ status: "failed", error: "fresh evidence" }))
  await fs.writeFile(path.join(runDir, "conversation.json"), JSON.stringify([{ question: "Prior question", answer: "Prior answer" }]))
  let prompt = ""
  const fetchMock = t.mock.method(globalThis, "fetch", async (_url, options) => {
    prompt = JSON.parse(String(options?.body)).input
    return new Response(JSON.stringify({ output_text: "GMAT failed, according to gmat_result.json." }), { status: 200 })
  })
  try {
    const response = await app.inject({ method: "POST", url: "/api/runs/analysis", payload: { runPath, message: "Pourquoi cette run a échoué ?" } })
    assert.equal(response.statusCode, 200, response.body)
    assert.equal(fetchMock.mock.callCount(), 1)
    assert.match(prompt, /fresh evidence/u)
    assert.match(prompt, /Prior question/u)
    assert.match(prompt, /untrusted evidence/u)
    assert.equal(await fs.readFile(path.join(runDir, "run_manifest.json"), "utf8"), manifest)
    const history = await app.inject({ method: "GET", url: `/api/runs/conversation?${new URLSearchParams({ runPath })}` })
    assert.equal(history.json().conversation.length, 2)
    assert.equal(history.json().conversation[1].question, "Pourquoi cette run a échoué ?")
    const samples = await app.inject({ method: "GET", url: `/api/runs/timeseries?${new URLSearchParams({ runPath })}` })
    assert.deepEqual(samples.json(), { samples: [], source: null })
    for (const invalid of ["../other/gmat/mission-runs/26-09-04_12-00", "gmat/mission-runs/not-a-run"]) {
      const blocked = await app.inject({ method: "POST", url: "/api/runs/analysis", payload: { runPath: invalid, message: "Explain" } })
      assert.equal(blocked.statusCode, 400)
      const blockedHistory = await app.inject({ method: "GET", url: `/api/runs/conversation?${new URLSearchParams({ runPath: invalid })}` })
      assert.equal(blockedHistory.statusCode, 400)
    }
    const empty = await app.inject({ method: "POST", url: "/api/runs/analysis", payload: { runPath, message: " " } })
    assert.equal(empty.statusCode, 400)
    assert.equal(fetchMock.mock.callCount(), 1)
  } finally { await app.close() }
})
