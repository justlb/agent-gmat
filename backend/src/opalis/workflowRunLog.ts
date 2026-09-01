import fs from "node:fs/promises"
import crypto from "node:crypto"
import path from "node:path"

import { updateJsonFile } from "../shared/atomicPersistence.js"

/** A run status always includes GMAT and its downstream tools. */
export type WorkflowStage = "gmat" | "opalis" | "rf_comlink" | "simu_cic"
export type WorkflowStageStatus = "completed" | "failed" | "not_started" | "running"

export type WorkflowRunLog = {
  updated_at: string
  version: 3
  stages: Record<WorkflowStage, { artifact_paths: string[]; input_revision: number | null; input_sha256: string | null; message: string | null; status: WorkflowStageStatus; updated_at: string | null }>
}

const fileName = "workflow-status.json"

function emptyLog(): WorkflowRunLog {
  return {
    updated_at: new Date().toISOString(),
    version: 3,
    stages: {
      gmat: { artifact_paths: [], input_revision: null, input_sha256: null, message: null, status: "not_started", updated_at: null },
      simu_cic: { artifact_paths: [], input_revision: null, input_sha256: null, message: null, status: "not_started", updated_at: null },
      opalis: { artifact_paths: [], input_revision: null, input_sha256: null, message: null, status: "not_started", updated_at: null },
      rf_comlink: { artifact_paths: [], input_revision: null, input_sha256: null, message: null, status: "not_started", updated_at: null },
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
  const satelliteSource = await fs.readFile(path.join(runDir, "satellite.json"), "utf8").catch(() => null)
  const input_sha256 = satelliteSource ? crypto.createHash("sha256").update(satelliteSource).digest("hex") : null
  let input_revision: number | null = null
  if (satelliteSource) {
    try {
      const parsed = JSON.parse(satelliteSource) as { digital_thread?: { revision?: unknown } }
      input_revision = typeof parsed.digital_thread?.revision === "number" ? parsed.digital_thread.revision : null
    } catch { /* A malformed run input is represented by a missing revision. */ }
  }
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
    const existing = normalized.stages[stage]
    return {
      ...normalized,
      version: 3,
      updated_at: updatedAt,
      stages: {
        ...normalized.stages,
        [stage]: { ...existing, input_revision, input_sha256, message, status, updated_at: updatedAt },
      },
    }
  })
}

/** Materializes the initial lifecycle file when a dated run is created. */
export function initializeRunWorkflowLog(runDir: string) {
  return updateJsonFile<WorkflowRunLog>(path.join(runDir, fileName), emptyLog(), current => current)
}
