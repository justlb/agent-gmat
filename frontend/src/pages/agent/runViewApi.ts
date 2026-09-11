/**
 * Role: Loads the canonical backend-owned view of one dated mission run.
 * Exports: getRunView and view-model types used by Mission Studio.
 * Dependencies: shared API base URL helper.
 * Invariant: saved values shown in the UI are projected from that run's satellite.json.
 */
import { joinApiPath } from '../../app/apiBase'
import type { SimuCicConfiguration } from './satelliteLibraryApi'

export type RunViewArtifact = {
  category: 'primary' | 'result' | 'technical'
  contentType: string
  id: string
  relativePath: string
  size: number
  tool: 'gmat' | 'simu-cic' | 'opalis' | 'rf-comlink'
  updatedAt: string
}

export type RFComlinkBudgetCases = { nominal: number; three_sigma?: number; worst_case_rss?: number }
export type RFComlinkLinkBudget = {
  achieved_ebn0_db: RFComlinkBudgetCases | null
  binary_rate_bps: number | null
  data_recovery_margin_db: RFComlinkBudgetCases | null
  elevation_deg: number | null
  frequency_mhz: number | null
  link_name: string
  link_type: string | null
  range_km: number | null
  received_cn0_dbhz: RFComlinkBudgetCases | null
  required_ebn0_db: number | null
  source_report: string
  status: 'pass' | 'fail' | 'unavailable'
  system_temperature_k: number | null
}

export type RunView = {
  artifacts: RunViewArtifact[]
  document: Record<string, unknown>
  missionValues: Record<string, string | number | null>
  overview: Record<string, { source: string; value: string; detail?: string }>
  rfComlink: { linkBudgets: RFComlinkLinkBudget[] }
  runId: string
  runPath: string
  satelliteAssumptions: Array<{ label: string; value: string }>
  simuCic: SimuCicConfiguration
  source: 'satellite.json'
  templateId: string | null
  workflow: unknown
}

export async function getRunView(runPath: string) {
  const query = new URLSearchParams({ runPath }).toString()
  const response = await fetch(joinApiPath(undefined, `/runs/view?${query}`), { cache: 'no-store' })
  const payload = await response.json() as RunView & { error?: unknown }
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to load the saved mission run.')
  return payload
}

/** Direct download URL for one generated artifact of a dated run. */
export function runArtifactDownloadUrl(runPath: string, relativePath: string) {
  const query = new URLSearchParams({ runPath, relativePath }).toString()
  return joinApiPath(undefined, `/runs/artifact?${query}`)
}
