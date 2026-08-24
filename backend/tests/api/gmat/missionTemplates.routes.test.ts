import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { createPlanningRun } from "../../../src/runs/missionRunService.js"
import { selectSatelliteDefinition } from "../../../src/digitalThread/satelliteLibrary.js"
import { createTestServer } from "../../helpers/createTestServer.js"
import { createTestConfig } from "../../helpers/testConfig.js"

describe("generic GMAT mission template routes", () => {
  it("exposes one validated draft lifecycle for every registered template", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-template-contract-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const headers = { "x-codex-user-id": "alice" }
      const scenarios = [
        { satelliteId: "ref-leo-orbit-keeping", template: "orbit-keeping" },
        { satelliteId: "fudan-satellite", template: "electric-propulsion-transfer" },
        { satelliteId: "ref-leo-orbit-keeping", template: "chemical-hohmann-transfer" },
      ] as const
      for (const [index, scenario] of scenarios.entries()) {
        const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", "gmat", "versions", `v${String(index + 1).padStart(4, "0")}`)
        const planningRun = await createPlanningRun(workspaceDir)
        await selectSatelliteDefinition(planningRun.workspaceDir, scenario.satelliteId, "1.0.0")
        const create = await server.inject({ method: "POST", url: `/api/gmat/templates/${scenario.template}/drafts`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
        assert.equal(create.statusCode, 200, scenario.template)
        const draft = create.json() as { draftId: string; templateId: string }
        assert.equal(draft.templateId, scenario.template)
        const list = await server.inject({ method: "GET", url: `/api/gmat/templates/${scenario.template}/drafts?${new URLSearchParams({ workspaceDir: planningRun.workspaceDir })}`, headers })
        assert.equal(list.statusCode, 200, scenario.template)
        assert.equal((list.json() as { drafts: Array<{ draftId: string }> }).drafts.some(candidate => candidate.draftId === draft.draftId), false, scenario.template)
      }
    } finally { await server.close() }
  })

  it("creates, updates, and reloads a chemical Hohmann draft through the shared API", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-template-routes-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", "gmat", "versions", "v0001")
      const planningRun = await createPlanningRun(workspaceDir)
      await selectSatelliteDefinition(planningRun.workspaceDir, "ref-leo-orbit-keeping", "1.0.0")
      const headers = { "x-codex-user-id": "alice" }

      const create = await server.inject({ method: "POST", url: "/api/gmat/templates/chemical-hohmann-transfer/drafts", headers, payload: { workspaceDir: planningRun.workspaceDir } })
      assert.equal(create.statusCode, 200)
      const draft = create.json() as { draftId: string; values: Record<string, unknown> }
      assert.match(draft.draftId, /^draft_/u)

      const update = await server.inject({ method: "PATCH", url: `/api/gmat/templates/chemical-hohmann-transfer/drafts/${draft.draftId}/values`, headers, payload: { path: "transfer.targetRadiusKm", value: "7378.1363", workspaceDir: planningRun.workspaceDir } })
      assert.equal(update.statusCode, 200)
      assert.equal((update.json() as { values: Record<string, unknown> }).values["transfer.targetRadiusKm"], 7378.1363)

      const reload = await server.inject({ method: "GET", url: `/api/gmat/templates/chemical-hohmann-transfer/drafts/${draft.draftId}?${new URLSearchParams({ workspaceDir: planningRun.workspaceDir })}`, headers })
      assert.equal(reload.statusCode, 200)
      assert.equal((reload.json() as { values: Record<string, unknown> }).values["transfer.targetRadiusKm"], 7378.1363)
    } finally { await server.close() }
  })

  it("persists the first manual value through the legacy Mission Studio endpoint", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-mission-values-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", "gmat", "versions", "v0001")
      const planningRun = await createPlanningRun(workspaceDir)
      await selectSatelliteDefinition(planningRun.workspaceDir, "ref-leo-orbit-keeping", "1.0.0")
      const response = await server.inject({
        method: "PATCH",
        url: "/api/gmat/mission-values",
        headers: { "x-codex-user-id": "alice" },
        payload: {
          path: "transfer.targetRadiusKm",
          template: "chemical-hohmann-transfer",
          value: "7378.1363",
          workspaceDir: planningRun.workspaceDir,
        },
      })
      assert.equal(response.statusCode, 200)
      const payload = response.json() as { draft: { draftId: string; values: Record<string, unknown> } }
      assert.match(payload.draft.draftId, /^draft_/u)
      assert.equal(payload.draft.values["transfer.targetRadiusKm"], 7378.1363)
    } finally { await server.close() }
  })

  it("generates and exposes Hohmann artifacts through the generic template API", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-hohmann-generic-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const workspaceDir = path.join(tempRoot, "users", "alice", "workspaces", "gmat", "versions", "v0001")
      const planningRun = await createPlanningRun(workspaceDir)
      await selectSatelliteDefinition(planningRun.workspaceDir, "ref-leo-orbit-keeping", "1.0.0")
      const headers = { "x-codex-user-id": "alice" }
      const base = "/api/gmat/templates/chemical-hohmann-transfer"
      const create = await server.inject({ method: "POST", url: `${base}/drafts`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
      assert.equal(create.statusCode, 200)
      const draftId = (create.json() as { draftId: string }).draftId
      const values = [
        ["initialOrbit.epoch", "31258.66709490726"],
        ["initialOrbit.smaKm", "6678.1363"],
        ["initialOrbit.eccentricity", "0"],
        ["initialOrbit.inclinationDeg", "0"],
        ["transfer.targetRadiusKm", "7378.1363"],
      ] as const
      for (const [fieldPath, value] of values) {
        const update = await server.inject({ method: "PATCH", url: `${base}/drafts/${draftId}/values`, headers, payload: { path: fieldPath, value, workspaceDir: planningRun.workspaceDir } })
        assert.equal(update.statusCode, 200, fieldPath)
      }
      const confirm = await server.inject({ method: "POST", url: `${base}/drafts/${draftId}/confirm`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
      assert.equal(confirm.statusCode, 200, confirm.body)
      const execute = await server.inject({ method: "POST", url: `${base}/drafts/${draftId}/execute`, headers, payload: { workspaceDir: planningRun.workspaceDir } })
      assert.equal(execute.statusCode, 200, execute.body)

      const listedDrafts = await server.inject({ method: "GET", url: `${base}/drafts?${new URLSearchParams({ workspaceDir: planningRun.workspaceDir })}`, headers })
      assert.equal((listedDrafts.json() as { drafts: Array<{ draftId: string }> }).drafts.some(draft => draft.draftId === draftId), true)
      const listedFiles = await server.inject({ method: "GET", url: `${base}/files?${new URLSearchParams({ workspaceDir: planningRun.workspaceDir })}`, headers })
      assert.equal(listedFiles.statusCode, 200, listedFiles.body)
      const files = (listedFiles.json() as { files: Array<{ draftId?: string; fileName: string; relativePath: string }> }).files
      assert.equal(files.some(file => file.fileName === "chemical_hohmann_transfer.script" && file.draftId === draftId), true)
      assert.equal(files.some(file => file.fileName === "run_manifest.json"), true)
      const valuesFile = files.find(file => file.fileName === "chemical_hohmann_transfer.values.yaml")
      assert.ok(valuesFile)
      const download = await server.inject({ method: "GET", url: `${base}/files/download?${new URLSearchParams({ relativePath: valuesFile.relativePath, workspaceDir: planningRun.workspaceDir })}`, headers })
      assert.equal(download.statusCode, 200)
      assert.match(download.body, new RegExp(`draft_id: ${draftId}`, "u"))
    } finally { await server.close() }
  })
})
