import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { loadRunManifest, updateRunManifest } from "../../src/runs/runManifest.js"

test("manifest updates preserve run identity and previously persisted context", async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), "run-manifest-"))
  const runDir = path.join(parent, "26-08-24_12-00")
  await fs.mkdir(runDir)
  try {
    await updateRunManifest(runDir, { createdAt: "2026-08-24T12:00:00.000Z", digitalThread: { sha256: "abc" }, status: "drafting" })
    await updateRunManifest(runDir, { runId: "wrong-id", status: "completed", templateId: "orbit-keeping", outputs: { ephemeris: "EphemerisFile1.oem" } })
    const manifest = await loadRunManifest(runDir)
    assert.equal(manifest.runId, "26-08-24_12-00")
    assert.equal(manifest.status, "completed")
    assert.equal(manifest.templateId, "orbit-keeping")
    assert.deepEqual(manifest.digitalThread, { sha256: "abc" })
  } finally {
    await fs.rm(parent, { force: true, recursive: true })
  }
})
