/**
 * Role: Creates and initializes one independent, dated mission run.
 * Exports: createMissionRun and the PlanningRun contract.
 * Dependencies: digital-thread persistence, workflow log and run workspace.
 * Invariant: a visible run always owns satellite.json, conversation.json,
 * run_manifest.json and workflow-status.json before it is returned to a route.
 */
import fs from "node:fs/promises"
import path from "node:path"

import { loadOrCreateDigitalThread } from "../digitalThread/digitalThreadStore.js"
import { initializeRunWorkflowLog } from "../opalis/workflowRunLog.js"
import { missionRunDirectory, missionRunsDirectory } from "./runWorkspace.js"
import { updateRunManifest } from "./runManifest.js"

export type PlanningRun = {
  createdAt: string
  planningRunId: string
  workspaceDir: string
}

function formatMissionRunId(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getFullYear() % 100)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`
}

async function reserveRunDirectory(root: string, date: Date) {
  const baseId = formatMissionRunId(date)
  await fs.mkdir(missionRunsDirectory(root), { recursive: true })
  for (let suffix = 1; suffix < 100; suffix += 1) {
    const runId = suffix === 1 ? baseId : `${baseId}_${String(suffix).padStart(2, "0")}`
    const runDir = missionRunDirectory(root, runId)
    try {
      await fs.mkdir(runDir)
      return { runDir, runId }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    }
  }
  throw new Error(`unable to reserve a unique mission run directory for ${baseId}`)
}

/** Atomically reserves the dated directory, then materializes the complete
 * baseline contract before exposing it to Mission Studio. */
export async function createMissionRun(workspaceRoot: string, now = new Date()): Promise<PlanningRun> {
  const root = path.resolve(workspaceRoot)
  const { runDir, runId } = await reserveRunDirectory(root, now)
  const createdAt = now.toISOString()
  try {
    await loadOrCreateDigitalThread(runDir)
    await Promise.all([
      fs.writeFile(path.join(runDir, "conversation.json"), "[]\n", { encoding: "utf8", flag: "wx" }),
      updateRunManifest(runDir, { createdAt, status: "drafting", templateId: null }),
      initializeRunWorkflowLog(runDir),
    ])
  } catch (error) {
    // This directory was reserved by this call and has never been exposed.
    await fs.rm(runDir, { force: true, recursive: true }).catch(() => undefined)
    throw error
  }
  return { createdAt, planningRunId: runId, workspaceDir: runDir }
}

/** Compatibility name retained only at the API boundary while callers move
 * to the mission-run vocabulary. */
export const createPlanningRun = createMissionRun
