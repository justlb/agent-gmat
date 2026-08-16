import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, it } from "node:test"

import { createTestConfig } from "../../helpers/testConfig.js"
import { createTestServer } from "../../helpers/createTestServer.js"

describe("chemical Hohmann GMAT file routes", () => {
  it("lists drafts and only exposes approved artifacts from the selected mission run", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-hohmann-route-"))
    const server = await createTestServer({ config: createTestConfig({ workspace: { usersRoot: path.join(tempRoot, "users") } }) })
    try {
      const workspaceDir = path.join(tempRoot, "users", "alice", "gmat", "mission-runs", "26-08-16_12-26")
      const draftId = "draft_01234567-89ab-cdef-0123-456789abcdef"
      const draftDir = path.join(workspaceDir, "gmat", "chemical-hohmann-transfer", "drafts", draftId)
      await fs.mkdir(draftDir, { recursive: true })
      await fs.writeFile(path.join(draftDir, "draft.json"), JSON.stringify({ confirmed: false, conversation: [], createdAt: "2026-08-16T12:26:00.000Z", draftId, missing: [], status: "collecting", templateId: "chemical-hohmann-transfer", updatedAt: "2026-08-16T12:26:00.000Z", values: {} }))
      await Promise.all([
        fs.writeFile(path.join(workspaceDir, "chemical_hohmann_transfer.script"), "Create Spacecraft DefaultSC;"),
        fs.writeFile(path.join(workspaceDir, "gmat_result.json"), JSON.stringify({ status: "completed" })),
        fs.mkdir(path.join(workspaceDir, "artifact-history", "rf-comlink", "2026-08-16T12-30-00-000Z", "rf-comlink", "03-results"), { recursive: true }),
        fs.writeFile(path.join(workspaceDir, "unrelated.txt"), "private"),
      ])
      await fs.writeFile(path.join(workspaceDir, "artifact-history", "rf-comlink", "2026-08-16T12-30-00-000Z", "rf-comlink", "03-results", "rf-comlink-results.json"), JSON.stringify({ reports: [] }))

      const query = new URLSearchParams({ workspaceDir }).toString()
      const headers = { "x-codex-user-id": "alice" }
      const drafts = await server.inject({ method: "GET", url: `/api/gmat/chemical-hohmann-transfer/drafts?${query}`, headers })
      assert.equal(drafts.statusCode, 200)
      assert.equal((drafts.json() as { drafts: Array<{ draftId: string }> }).drafts[0].draftId, draftId)

      const files = await server.inject({ method: "GET", url: `/api/gmat/chemical-hohmann-transfer/files?${query}`, headers })
      assert.equal(files.statusCode, 200)
      const listed = (files.json() as { files: Array<{ fileName: string; relativePath: string }> }).files
      assert.deepEqual(listed.map(file => file.fileName).sort(), ["chemical_hohmann_transfer.script", "gmat_result.json", "rf-comlink-results.json"])
      const historical = (files.json() as { files: Array<{ fileName: string; historical?: boolean; relativePath: string }> }).files.find(file => file.fileName === "rf-comlink-results.json")
      assert.equal(historical?.historical, true)

      const download = await server.inject({ method: "GET", url: `/api/gmat/chemical-hohmann-transfer/files/download?${new URLSearchParams({ workspaceDir, relativePath: historical!.relativePath }).toString()}`, headers })
      assert.equal(download.statusCode, 200)
      const blocked = await server.inject({ method: "GET", url: `/api/gmat/chemical-hohmann-transfer/files/download?${new URLSearchParams({ workspaceDir, relativePath: path.relative(path.join(tempRoot, "users", "alice"), path.join(workspaceDir, "unrelated.txt")) }).toString()}`, headers })
      assert.equal(blocked.statusCode, 404)
    } finally {
      await server.close()
    }
  })
})
