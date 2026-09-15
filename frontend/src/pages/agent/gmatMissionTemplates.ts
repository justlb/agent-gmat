export const GMAT_MISSION_TEMPLATES = {
  chemicalEscape: 'chemical-escape',
  chemical3d: 'chemical-3d-transfer',
  chemicalHohmann: 'chemical-hohmann-transfer',
  electricPropulsion: 'electric-propulsion-transfer',
  electricalLeoOrbitMaintenance: 'electrical-leo-orbit-maintenance',
  orbitKeeping: 'orbit-keeping',
} as const

export type GmatMissionTemplateId = typeof GMAT_MISSION_TEMPLATES[keyof typeof GMAT_MISSION_TEMPLATES]
export type GmatChatMode = 'gmat-orbit-keeping' | 'gmat-electric-propulsion' | 'gmat-electrical-leo-orbit-maintenance' | 'gmat-chemical-hohmann' | 'gmat-chemical-escape' | 'gmat-chemical-3d'

export function isGmatMissionTemplateId(value: string): value is GmatMissionTemplateId {
  return Object.values(GMAT_MISSION_TEMPLATES).includes(value as GmatMissionTemplateId)
}

const CHAT_MODE_BY_TEMPLATE: Record<GmatMissionTemplateId, GmatChatMode> = {
  'chemical-escape': 'gmat-chemical-escape',
  'chemical-3d-transfer': 'gmat-chemical-3d',
  'chemical-hohmann-transfer': 'gmat-chemical-hohmann',
  'electric-propulsion-transfer': 'gmat-electric-propulsion',
  'electrical-leo-orbit-maintenance': 'gmat-electrical-leo-orbit-maintenance',
  'orbit-keeping': 'gmat-orbit-keeping',
}

export function chatModeForMissionTemplate(template: GmatMissionTemplateId): GmatChatMode {
  return CHAT_MODE_BY_TEMPLATE[template]
}

export function missionTemplateForChatMode(chatMode: GmatChatMode): GmatMissionTemplateId {
  return (Object.entries(CHAT_MODE_BY_TEMPLATE).find(([, mode]) => mode === chatMode)?.[0] as GmatMissionTemplateId | undefined)
    ?? GMAT_MISSION_TEMPLATES.orbitKeeping
}
