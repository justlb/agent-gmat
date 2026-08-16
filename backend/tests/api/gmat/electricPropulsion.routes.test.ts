import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { createTestConfig } from "../../helpers/testConfig.js"
import { createTestServer } from "../../helpers/createTestServer.js"

describe("electric-propulsion GMAT draft routes", () => {
  it("creates and lists a draft inside the requesting user's selected workspace", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-electric-route-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const versionDir = path.join(tempRoot, "users", "alice", "workspaces", "gmat", "versions", "v0001")
      const created = await server.inject({ method: "POST", url: "/api/gmat/electric-propulsion-transfer/drafts", headers: { "x-codex-user-id": "alice" }, payload: { workspaceDir: versionDir } })
      assert.equal(created.statusCode, 200)
      const draft = created.json() as { draftId: string; missing: string[]; templateId: string }
      assert.equal(draft.templateId, "electric-propulsion-transfer")
      assert.ok(draft.missing.includes("initialOrbit.smaKm"))
      const listed = await server.inject({ method: "GET", url: `/api/gmat/electric-propulsion-transfer/drafts?${new URLSearchParams({ workspaceDir: versionDir }).toString()}`, headers: { "x-codex-user-id": "alice" } })
      assert.equal(listed.statusCode, 200)
      assert.equal((listed.json() as { drafts: Array<{ draftId: string }> }).drafts[0].draftId, draft.draftId)
    } finally {
      await server.close()
    }
  })

  it("serves elapsed-day time-series samples for the GMAT analysis chart", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-electric-route-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const runPath = path.join(tempRoot, "users", "alice", "gmat", "electric-propulsion-transfer", "test-run")
      await fs.mkdir(runPath, { recursive: true })
      await fs.writeFile(path.join(runPath, "electric_transfer_timeseries.json"), JSON.stringify([{ elapsedDays: 2, eccentricity: 0.01, fuelMassKg: 755, semiMajorAxisKm: 7200 }]))
      const response = await server.inject({ method: "GET", url: "/api/gmat/electric-propulsion-transfer/timeseries?runPath=gmat%2Felectric-propulsion-transfer%2Ftest-run", headers: { "x-codex-user-id": "alice" } })
      assert.equal(response.statusCode, 200)
      assert.deepEqual(response.json(), { samples: [{ elapsedDays: 2, eccentricity: 0.01, fuelMassKg: 755, semiMajorAxisKm: 7200 }] })
    } finally {
      await server.close()
    }
  })

  it("lists completed electric missions saved in dated mission-run directories", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-electric-mission-run-list-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const runDir = path.join(tempRoot, "users", "alice", "gmat", "mission-runs", "26-08-12_16-08")
      await fs.mkdir(runDir, { recursive: true })
      await fs.writeFile(path.join(runDir, "run_manifest.json"), JSON.stringify({ templateId: "electric-propulsion-transfer", status: "completed" }))
      await fs.writeFile(path.join(runDir, "electric_propulsion_transfer.script"), "Create Spacecraft DefaultSC;")
      await fs.writeFile(path.join(runDir, "gmat_result.json"), JSON.stringify({ status: "completed" }))

      const response = await server.inject({ method: "GET", url: "/api/gmat/electric-propulsion-transfer/files", headers: { "x-codex-user-id": "alice" } })
      assert.equal(response.statusCode, 200)
      const files = (response.json() as { files: Array<{ artifactId: string; fileName: string; relativePath: string }> }).files
      assert.deepEqual(files.map(file => file.fileName).sort(), ["electric_propulsion_transfer.script", "gmat_result.json"])
      assert.ok(files.every(file => file.artifactId === "26-08-12_16-08" && file.relativePath.includes("gmat")))
    } finally {
      await server.close()
    }
  })
})
