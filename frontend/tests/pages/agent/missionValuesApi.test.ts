import { describe, expect, it, vi } from 'vitest'

import { updateMissionValue } from '../../../src/pages/agent/missionValuesApi'

describe('updateMissionValue', () => {
  it('returns the draft type requested by the caller', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      confirmed: false, conversation: [], createdAt: '2026-08-16T12:26:00.000Z', draftId: 'draft_1', missing: [], status: 'ready', templateId: 'chemical-hohmann-transfer', updatedAt: '2026-08-16T12:27:00.000Z', values: {},
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const draft = await updateMissionValue<{ draftId: string; templateId: 'chemical-hohmann-transfer' }>({
      draftId: 'draft_1', path: 'transfer.targetRadiusKm', template: 'chemical-hohmann-transfer', value: '7200', workspaceDir: '/workspace/gmat/mission-runs/26-08-16_12-26',
    })

    expect(draft).toMatchObject({ draftId: 'draft_1', templateId: 'chemical-hohmann-transfer' })
    expect(fetchMock).toHaveBeenCalledWith('/api/gmat/templates/chemical-hohmann-transfer/drafts/draft_1/values', expect.objectContaining({ method: 'PATCH' }))
  })

  it('rejects successful responses that omit the updated draft', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({}), { status: 200 })))

    await expect(updateMissionValue({ draftId: 'draft_1', path: 'initialOrbit.smaKm', template: 'orbit-keeping', value: '7000' })).rejects.toThrow('Unable to update mission value')
  })
})
