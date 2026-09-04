import { joinApiPath } from '../../app/apiBase'
export const RESULT_STAGES = [['gmat', 'GMAT'], ['simu_cic', 'Simu-CIC'], ['opalis', 'OPALIS'], ['rf_comlink', 'RF-COMLINK']] as const
export type ResultWorkflow = { stages: Partial<Record<(typeof RESULT_STAGES)[number][0], { status: string; message?: string | null }>> }

export type ResultRun = { runId: string; runPath: string; templateId: string | null; name: string; createdAt: string | null; status: 'completed' | 'failed' | 'running' | 'partial' | 'not_started' | 'unknown'; workflow: ResultWorkflow | null }
export type ResultTurn = { question: string; answer: string; askedAt?: string }
export type ResultSample = { elapsedDays: number; altitudeKm?: number; eccentricity?: number; fuelMassKg?: number; semiMajorAxisKm?: number; powerAvailableKw?: number; massFlowRateKgPerSec?: number }

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(joinApiPath(undefined, url), { cache: 'no-store', ...init })
  const payload = await response.json().catch(() => { throw new Error(`The run service is temporarily unavailable (HTTP ${response.status}). Please retry.`) }) as T & { error?: string }
  if (!response.ok) throw new Error(payload.error ?? 'Unable to load run results')
  return payload
}
export function listResultRuns(workspaceDir?: string | null) { return request<{ runs: ResultRun[] }>(`/runs/results?${new URLSearchParams(workspaceDir ? { workspaceDir } : {})}`) }
export function getResultConversation(runPath: string) { return request<{ conversation: ResultTurn[] }>(`/runs/conversation?${new URLSearchParams({ runPath })}`) }
export function askResultAssistant(runPath: string, message: string) { return request<{ answer: string }>('/runs/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runPath, message }) }) }
export async function getResultSamples(runPath: string) {
  const { samples } = await request<{ samples: Array<Record<string, unknown>> }>(`/runs/timeseries?${new URLSearchParams({ runPath })}`)
  const firstEpoch = samples.find(sample => typeof sample?.epochA1ModJulian === 'number')?.epochA1ModJulian as number | undefined
  return samples.flatMap(sample => {
    if (!sample || typeof sample !== 'object') return []
    const elapsedDays = typeof sample.elapsedDays === 'number' ? sample.elapsedDays : typeof sample.epochA1ModJulian === 'number' && firstEpoch !== undefined ? sample.epochA1ModJulian - firstEpoch : NaN
    if (!Number.isFinite(elapsedDays)) return []
    const result: ResultSample = { elapsedDays }
    for (const key of ['altitudeKm', 'eccentricity', 'fuelMassKg', 'semiMajorAxisKm', 'powerAvailableKw', 'massFlowRateKgPerSec'] as const) {
      if (typeof sample[key] === 'number' && Number.isFinite(sample[key])) result[key] = sample[key]
    }
    if (result.altitudeKm === undefined && result.semiMajorAxisKm !== undefined) result.altitudeKm = result.semiMajorAxisKm - 6378.1363
    return [result]
  })
}
