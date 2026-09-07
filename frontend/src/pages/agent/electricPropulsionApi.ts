import { joinApiPath } from '../../app/apiBase'
import { getApiErrorMessage, readServerSentEvents } from '../../app/apiClient'
import type { OrbitKeepingDraft, OrbitKeepingGenerateResult, OrbitKeepingProgressEvent } from './orbitKeepingApi'

export type ElectricPropulsionDraft = OrbitKeepingDraft
export type ElectricPropulsionGenerateResult = OrbitKeepingGenerateResult
export type ElectricPropulsionProgressEvent = OrbitKeepingProgressEvent
export type ElectricPropulsionFile = {
  artifactId: string
  fileName: string
  historical?: boolean
  kind: 'calibration' | 'digital-thread' | 'ephemeris' | 'log' | 'manifest' | 'opalis' | 'report' | 'result' | 'rf-comlink' | 'script' | 'timeseries' | 'values'
  mtimeMs: number
  relativePath: string
  runPath?: string
  size: number
}

const base = '/gmat/electric-propulsion-transfer'

async function errorMessage(response: Response) {
  return getApiErrorMessage(response, 'GMAT request failed')
}

export async function listElectricPropulsionFiles() {
  const response = await fetch(joinApiPath(undefined, `${base}/files`), { cache: 'no-store' })
  if (!response.ok) throw new Error(await errorMessage(response))
  const payload = await response.json() as { files?: ElectricPropulsionFile[] }
  return Array.isArray(payload.files) ? payload.files : []
}

export function electricPropulsionFileDownloadUrl(file: Pick<ElectricPropulsionFile, 'relativePath'>) {
  return `${joinApiPath(undefined, `${base}/files/download`)}?${new URLSearchParams({ relativePath: file.relativePath }).toString()}`
}

export async function openElectricPropulsionRunInGui(runPath: string) {
  const response = await fetch(joinApiPath(undefined, `${base}/open-gui`), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await errorMessage(response))
}

export async function executeElectricPropulsionDraftWithProgress(draftId: string, { onProgress, workspaceDir }: { onProgress: (event: ElectricPropulsionProgressEvent) => void; workspaceDir?: string | null }) {
  const response = await fetch(joinApiPath(undefined, `${base}/drafts/${encodeURIComponent(draftId)}/execute/events`), { method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(workspaceDir ? { workspaceDir } : {}) }) })
  if (!response.ok) throw new Error(await errorMessage(response))
  let result: ElectricPropulsionGenerateResult | null = null
  let streamError = ''
  await readServerSentEvents(response, ({ event, payload }) => {
    if (event === 'progress') onProgress(payload as ElectricPropulsionProgressEvent)
    if (event === 'result') result = payload as ElectricPropulsionGenerateResult
    if (event === 'error') streamError = typeof (payload as { error?: unknown }).error === 'string' ? (payload as { error: string }).error : 'GMAT execution failed'
  })
  if (streamError) throw new Error(streamError)
  if (!result) throw new Error('GMAT progress stream ended without a result')
  return result
}

export async function analyzeElectricPropulsionRun({ draftId, question, runPath, workspaceDir }: { draftId?: string; question: string; runPath: string; workspaceDir?: string | null }) {
  const response = await fetch(joinApiPath(undefined, `${base}/analyze`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, runPath, ...(draftId ? { draftId } : {}), ...(workspaceDir ? { workspaceDir } : {}) }) })
  if (!response.ok) throw new Error(await errorMessage(response))
  return response.json() as Promise<{ answer: string; latencyMs: number; runId: string }>
}

export async function getElectricPropulsionRunConversation(runPath: string) {
  const url = `${joinApiPath(undefined, `${base}/analyze/history`)}?${new URLSearchParams({ runPath }).toString()}`
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(await errorMessage(response))
  const payload = await response.json() as { conversation?: Array<{ answer: string; askedAt: string; question: string }> }
  return Array.isArray(payload.conversation) ? payload.conversation : []
}
