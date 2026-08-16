export const GMAT_MISSION_TEMPLATES = {
  chemicalHohmann: 'chemical-hohmann-transfer',
  electricPropulsion: 'electric-propulsion-transfer',
  orbitKeeping: 'orbit-keeping',
} as const

export type GmatMissionTemplateId = typeof GMAT_MISSION_TEMPLATES[keyof typeof GMAT_MISSION_TEMPLATES]
export type ConversationalGmatMissionTemplateId = Exclude<GmatMissionTemplateId, 'chemical-hohmann-transfer'>
export type GmatChatMode = 'gmat-orbit-keeping' | 'gmat-electric-propulsion'

export function chatModeForMissionTemplate(template: GmatMissionTemplateId): GmatChatMode | 'general' {
  if (template === GMAT_MISSION_TEMPLATES.orbitKeeping) return 'gmat-orbit-keeping'
  if (template === GMAT_MISSION_TEMPLATES.electricPropulsion) return 'gmat-electric-propulsion'
  return 'general'
}

export function missionTemplateForChatMode(chatMode: GmatChatMode): ConversationalGmatMissionTemplateId {
  return chatMode === 'gmat-electric-propulsion'
    ? GMAT_MISSION_TEMPLATES.electricPropulsion
    : GMAT_MISSION_TEMPLATES.orbitKeeping
}
