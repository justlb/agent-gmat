import { joinApiPath } from '../../app/apiBase'
import { getApiErrorMessage, readServerSentEvents } from '../../app/apiClient'
import type { GmatMissionDraftBase } from './gmatMissionTypes'

export type OrbitKeepingChange = {
  id: string
  value: string
}

export type OrbitKeepingGenerateResult = {
  changes: OrbitKeepingChange[]
  latencyMs: number
  manifestPath: string
  result: {
    error?: string
    executionDurationMs?: number
    finalAltitudeKm?: number
    finalFuelMassKg?: number
    fuelUsedBetweenReportsKg?: number
    maximumReportedAltitudeKm?: number
    minimumReportedAltitudeKm?: number
    reportSampleCount: number
    status: 'generated' | 'completed' | 'failed' | 'timeout'
    warnings?: string[]
  }
  resultPath: string
  runId: string
  draftId?: string
  runPath: string
  scriptPath: string
  timeSeriesPath: string
  valuesPath: string
}

export type OrbitKeepingProgressEvent = {
  key: 'load_template' | 'llm_patch' | 'render_script' | 'run_gmat' | 'save_results'
  percent: number
  status: 'running' | 'completed'
}

export type OrbitKeepingDraft = GmatMissionDraftBase<'blocked' | 'collecting' | 'ready' | 'confirmed'> & {
  conversationStartedAt?: string | null
  runs?: Array<{ runId: string; runPath: string; result: OrbitKeepingGenerateResult['result']; completedAt: string; missionValues?: Record<string, string | number | null> }>
  safety: {
    assumptions: Array<{ label: string; value: string }>
    checks: Array<{ code: string; message: string; severity: 'error' | 'warning' }>
  }
}

export type OrbitKeepingFile = {
  artifactId: string
  fileName: string
  historical?: boolean
  kind: 'digital-thread' | 'ephemeris' | 'log' | 'manifest' | 'opalis' | 'report' | 'result' | 'rf-comlink' | 'script' | 'timeseries' | 'values'
  mtimeMs: number
  relativePath: string
  runPath?: string
  size: number
}

export type OrbitKeepingRunConversationTurn = { answer: string; askedAt: string; question: string }

export async function getOrbitKeepingRunConversation(runPath: string, apiBase?: string) {
  const url = `${joinApiPath(apiBase, '/gmat/orbit-keeping/analyze/history')}?${new URLSearchParams({ runPath }).toString()}`
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(await getResponseErrorMessage(response))
  const payload = await response.json() as { conversation?: OrbitKeepingRunConversationTurn[] }
  return Array.isArray(payload.conversation) ? payload.conversation : []
}

/** Executes an already confirmed draft and forwards each real backend stage. */
export async function executeOrbitKeepingDraftWithProgress(draftId: string, {
  onProgress,
  workspaceDir,
}: {
  onProgress: (event: OrbitKeepingProgressEvent) => void
  workspaceDir?: string | null
}) {
  const response = await fetch(joinApiPath(undefined, `/gmat/orbit-keeping/drafts/${encodeURIComponent(draftId)}/execute/events`), {
    method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...(workspaceDir ? { workspaceDir } : {}) }),
  })
  if (!response.ok) throw new Error(await getResponseErrorMessage(response))
  let result: OrbitKeepingGenerateResult | null = null
  let streamError = ''
  await readServerSentEvents(response, ({ event, payload }) => {
    if (event === 'progress') onProgress(payload as OrbitKeepingProgressEvent)
    if (event === 'result') result = payload as OrbitKeepingGenerateResult
    if (event === 'error') streamError = typeof (payload as { error?: unknown }).error === 'string' ? (payload as { error: string }).error : 'GMAT execution failed'
  })
  if (streamError) throw new Error(streamError)
  if (!result) throw new Error('GMAT progress stream ended without a result')
  return result
}

async function getResponseErrorMessage(response: Response) {
  return getApiErrorMessage(response, 'GMAT request failed')
}

/** Calls the deterministic GMAT pipeline directly, without the managed-agent dispatcher. */
export async function generateOrbitKeeping(request: string, {
  apiBase,
  workspaceDir,
}: {
  apiBase?: string
  workspaceDir?: string | null
} = {}) {
  const response = await fetch(joinApiPath(apiBase, '/gmat/orbit-keeping/generate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request, ...(workspaceDir ? { workspaceDir } : {}) }),
  })
  if (!response.ok) throw new Error(await getResponseErrorMessage(response))
  return response.json() as Promise<OrbitKeepingGenerateResult>
}

/** Runs the same deterministic pipeline, while receiving its actual backend stages. */
export async function generateOrbitKeepingWithProgress(request: string, {
  apiBase,
  onProgress,
  workspaceDir,
}: {
  apiBase?: string
  onProgress: (event: OrbitKeepingProgressEvent) => void
  workspaceDir?: string | null
}) {
  const response = await fetch(joinApiPath(apiBase, '/gmat/orbit-keeping/generate/events'), {
    method: 'POST',
    headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' },
    body: JSON.stringify({ request, ...(workspaceDir ? { workspaceDir } : {}) }),
  })
  if (!response.ok) throw new Error(await getResponseErrorMessage(response))
  let result: OrbitKeepingGenerateResult | null = null
  let streamError = ''
  await readServerSentEvents(response, ({ event, payload }) => {
    if (event === 'progress') onProgress(payload as OrbitKeepingProgressEvent)
    if (event === 'result') result = payload as OrbitKeepingGenerateResult
    if (event === 'error') streamError = typeof (payload as { error?: unknown }).error === 'string'
      ? (payload as { error: string }).error
      : 'GMAT generation failed'
  })
  if (streamError) throw new Error(streamError)
  if (!result) throw new Error('GMAT progress stream ended without a result')
  return result
}

export async function analyzeOrbitKeepingRun({
  draftId,
  workspaceDir,
  apiBase,
  question,
  runPath,
}: {
  apiBase?: string
  draftId?: string
  workspaceDir?: string | null
  question: string
  runPath: string
}) {
  const response = await fetch(joinApiPath(apiBase, '/gmat/orbit-keeping/analyze'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, runPath, ...(draftId ? { draftId } : {}), ...(workspaceDir ? { workspaceDir } : {}) }),
  })
  if (!response.ok) throw new Error(await getResponseErrorMessage(response))
  return response.json() as Promise<{ answer: string; latencyMs: number; runId: string }>
}

export async function listOrbitKeepingFiles(apiBase?: string) {
  const response = await fetch(joinApiPath(apiBase, '/gmat/orbit-keeping/files'), { cache: 'no-store' })
  if (!response.ok) throw new Error(await getResponseErrorMessage(response))
  const payload = await response.json() as { files?: OrbitKeepingFile[] }
  return Array.isArray(payload.files) ? payload.files : []
}

export async function openOrbitKeepingRunInGui(runPath: string, apiBase?: string) {
  const response = await fetch(joinApiPath(apiBase, '/gmat/orbit-keeping/open-gui'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await getResponseErrorMessage(response))
}

export function orbitKeepingFileDownloadUrl(file: Pick<OrbitKeepingFile, 'relativePath'>, apiBase?: string) {
  const base = joinApiPath(apiBase, '/gmat/orbit-keeping/files/download')
  return `${base}?${new URLSearchParams({ relativePath: file.relativePath }).toString()}`
}
