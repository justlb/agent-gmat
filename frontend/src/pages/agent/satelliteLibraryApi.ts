import { joinApiPath } from '../../app/apiBase'

export type SatelliteDefinition = {
  id: string
  version: string
  name: string
  description: string
  capabilities: string[]
  mission_templates: string[]
  satellite: Record<string, unknown>
}

type DigitalThreadResponse = { document: { digital_thread?: { satellite_definition?: { id?: string; version?: string } } } }

async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(joinApiPath(undefined, path), options)
  const payload = await response.json() as T & { error?: unknown }
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Satellite library request failed')
  return payload
}

export async function listSatelliteDefinitions() { return (await request<{ definitions: SatelliteDefinition[] }>('/satellite-library')).definitions }
export async function getSelectedSatellite(workspaceDir?: string | null) {
  const query = workspaceDir ? `?workspaceDir=${encodeURIComponent(workspaceDir)}` : ''
  return request<DigitalThreadResponse>(`/digital-thread/satellite${query}`)
}
export async function selectSatelliteDefinition(id: string, version: string, workspaceDir?: string | null) {
  return request<{ definition: SatelliteDefinition }>('/satellite-library/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, version, workspaceDir }) })
}
