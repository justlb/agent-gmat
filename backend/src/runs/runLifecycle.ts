/**
 * Role: Owns valid lifecycle transitions for one immutable mission run.
 * Exports: begin, complete, fail and invalidate operations for GMAT and all
 * downstream tools.
 * Dependencies: workflowRunLog persistence.
 * Invariant: an upstream change invalidates every dependent stage, so a saved
 * workflow status can never claim that OPALIS/RF used stale GMAT or CIC data.
 */
import { updateRunWorkflowLog, type WorkflowStage } from "../opalis/workflowRunLog.js"

const STAGE_ORDER: WorkflowStage[] = ["gmat", "simu_cic", "opalis", "rf_comlink"]

function downstreamStages(stage: WorkflowStage) {
  return STAGE_ORDER.slice(STAGE_ORDER.indexOf(stage) + 1)
}

/** Marks a long-running tool as active. Call only after route validation. */
export function beginRunStage(runDir: string, stage: WorkflowStage, message: string) {
  return updateRunWorkflowLog(runDir, stage, "running", message)
}

/** Records a completed tool result without changing unrelated stages. */
export function completeRunStage(runDir: string, stage: WorkflowStage, message: string | null) {
  return updateRunWorkflowLog(runDir, stage, "completed", message)
}

/** Records a failed tool result without erasing the evidence it generated. */
export function failRunStage(runDir: string, stage: WorkflowStage, message: string) {
  return updateRunWorkflowLog(runDir, stage, "failed", message)
}

/** Keeps a stage available for execution while recording why it has not run. */
export function deferRunStage(runDir: string, stage: WorkflowStage, message: string) {
  return updateRunWorkflowLog(runDir, stage, "not_started", message)
}

/** Invalidates a stage and all of its downstream consumers after an input or
 * upstream execution changes. Stages are written serially to preserve every
 * transition when several API requests overlap. */
export async function invalidateRunFrom(runDir: string, stage: WorkflowStage, message: string) {
  for (const affected of [stage, ...downstreamStages(stage)]) {
    const isOrigin = affected === stage
    const suffix = isOrigin ? message : `Invalidated because ${stage.replace(/_/gu, " ")} changed. ${message}`
    await updateRunWorkflowLog(runDir, affected, "not_started", suffix)
  }
}

/** A new GMAT result supersedes all downstream computations in that run. */
export function invalidateDownstreamFromGmat(runDir: string, message = "GMAT changed. Run Simu-CIC again before downstream analyses.") {
  return invalidateRunFrom(runDir, "simu_cic", message)
}

/** A changed attitude/CIC configuration makes CIC, OPALIS and RF results stale
 * while preserving the completed GMAT result. */
export function invalidateDownstreamFromSimuCic(runDir: string, message = "Simu-CIC configuration changed; rerun Simu-CIC before downstream analyses.") {
  return invalidateRunFrom(runDir, "simu_cic", message)
}
