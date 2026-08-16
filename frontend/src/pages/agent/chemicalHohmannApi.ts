import { buildApiUrl, requestApiJson } from '../../app/apiClient'
import type { GmatMissionDraftBase } from './gmatMissionTypes'

export type ChemicalHohmannDraft = GmatMissionDraftBase<'collecting' | 'ready' | 'confirmed'> & {
  createdAt: string
  templateId: 'chemical-hohmann-transfer'
  updatedAt: string
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

export type ChemicalHohmannFile = {
  artifactId: string
  fileName: string
  historical?: boolean
  kind: 'digital-thread' | 'ephemeris' | 'log' | 'manifest' | 'result' | 'rf-comlink' | 'script' | 'values'
  mtimeMs: number
  relativePath: string
  runPath: string
  size: number
}

const base = '/gmat/chemical-hohmann-transfer'

export async function createChemicalHohmannDraft(workspaceDir: string) {
  return requestApiJson<ChemicalHohmannDraft>(`${base}/drafts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir }),
  })
}

export async function listChemicalHohmannDrafts(workspaceDir: string) {
  const payload = await requestApiJson<{ drafts?: ChemicalHohmannDraft[] }>(`${base}/drafts`, { cache: 'no-store', query: { workspaceDir } })
  return Array.isArray(payload.drafts) ? payload.drafts : []
}

export async function listChemicalHohmannFiles(workspaceDir: string) {
  const payload = await requestApiJson<{ files?: ChemicalHohmannFile[] }>(`${base}/files`, { cache: 'no-store', query: { workspaceDir } })
  return Array.isArray(payload.files) ? payload.files : []
}

export function chemicalHohmannFileDownloadUrl(file: Pick<ChemicalHohmannFile, 'relativePath'>, workspaceDir: string) {
  return buildApiUrl(`${base}/files/download`, { query: { relativePath: file.relativePath, workspaceDir } })
}

export async function confirmChemicalHohmannDraft(draftId: string, workspaceDir: string) {
  return requestApiJson<ChemicalHohmannDraft>(`${base}/drafts/${encodeURIComponent(draftId)}/confirm`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir }),
  })
}

export async function discussChemicalHohmannDraft(draftId: string, message: string, workspaceDir: string) {
  return requestApiJson<ChemicalHohmannDraft>(`${base}/drafts/${encodeURIComponent(draftId)}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, workspaceDir }),
  })
}

export async function executeChemicalHohmannDraft(draftId: string, workspaceDir: string) {
  return requestApiJson<ChemicalHohmannExecution>(`${base}/drafts/${encodeURIComponent(draftId)}/execute`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir }),
  })
}
