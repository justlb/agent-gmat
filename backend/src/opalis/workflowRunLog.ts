import fs from "node:fs/promises"
import path from "node:path"

export type WorkflowStage = "opalis" | "simu_cic"
export type WorkflowStageStatus = "completed" | "failed" | "not_started" | "running"

export type WorkflowRunLog = {
  updated_at: string
  version: 1
  stages: Record<WorkflowStage, { message: string | null; status: WorkflowStageStatus; updated_at: string | null }>
}

const fileName = "workflow-status.json"

function emptyLog(): WorkflowRunLog {
  return {
    updated_at: new Date().toISOString(),
    version: 1,
    stages: {
      simu_cic: { message: null, status: "not_started", updated_at: null },
      opalis: { message: null, status: "not_started", updated_at: null },
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
    },
  }
}

export async function updateRunWorkflowLog(runDir: string, stage: WorkflowStage, status: WorkflowStageStatus, message: string | null) {
  const current = await loadRunWorkflowLog(runDir)
  const updatedAt = new Date().toISOString()
  const next: WorkflowRunLog = {
    ...current,
    updated_at: updatedAt,
    stages: { ...current.stages, [stage]: { message, status, updated_at: updatedAt } },
  }
  await fs.writeFile(path.join(runDir, fileName), `${JSON.stringify(next, null, 2)}\n`, "utf8")
  return next
}
