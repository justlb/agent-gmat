export const GMAT_MISSION_TEMPLATES = {
  chemical3d: 'chemical-3d-transfer',
  chemicalHohmann: 'chemical-hohmann-transfer',
  electricPropulsion: 'electric-propulsion-transfer',
  geoGsoOrbitKeeping: 'geo-gso-orbit-keeping',
  geoGsoElectricStationKeeping: 'geo-gso-electric-station-keeping',
  geoElectricEndOfLife: 'geo-electric-end-of-life',
  orbitKeeping: 'orbit-keeping',
} as const

export type GmatMissionTemplateId = typeof GMAT_MISSION_TEMPLATES[keyof typeof GMAT_MISSION_TEMPLATES]
export type GmatChatMode = 'gmat-orbit-keeping' | 'gmat-geo-gso-orbit-keeping' | 'gmat-geo-gso-electric-station-keeping' | 'gmat-geo-electric-end-of-life' | 'gmat-electric-propulsion' | 'gmat-chemical-hohmann' | 'gmat-chemical-3d'

export function isGmatMissionTemplateId(value: string): value is GmatMissionTemplateId {
  return Object.values(GMAT_MISSION_TEMPLATES).includes(value as GmatMissionTemplateId)
}

const CHAT_MODE_BY_TEMPLATE: Record<GmatMissionTemplateId, GmatChatMode> = {
  'chemical-3d-transfer': 'gmat-chemical-3d',
  'chemical-hohmann-transfer': 'gmat-chemical-hohmann',
  'electric-propulsion-transfer': 'gmat-electric-propulsion',
  'geo-gso-orbit-keeping': 'gmat-geo-gso-orbit-keeping',
  'geo-gso-electric-station-keeping': 'gmat-geo-gso-electric-station-keeping',
  'geo-electric-end-of-life': 'gmat-geo-electric-end-of-life',
  'orbit-keeping': 'gmat-orbit-keeping',
}

export function chatModeForMissionTemplate(template: GmatMissionTemplateId): GmatChatMode {
  return CHAT_MODE_BY_TEMPLATE[template]
}

export function missionTemplateForChatMode(chatMode: GmatChatMode): GmatMissionTemplateId {
  return (Object.entries(CHAT_MODE_BY_TEMPLATE).find(([, mode]) => mode === chatMode)?.[0] as GmatMissionTemplateId | undefined)
    ?? GMAT_MISSION_TEMPLATES.orbitKeeping
}
