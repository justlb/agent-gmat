import { joinApiPath } from '../../app/apiBase'

export type PlanningRun = {
  createdAt: string
  planningRunId: string
  workspaceDir: string
}

export type DuplicatedPlanningRun = {
  groundStationId: string | null
  planningRun: PlanningRun
  satelliteId: string | null
  sourceRunId: string
  templateId: string | null
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

/** Creates a new editable planning run from a prior run's saved inputs. */
export async function duplicatePlanningRun(sourceRunPath: string) {
  const response = await fetch(joinApiPath(undefined, '/digital-thread/planning-runs/duplicate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceRunPath }),
  })
  const payload = await response.json().catch(() => ({})) as { error?: unknown } & Partial<DuplicatedPlanningRun>
  if (!response.ok || !payload.planningRun) throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to duplicate the mission run')
  return payload as DuplicatedPlanningRun
}
