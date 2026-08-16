import { joinApiPath } from '../../app/apiBase'

export type ChemicalHohmannDraft = {
  confirmed: boolean
  conversation: Array<{ assistant: string; user: string }>
  createdAt: string
  draftId: string
  missing: string[]
  status: 'collecting' | 'ready' | 'confirmed'
  templateId: 'chemical-hohmann-transfer'
  updatedAt: string
  values: Record<string, string | number | null>
}

export type ChemicalHohmannExecution = {
  manifestPath: string
  result: { error?: string; executionDurationMs?: number; status: 'generated' | 'completed' | 'failed' | 'timeout' }
  resultPath: string
  runId: string
  runPath: string
  scriptPath: string
  valuesPath: string
}

async function responseError(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown }
  if (typeof payload.error === 'string') return payload.error
  if (typeof payload.message === 'string') return payload.message
  return `Chemical Hohmann request failed: ${response.status}`
}

const base = '/gmat/chemical-hohmann-transfer'

export async function createChemicalHohmannDraft(workspaceDir: string) {
  const response = await fetch(joinApiPath(undefined, `${base}/drafts`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<ChemicalHohmannDraft>
}

export async function confirmChemicalHohmannDraft(draftId: string, workspaceDir: string) {
  const response = await fetch(joinApiPath(undefined, `${base}/drafts/${encodeURIComponent(draftId)}/confirm`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<ChemicalHohmannDraft>
}

export async function discussChemicalHohmannDraft(draftId: string, message: string, workspaceDir: string) {
  const response = await fetch(joinApiPath(undefined, `${base}/drafts/${encodeURIComponent(draftId)}/messages`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, workspaceDir }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<ChemicalHohmannDraft>
}

export async function executeChemicalHohmannDraft(draftId: string, workspaceDir: string) {
  const response = await fetch(joinApiPath(undefined, `${base}/drafts/${encodeURIComponent(draftId)}/execute`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<ChemicalHohmannExecution>
}
