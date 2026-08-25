import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import test from "node:test"

const execFileAsync = promisify(execFile)
const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..")

test("mission scenario kit previews a safe, complete scenario contract", async () => {
  const { stdout } = await execFileAsync(process.execPath, ["scripts/createMissionScenario.mjs", "--id", "demo-safe-scenario", "--name", "Demo safe scenario", "--dry-run"], { cwd: backendRoot })
  const preview = JSON.parse(stdout) as { action: string; files: string[]; id: string }
  assert.equal(preview.action, "create-mission-scenario")
  assert.equal(preview.id, "demo-safe-scenario")
  assert.ok(preview.files.includes("workflow_agents/gmat_skills/demo-safe-scenario-scenario/scenario.json"))
  assert.ok(preview.files.includes("workflow_agents/gmat_skills/demo-safe-scenario-scenario/references/demo-safe-scenario.script"))
})
