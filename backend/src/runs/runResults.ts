import fs from "node:fs/promises"
import path from "node:path"
import { loadRunWorkflowLog, type WorkflowRunLog } from "../opalis/workflowRunLog.js"
import { resolveMissionWorkspace } from "../gmat/missionWorkspace.js"
import { isGmatTemplateId, gmatTemplateDefinition } from "../gmat/templateRegistry.js"
import { MISSION_RUN_ID_PATTERN, resolveMissionRun } from "./runWorkspace.js"

const stages = ["gmat", "simu_cic", "opalis", "rf_comlink"] as const

/** GMAT success alone is not evidence that the complete mission pipeline succeeded. */
export function resultRunStatus(manifestStatus: unknown, workflow: WorkflowRunLog) {
  const statuses = stages.map(stage => workflow.stages[stage].status)
  if (statuses.includes("failed") || manifestStatus === "failed" || manifestStatus === "timeout") return "failed"
  if (statuses.every(status => status === "completed")) return "completed"
  if (statuses.includes("running") || manifestStatus === "running") return "running"
  if (statuses.includes("completed") || manifestStatus === "completed" || manifestStatus === "generated") return "partial"
  return "not_started"
}

/** Lists dated runs, including failed runs without any time-series artifact. */
export async function listResultRuns(root: string, workspaceCandidate?: unknown) {
  const workspace = resolveMissionWorkspace(root, workspaceCandidate, { resolveRelativeToRoot: true })
  const selectedRun = resolveMissionRun(root, workspace)
  const base = selectedRun ? path.resolve(selectedRun.runDir, "../../..") : workspace
  const collections = [...new Set([path.resolve(root), base])].flatMap(directory =>
    ["mission-runs", "orbit-keeping", "electric-propulsion-transfer"].map(collection => path.join(directory, "gmat", collection)))
  const runs = []
  for (const collection of collections) {
    const entries = await fs.readdir(collection, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    for (const entry of entries) {
      if (!entry.isDirectory() || !MISSION_RUN_ID_PATTERN.test(entry.name)) continue
      const run = resolveMissionRun(root, path.join(collection, entry.name))
      if (!run) continue
      try {
        const [source, workflow, stat] = await Promise.all([
          fs.readFile(path.join(run.runDir, "run_manifest.json"), "utf8"),
          loadRunWorkflowLog(run.runDir), fs.stat(run.runDir),
        ])
        const manifest = JSON.parse(source) as Record<string, unknown>
        const templateId = typeof manifest.templateId === "string" ? manifest.templateId : null
        runs.push({
          runId: run.runId, runPath: run.runPath, templateId,
          name: templateId && isGmatTemplateId(templateId) ? gmatTemplateDefinition(templateId).name : templateId ?? "Mission draft",
          createdAt: typeof manifest.createdAt === "string" && Number.isFinite(Date.parse(manifest.createdAt)) ? manifest.createdAt : stat.birthtime.toISOString(),
          status: resultRunStatus(manifest.status, workflow), workflow,
        })
      } catch {
        runs.push({ runId: run.runId, runPath: run.runPath, templateId: null, name: "Unreadable run", createdAt: null, status: "unknown" as const, workflow: null })
      }
    }
  }
  // Keep unreadable directories visible, but do not auto-select one ahead of a dated run.
  return runs.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.runId.localeCompare(a.runId))
}

export async function loadResultConversation(runDir: string) {
  const source = await fs.readFile(path.join(runDir, "conversation.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "[]"
    throw error
  })
  const parsed: unknown = JSON.parse(source)
  if (!Array.isArray(parsed)) throw new Error("invalid run conversation")
  return parsed.filter((turn): turn is { question: string; answer: string; askedAt?: string } => Boolean(turn && typeof turn.question === "string" && typeof turn.answer === "string"))
}

export async function loadResultSamples(runDir: string) {
  for (const file of ["orbit_timeseries.json", "electric_transfer_timeseries.json"]) {
    const source = await fs.readFile(path.join(runDir, file), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null
      throw error
    })
    if (source === null) continue
    const samples: unknown = JSON.parse(source)
    if (!Array.isArray(samples)) throw new Error("invalid GMAT time series")
    return { samples, source: file }
  }
  return { samples: [], source: null }
}
