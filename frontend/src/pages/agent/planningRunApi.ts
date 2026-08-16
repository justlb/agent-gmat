import { joinApiPath } from '../../app/apiBase'

export type PlanningRun = {
  createdAt: string
  planningRunId: string
  workspaceDir: string
}

export async function createPlanningRun(workspaceDir?: string | null) {
  const response = await fetch(joinApiPath(undefined, '/digital-thread/planning-runs'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(workspaceDir ? { workspaceDir } : {}),
  })
  const payload = await response.json().catch(() => ({})) as { error?: unknown; planningRun?: PlanningRun }
  if (!response.ok || !payload.planningRun) throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to start a planning run')
  return payload.planningRun
}
