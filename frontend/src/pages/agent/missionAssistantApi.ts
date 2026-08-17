import { joinApiPath } from '../../app/apiBase'
import type { OrbitKeepingDraft } from './orbitKeepingApi'

export type MissionAssistantResult =
  | { answer: string; intent: 'analysis' | 'knowledge' | 'advice' | 'simu-cic'; kind: 'analysis' | 'answer' }
  | { draft: OrbitKeepingDraft; intent: 'change'; kind: 'draft' }

export async function askMissionAssistant({ allowMissionChanges = false, draftId, message, runPath, workspaceDir }: { allowMissionChanges?: boolean; draftId?: string; message: string; runPath?: string; workspaceDir?: string | null }) {
  const response = await fetch(joinApiPath(undefined, '/gmat/assistant'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ allowMissionChanges, draftId, message, runPath, workspaceDir }),
  })
  const payload = await response.json() as MissionAssistantResult & { error?: unknown }
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Mission assistant request failed')
  return payload as MissionAssistantResult
}
