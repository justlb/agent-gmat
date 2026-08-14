import { joinApiPath } from '../../app/apiBase'
import type { OrbitKeepingDraft } from './orbitKeepingApi'

export type MissionTemplate = 'orbit-keeping' | 'electric-propulsion-transfer'

export async function updateMissionValue({ draftId, path, template, value, workspaceDir }: {
  draftId?: string
  path: string
  template: MissionTemplate
  value: string
  workspaceDir?: string | null
}) {
  const response = await fetch(joinApiPath(undefined, '/gmat/mission-values'), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draftId, path, template, value, workspaceDir }),
  })
  const payload = await response.json().catch(() => ({})) as { draft?: OrbitKeepingDraft; error?: unknown }
  if (!response.ok || !payload.draft) throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to update mission value')
  return payload.draft
}
