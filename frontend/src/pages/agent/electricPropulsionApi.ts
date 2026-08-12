import { joinApiPath } from '../../app/apiBase'
import type { OrbitKeepingDraft, OrbitKeepingGenerateResult, OrbitKeepingProgressEvent } from './orbitKeepingApi'

export type ElectricPropulsionDraft = OrbitKeepingDraft
export type ElectricPropulsionGenerateResult = OrbitKeepingGenerateResult
export type ElectricPropulsionProgressEvent = OrbitKeepingProgressEvent
export type ElectricPropulsionTimeSeriesSample = {
  argPeriapsisDeg: number
  eccentricity: number
  elapsedDays: number
  fuelMassKg: number
  inclinationDeg: number
  massFlowRateKgPerSec?: number
  powerAvailableKw: number
  raanDeg: number
  semiMajorAxisKm: number
  totalMassKg: number
  trueAnomalyDeg: number
}
export type ElectricPropulsionFile = {
  artifactId: string
  fileName: string
  kind: 'calibration' | 'digital-thread' | 'ephemeris' | 'log' | 'manifest' | 'report' | 'result' | 'script' | 'timeseries' | 'values'
  mtimeMs: number
  relativePath: string
  size: number
}

const base = '/gmat/electric-propulsion-transfer'

async function errorMessage(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown }
  return typeof payload.error === 'string' ? payload.error : typeof payload.message === 'string' ? payload.message : `GMAT request failed: ${response.status}`
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

export async function createElectricPropulsionDraft(workspaceDir?: string | null) {
  const response = await fetch(joinApiPath(undefined, `${base}/drafts`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(workspaceDir ? { workspaceDir } : {}) }) })
  if (!response.ok) throw new Error(await errorMessage(response))
  return response.json() as Promise<ElectricPropulsionDraft>
}
export async function listElectricPropulsionDrafts(workspaceDir?: string | null) {
  const url = `${joinApiPath(undefined, `${base}/drafts`)}?${new URLSearchParams(workspaceDir ? { workspaceDir } : {}).toString()}`
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(await errorMessage(response))
  const payload = await response.json() as { drafts?: ElectricPropulsionDraft[] }
  return Array.isArray(payload.drafts) ? payload.drafts : []
}
export async function discussElectricPropulsionDraft(draftId: string, message: string, workspaceDir?: string | null) {
  const response = await fetch(joinApiPath(undefined, `${base}/drafts/${encodeURIComponent(draftId)}/messages`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, ...(workspaceDir ? { workspaceDir } : {}) }) })
  if (!response.ok) throw new Error(await errorMessage(response))
  return response.json() as Promise<ElectricPropulsionDraft>
}
export async function confirmElectricPropulsionDraft(draftId: string, workspaceDir?: string | null) {
  const response = await fetch(joinApiPath(undefined, `${base}/drafts/${encodeURIComponent(draftId)}/confirm`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(workspaceDir ? { workspaceDir } : {}) }) })
  if (!response.ok) throw new Error(await errorMessage(response))
  return response.json() as Promise<ElectricPropulsionDraft>
}
export async function executeElectricPropulsionDraftWithProgress(draftId: string, { onProgress, workspaceDir }: { onProgress: (event: ElectricPropulsionProgressEvent) => void; workspaceDir?: string | null }) {
  const response = await fetch(joinApiPath(undefined, `${base}/drafts/${encodeURIComponent(draftId)}/execute/events`), { method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(workspaceDir ? { workspaceDir } : {}) }) })
  if (!response.ok) throw new Error(await errorMessage(response))
  if (!response.body) throw new Error('GMAT progress stream is unavailable')
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let result: ElectricPropulsionGenerateResult | null = null; let streamError = ''
  for (;;) {
    const chunk = await reader.read(); if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const frames = buffer.split(/\n\n/u); buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const event = /^event: ([^\n]+)$/mu.exec(frame)?.[1]; const source = /^data: (.+)$/mu.exec(frame)?.[1]
      if (!event || !source) continue
      const payload = JSON.parse(source) as ElectricPropulsionProgressEvent | ElectricPropulsionGenerateResult | { error?: unknown }
      if (event === 'progress') onProgress(payload as ElectricPropulsionProgressEvent)
      if (event === 'result') result = payload as ElectricPropulsionGenerateResult
      if (event === 'error') streamError = typeof (payload as { error?: unknown }).error === 'string' ? (payload as { error: string }).error : 'GMAT execution failed'
    }
  }
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

export async function getElectricPropulsionTimeSeries(runPath: string) {
  const url = `${joinApiPath(undefined, `${base}/timeseries`)}?${new URLSearchParams({ runPath }).toString()}`
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(await errorMessage(response))
  const payload = await response.json() as { samples?: ElectricPropulsionTimeSeriesSample[] }
  return Array.isArray(payload.samples) ? payload.samples : []
}
