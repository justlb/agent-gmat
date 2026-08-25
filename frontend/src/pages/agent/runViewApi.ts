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

export type RunView = {
  artifacts: RunViewArtifact[]
  document: Record<string, unknown>
  missionValues: Record<string, string | number | null>
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
