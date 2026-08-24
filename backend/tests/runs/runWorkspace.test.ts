import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"

import { artifactDefinitionForPath, artifactsForTool } from "../../src/runs/artifactRegistry.js"
import { relativeToWorkspaceRoot, resolveMissionRun, resolveMissionRunArtifact } from "../../src/runs/runWorkspace.js"

describe("mission run workspace", () => {
  const root = path.resolve("/tmp/codex-users/alice")
  const run = path.join(root, "gmat", "mission-runs", "26-08-24_12-00")

  it("resolves only a dated run inside the current workspace", () => {
    assert.deepEqual(resolveMissionRun(root, "gmat/mission-runs/26-08-24_12-00"), {
      root,
      runDir: run,
      runId: "26-08-24_12-00",
      runPath: "gmat/mission-runs/26-08-24_12-00",
    })
    assert.equal(resolveMissionRun(root, "../other-user/gmat/mission-runs/26-08-24_12-00"), null)
    assert.equal(resolveMissionRun(root, "missions/mission-runs/26-08-24_12-00"), null)
    assert.equal(resolveMissionRun(root, "gmat/mission-runs/not-dated"), null)
    assert.equal(resolveMissionRun(root, "planning"), null)
  })

  it("exposes stable relative paths and the complete shared tool inventory", () => {
    assert.equal(relativeToWorkspaceRoot(root, path.join(run, "rf-comlink", "03-results", "rf-comlink-results.json")), "gmat/mission-runs/26-08-24_12-00/rf-comlink/03-results/rf-comlink-results.json")
    assert.equal(artifactDefinitionForPath("rf-comlink/03-results/rf-comlink-results.json")?.category, "result")
    assert.equal(artifactsForTool("rf-comlink").length, 5)
    assert.equal(artifactDefinitionForPath("opalis/02-simu-cic/01-execution-complete/run.scd")?.tool, "simu-cic")
    assert.equal(artifactDefinitionForPath("opalis/03-opalis/02-resultats/calculated-opalis.opalis")?.tool, "opalis")
    assert.equal(resolveMissionRunArtifact(root, "gmat/mission-runs/26-08-24_12-00/orbit_keeping.script"), path.join(run, "orbit_keeping.script"))
    assert.equal(resolveMissionRunArtifact(root, "gmat/mission-runs/26-08-24_12-00/private.secret"), null)
    assert.equal(resolveMissionRunArtifact(root, "../bob/gmat/mission-runs/26-08-24_12-00/satellite.json"), null)
  })
})
