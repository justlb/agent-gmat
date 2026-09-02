import { requestApiJson } from '../../app/apiClient'
import type { GmatMissionTemplateId } from './gmatMissionTemplates'
import type { OrbitKeepingDraft } from './orbitKeepingApi'

export type MissionTemplate = GmatMissionTemplateId

export async function updateMissionValue<TDraft = OrbitKeepingDraft>({ draftId, path, template, value, workspaceDir }: {
  draftId: string
  path: string
  template: MissionTemplate
  value: string
  workspaceDir?: string | null
}) {
  const payload = await requestApiJson<TDraft>(`/gmat/templates/${encodeURIComponent(template)}/drafts/${encodeURIComponent(draftId)}/values`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, value, workspaceDir }),
  })
  if (!payload || typeof payload !== 'object' || typeof (payload as { draftId?: unknown }).draftId !== 'string') throw new Error('Unable to update mission value')
  return payload
}
