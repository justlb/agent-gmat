import { describe, expect, it } from 'vitest'

import { chatModeForMissionTemplate, missionTemplateForChatMode } from '../../../src/pages/agent/gmatMissionTemplates'

describe('GMAT mission template registry', () => {
  it('maps conversational templates to their dedicated chat mode', () => {
    expect(chatModeForMissionTemplate('orbit-keeping')).toBe('gmat-orbit-keeping')
    expect(chatModeForMissionTemplate('electric-propulsion-transfer')).toBe('gmat-electric-propulsion')
  })

  it('keeps the form-driven chemical Hohmann template out of the chat router', () => {
    expect(chatModeForMissionTemplate('chemical-hohmann-transfer')).toBe('general')
    expect(missionTemplateForChatMode('gmat-orbit-keeping')).toBe('orbit-keeping')
    expect(missionTemplateForChatMode('gmat-electric-propulsion')).toBe('electric-propulsion-transfer')
  })
})
