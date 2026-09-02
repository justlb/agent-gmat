/** IDs exposed by the backend scenario registry.  The names are deliberately
 * stable: existing draft URLs remain valid while the corrected library grows. */
export const GMAT_MISSION_TEMPLATES = {
  chemical2d: 'chemical-2d-transfer', chemical3d: 'chemical-3d-transfer', chemicalEscape: 'chemical-escape', chemicalLeoMaintenance: 'chemical-leo-orbit-maintenance',
  electrical2d: 'electrical-2d-transfer', electrical3d: 'electrical-3d-transfer', electricalEscape: 'electrical-escape', electricalLeoMaintenance: 'electrical-leo-orbit-maintenance',
  geoChemicalStationKeeping: 'geo-chemical-station-keeping', geoElectricStationKeeping: 'geo-electric-station-keeping', gsoChemicalStationKeeping: 'gso-chemical-station-keeping', gsoElectricStationKeeping: 'gso-electric-station-keeping',
  orbitKeeping: 'orbit-keeping', geoGsoOrbitKeeping: 'geo-gso-orbit-keeping', geoGsoElectricStationKeeping: 'geo-gso-electric-station-keeping', geoElectricEndOfLife: 'geo-electric-end-of-life', electricPropulsion: 'electric-propulsion-transfer', chemicalHohmann: 'chemical-hohmann-transfer',
} as const
export type GmatMissionTemplateId = typeof GMAT_MISSION_TEMPLATES[keyof typeof GMAT_MISSION_TEMPLATES]
export type GmatChatMode = `gmat-${string}`
export function isGmatMissionTemplateId(value: string): value is GmatMissionTemplateId { return Object.values(GMAT_MISSION_TEMPLATES).includes(value as GmatMissionTemplateId) }
const CHAT_MODE_BY_TEMPLATE: Record<GmatMissionTemplateId, GmatChatMode> = Object.fromEntries(Object.values(GMAT_MISSION_TEMPLATES).map(template => [template, `gmat-${template}`])) as unknown as Record<GmatMissionTemplateId, GmatChatMode>
CHAT_MODE_BY_TEMPLATE['orbit-keeping'] = 'gmat-orbit-keeping'
CHAT_MODE_BY_TEMPLATE['electric-propulsion-transfer'] = 'gmat-electric-propulsion'
CHAT_MODE_BY_TEMPLATE['chemical-hohmann-transfer'] = 'gmat-chemical-hohmann'
CHAT_MODE_BY_TEMPLATE['chemical-3d-transfer'] = 'gmat-chemical-3d'
export function chatModeForMissionTemplate(template: GmatMissionTemplateId): GmatChatMode { return CHAT_MODE_BY_TEMPLATE[template] }
export function missionTemplateForChatMode(chatMode: GmatChatMode): GmatMissionTemplateId { return (Object.entries(CHAT_MODE_BY_TEMPLATE).find(([, mode]) => mode === chatMode)?.[0] as GmatMissionTemplateId | undefined) ?? GMAT_MISSION_TEMPLATES.orbitKeeping }
