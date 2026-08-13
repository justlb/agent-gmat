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

export type SimuCicConfiguration = {
  attitude_mode: 'nadir_pointing' | 'ground_station_tracking' | null
  ground_station_ids: string[]
  simultaneous_visibility_policy: 'first_visible_station_wins' | null
}

export type PredefinedGroundStation = {
  id: string
  name: string
  longitudeDeg: number
  latitudeDeg: number
  altitudeM: number
  minElevationDeg: number
}

export type DigitalThreadResponse = {
  adapters?: {
    gmat?: {
      electricPropulsionTransfer?: { values?: Record<string, string | number | null> }
      orbitKeeping?: { values?: Record<string, string | number | null> }
    }
  }
  document: {
    digital_thread?: { satellite_definition?: { id?: string; version?: string } }
    analysis_requests?: { simu_cic?: SimuCicConfiguration }
  }
}

async function request<T>(path: string, options?: RequestInit) {
  const response = await fetch(joinApiPath(undefined, path), { cache: 'no-store', ...options })
  const payload = await response.json() as T & { error?: unknown }
  if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Satellite library request failed')
  return payload
}

export async function listSatelliteDefinitions() { return (await request<{ definitions: SatelliteDefinition[] }>('/satellite-library')).definitions }
export function satelliteDefinitionDownloadUrl(definition: Pick<SatelliteDefinition, 'id' | 'version'>) {
  return joinApiPath(undefined, `/satellite-library/${encodeURIComponent(definition.id)}/download?${new URLSearchParams({ version: definition.version }).toString()}`)
}
export async function getSelectedSatellite(workspaceDir?: string | null) {
  const query = workspaceDir ? `?workspaceDir=${encodeURIComponent(workspaceDir)}` : ''
  return request<DigitalThreadResponse>(`/digital-thread/satellite${query}`)
}
export async function selectSatelliteDefinition(id: string, version: string, workspaceDir?: string | null) {
  return request<{ definition: SatelliteDefinition }>('/satellite-library/select', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, version, workspaceDir }) })
}
export async function getMissionConversation(workspaceDir?: string | null) {
  const query = workspaceDir ? `?workspaceDir=${encodeURIComponent(workspaceDir)}` : ''
  const result = await request<{ conversation?: Array<{ answer: string; askedAt: string; question: string }> }>(`/digital-thread/satellite/conversation${query}`)
  return Array.isArray(result.conversation) ? result.conversation : []
}

export async function listSimuCicGroundStations() {
  return (await request<{ stations: PredefinedGroundStation[] }>('/opalis/simu-cic/ground-stations')).stations
}

export async function saveSimuCicConfiguration(configuration: Pick<SimuCicConfiguration, 'attitude_mode' | 'ground_station_ids'>, workspaceDir?: string | null) {
  return request<DigitalThreadResponse>('/digital-thread/satellite/simu-cic', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      attitudeMode: configuration.attitude_mode,
      groundStationIds: configuration.ground_station_ids,
      workspaceDir,
    }),
  })
}
