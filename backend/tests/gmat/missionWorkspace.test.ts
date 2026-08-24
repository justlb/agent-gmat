import assert from "node:assert/strict"
import path from "node:path"
import { describe, it } from "node:test"

import { resolveMissionWorkspace } from "../../src/gmat/missionWorkspace.js"

describe("resolveMissionWorkspace", () => {
  const root = path.resolve("/tmp/codex-users/alice")

  it("uses the user root when a legacy mission omits workspaceDir", () => {
    assert.equal(resolveMissionWorkspace(root, undefined), root)
  })

  it("accepts a nested workspace and rejects an escape outside the user root", () => {
    const runWorkspace = path.join(root, "gmat", "mission-runs", "26-08-16_12-26")
    assert.equal(resolveMissionWorkspace(root, runWorkspace), runWorkspace)
    assert.throws(() => resolveMissionWorkspace(root, "/tmp/other-user"), /inside the current user workspace/)
  })

  it("resolves API-relative mission paths against the user root when requested", () => {
    assert.equal(
      resolveMissionWorkspace(root, "gmat/mission-runs/26-08-16_12-26", { resolveRelativeToRoot: true }),
      path.join(root, "gmat", "mission-runs", "26-08-16_12-26"),
    )
  })

  it("requires a dated mission workspace when requested", () => {
    const runWorkspace = path.join(root, "gmat", "mission-runs", "26-08-16_12-26")
    assert.equal(resolveMissionWorkspace(root, runWorkspace, { requireExplicitWorkspace: true, requireMissionRun: true }), runWorkspace)
    assert.throws(() => resolveMissionWorkspace(root, undefined, { requireExplicitWorkspace: true }), /workspaceDir is required/)
    assert.throws(() => resolveMissionWorkspace(root, path.join(root, "planning"), { requireMissionRun: true }), /select a dated mission run workspace first/)
  })
})
