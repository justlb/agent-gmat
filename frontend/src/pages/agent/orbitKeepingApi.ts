import { joinApiPath } from '../../app/apiBase'

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
  }
  resultPath: string
  runId: string
  runPath: string
  scriptPath: string
  valuesPath: string
}

export type OrbitKeepingFile = {
  artifactId: string
  fileName: string
  kind: 'log' | 'manifest' | 'report' | 'result' | 'script' | 'values'
  mtimeMs: number
  relativePath: string
  size: number
}

async function getResponseErrorMessage(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown }
  if (typeof payload.error === 'string') return payload.error
  if (typeof payload.message === 'string') return payload.message
  return `GMAT request failed: ${response.status}`
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

export async function analyzeOrbitKeepingRun({
  apiBase,
  question,
  runPath,
}: {
  apiBase?: string
  question: string
  runPath: string
}) {
  const response = await fetch(joinApiPath(apiBase, '/gmat/orbit-keeping/analyze'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, runPath }),
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

export function orbitKeepingFileDownloadUrl(file: Pick<OrbitKeepingFile, 'relativePath'>, apiBase?: string) {
  const base = joinApiPath(apiBase, '/gmat/orbit-keeping/files/download')
  return `${base}?${new URLSearchParams({ relativePath: file.relativePath }).toString()}`
}
