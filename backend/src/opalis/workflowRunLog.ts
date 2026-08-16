import fs from "node:fs/promises"
import path from "node:path"

import { updateJsonFile } from "../shared/atomicPersistence.js"

export type WorkflowStage = "opalis" | "rf_comlink" | "simu_cic"
export type WorkflowStageStatus = "completed" | "failed" | "not_started" | "running"

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
        simu_cic: { ...fallback.stages.simu_cic, ...current.stages?.simu_cic },
        opalis: { ...fallback.stages.opalis, ...current.stages?.opalis },
        rf_comlink: { ...fallback.stages.rf_comlink, ...current.stages?.rf_comlink },
      },
    }
    const updatedAt = new Date().toISOString()
    return { ...normalized, updated_at: updatedAt, stages: { ...normalized.stages, [stage]: { message, status, updated_at: updatedAt } } }
  })
}
