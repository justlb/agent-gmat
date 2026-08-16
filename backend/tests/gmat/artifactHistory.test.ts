import assert from "node:assert/strict"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { test } from "node:test"

import { snapshotRunArtifacts } from "../../src/gmat/artifactHistory.js"

test("snapshots mutable sub-tool artifacts without replacing their source", async () => {
  const runDir = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-artifact-history-"))
  const source = path.join(runDir, "rf-comlink", "03-results", "calculated-rf-comlink.rfcl")
  await fs.mkdir(path.dirname(source), { recursive: true })
  await fs.writeFile(source, "first saved result\n")

  const history = await snapshotRunArtifacts(runDir, "rf-comlink", ["rf-comlink/03-results/calculated-rf-comlink.rfcl"])
  assert.ok(history)
  assert.equal(await fs.readFile(source, "utf8"), "first saved result\n")
  assert.equal(await fs.readFile(path.join(history!, "rf-comlink", "03-results", "calculated-rf-comlink.rfcl"), "utf8"), "first saved result\n")
  const manifest = JSON.parse(await fs.readFile(path.join(history!, "manifest.json"), "utf8")) as { artifacts: Array<{ source: string }> }
  assert.deepEqual(manifest.artifacts, [{ bytes: 19, source: "rf-comlink/03-results/calculated-rf-comlink.rfcl", stored_as: "rf-comlink/03-results/calculated-rf-comlink.rfcl" }])
})
