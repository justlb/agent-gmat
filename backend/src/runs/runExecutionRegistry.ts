/**
 * Role: Prevents the same external calculation from being started twice for
 * one immutable mission run.
 * Exports: runStageExclusively and activeRunStages.
 * Dependencies: none.
 */
import path from "node:path"

import type { WorkflowStage } from "../opalis/workflowRunLog.js"

const activeStages = new Set<string>()

function key(runDir: string, stage: WorkflowStage) { return `${path.resolve(runDir)}::${stage}` }

/** Runs one long-running stage once. A second concurrent request gets a
 * deterministic error instead of corrupting the same run directory. */
export async function runStageExclusively<T>(runDir: string, stage: WorkflowStage, operation: () => Promise<T>) {
  const executionKey = key(runDir, stage)
  if (activeStages.has(executionKey)) throw new Error(`${stage.replace(/_/gu, " ")} is already running for this mission run`)
  activeStages.add(executionKey)
  try { return await operation() }
  finally { activeStages.delete(executionKey) }
}

export function activeRunStages(runDir: string) {
  const prefix = `${path.resolve(runDir)}::`
  return [...activeStages].filter(item => item.startsWith(prefix)).map(item => item.slice(prefix.length))
}
