/**
 * Role: Loads the backend-owned Mission Studio template catalogue.
 * Exports: listMissionTemplateDefinitions and template UI types.
 * Dependencies: API base URL helper and the stable template-ID type.
 * Invariant: labels, mission fields and satellite requirements come from the
 * versioned backend template manifests, not a frontend duplicate.
 */
import { joinApiPath } from '../../app/apiBase'
import type { GmatChatMode, GmatMissionTemplateId } from './gmatMissionTemplates'

export type MissionInputField = {
  derived?: 'initialAltitude'
  label: string
  path: string
  unit?: string
  valueTransform?: 'earth-radius'
}

export type MissionTemplateDefinition = {
  chatMode: GmatChatMode
  description: string
  downstreamAnalyses: string[]
  id: GmatMissionTemplateId
  name: string
  ui: {
    missionInputFields: MissionInputField[]
    objective: string
    outputs: string[]
    satelliteRequirements: string[]
    summary: string
  }
}

let catalogueRequest: Promise<MissionTemplateDefinition[]> | null = null

/** Reads and memoizes the immutable manifest catalogue for this browser session. */
export function listMissionTemplateDefinitions() {
  catalogueRequest ??= fetch(joinApiPath(undefined, '/gmat/templates'), { cache: 'no-store' })
    .then(async response => {
      const payload = await response.json() as { error?: unknown; templates?: unknown }
      if (!response.ok) throw new Error(typeof payload.error === 'string' ? payload.error : 'Unable to load GMAT templates')
      if (!Array.isArray(payload.templates)) throw new Error('GMAT template catalogue is invalid')
      return payload.templates as MissionTemplateDefinition[]
    })
    .catch(error => {
      catalogueRequest = null
      throw error
    })
  return catalogueRequest
}

/** Direct download URL for the immutable reference script declared by a template manifest. */
export function missionTemplateExampleScriptUrl(template: GmatMissionTemplateId) {
  return joinApiPath(undefined, `/gmat/templates/${encodeURIComponent(template)}/example-script`)
}
