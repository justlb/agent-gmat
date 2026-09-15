import fs from "node:fs/promises"
import path from "node:path"

import { updateJsonFile } from "../shared/atomicPersistence.js"

/** A run status always includes GMAT and its downstream tools. */
export type WorkflowStage = "gmat" | "opalis" | "rf_comlink" | "simu_cic"
/** `not_visible` is a valid engineering outcome: Simu-CIC completed, but the
 * selected ground station has no line-of-sight sample in the studied window.
 * It must not be presented as an RF-COMLINK software failure. */
export type WorkflowStageStatus = "completed" | "failed" | "not_started" | "not_visible" | "running"

export type WorkflowRunLog = {
  updated_at: string
  version: 2
  stages: Record<WorkflowStage, { message: string | null; status: WorkflowStageStatus; updated_at: string | null }>
}

const fileName = "workflow-status.json"

function emptyLog(): WorkflowRunLog {
  return {
    updated_at: new Date().toISOString(),
    version: 2,
    stages: {
      gmat: { message: null, status: "not_started", updated_at: null },
      simu_cic: { message: null, status: "not_started", updated_at: null },
      opalis: { message: null, status: "not_started", updated_at: null },
      rf_comlink: { message: null, status: "not_started", updated_at: null },
    },
  }
}

export async function loadRunWorkflowLog(runDir: string): Promise<WorkflowRunLog> {
  const output = path.join(runDir, fileName)
  const parsed = JSON.parse(await fs.readFile(output, "utf8").catch(() => "null")) as Partial<WorkflowRunLog> | null
  const fallback = emptyLog()
  return {
    ...fallback,
    ...parsed,
    stages: {
      gmat: { ...fallback.stages.gmat, ...parsed?.stages?.gmat },
      simu_cic: { ...fallback.stages.simu_cic, ...parsed?.stages?.simu_cic },
      opalis: { ...fallback.stages.opalis, ...parsed?.stages?.opalis },
      rf_comlink: { ...fallback.stages.rf_comlink, ...parsed?.stages?.rf_comlink },
    },
  }
}

export async function updateRunWorkflowLog(runDir: string, stage: WorkflowStage, status: WorkflowStageStatus, message: string | null) {
  const output = path.join(runDir, fileName)
  return updateJsonFile<WorkflowRunLog>(output, emptyLog(), current => {
    const fallback = emptyLog()
    const normalized: WorkflowRunLog = {
      ...fallback, ...current,
      stages: {
        gmat: { ...fallback.stages.gmat, ...current.stages?.gmat },
        simu_cic: { ...fallback.stages.simu_cic, ...current.stages?.simu_cic },
        opalis: { ...fallback.stages.opalis, ...current.stages?.opalis },
        rf_comlink: { ...fallback.stages.rf_comlink, ...current.stages?.rf_comlink },
      },
    }
    const updatedAt = new Date().toISOString()
    return { ...normalized, updated_at: updatedAt, stages: { ...normalized.stages, [stage]: { message, status, updated_at: updatedAt } } }
  })
}

/** Materializes the initial lifecycle file when a dated run is created. */
export function initializeRunWorkflowLog(runDir: string) {
  return updateJsonFile<WorkflowRunLog>(path.join(runDir, fileName), emptyLog(), current => current)
}
