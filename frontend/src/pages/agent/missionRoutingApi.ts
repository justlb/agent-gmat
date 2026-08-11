import { joinApiPath } from '../../app/apiBase'
import type { OrbitKeepingDraft } from './orbitKeepingApi'

export type GmatMissionTemplate = 'gmat-orbit-keeping' | 'gmat-electric-propulsion'

export type MissionRouteResult =
  | { kind: 'general' | 'clarify'; message: string }
  | { kind: 'simu-cic'; message: string }
  | { draft: OrbitKeepingDraft; kind: 'mission'; message: string; template: 'orbit-keeping' | 'electric-propulsion-transfer' }

export async function routeMissionMessage(message: string, workspaceDir?: string | null, runPath?: string | null): Promise<MissionRouteResult> {
  const response = await fetch(joinApiPath(undefined, '/gmat/route'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, workspaceDir, runPath }),
  })
  const payload = await response.json() as MissionRouteResult & { error?: unknown }
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to route the mission request')
  return payload as MissionRouteResult
}
