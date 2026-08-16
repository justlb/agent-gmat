import { requestApiJson } from '../../app/apiClient'
import type { GmatMissionTemplateId } from './gmatMissionTemplates'
import type { OrbitKeepingDraft } from './orbitKeepingApi'

export type MissionTemplate = GmatMissionTemplateId

export async function updateMissionValue<TDraft = OrbitKeepingDraft>({ draftId, path, template, value, workspaceDir }: {
  draftId?: string
  path: string
  template: MissionTemplate
  value: string
  workspaceDir?: string | null
}) {
  const payload = await requestApiJson<{ draft?: TDraft }>('/gmat/mission-values', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ draftId, path, template, value, workspaceDir }),
  })
  if (!payload.draft) throw new Error('Unable to update mission value')
  return payload.draft
}
