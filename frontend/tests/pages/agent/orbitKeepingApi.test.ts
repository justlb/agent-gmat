import { describe, expect, it, vi } from 'vitest'
import { generateOrbitKeeping } from '../../../src/pages/agent/orbitKeepingApi'

describe('generateOrbitKeeping', () => {
  it('sends the user request to the dedicated GMAT route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      changes: [{ id: 'line_024_DefaultSC_DryMass', value: '200' }],
      latencyMs: 24000,
      scriptPath: '/workspace/gmat/orbit-keeping/run.script',
      valuesPath: '/workspace/gmat/orbit-keeping/run.values.yaml',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(generateOrbitKeeping('Change dry mass to 200 kg', { workspaceDir: '/workspace/active-version' })).resolves.toMatchObject({
      latencyMs: 24000,
      changes: [{ id: 'line_024_DefaultSC_DryMass', value: '200' }],
    })
    expect(fetchMock).toHaveBeenCalledWith('/api/gmat/orbit-keeping/generate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ request: 'Change dry mass to 200 kg', workspaceDir: '/workspace/active-version' }),
    }))
  })
})
