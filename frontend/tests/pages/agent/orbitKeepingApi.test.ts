import { describe, expect, it, vi } from 'vitest'
import { analyzeOrbitKeepingRun, generateOrbitKeeping } from '../../../src/pages/agent/orbitKeepingApi'

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

  it('asks about a saved run through the analysis route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      answer: 'The minimum reported altitude is 190 km.',
      latencyMs: 1200,
      runId: '26-07-29_15-42',
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(analyzeOrbitKeepingRun({
      question: 'What was the minimum altitude?',
      runPath: 'gmat/orbit-keeping/26-07-29_15-42',
    })).resolves.toMatchObject({ runId: '26-07-29_15-42' })
    expect(fetchMock).toHaveBeenCalledWith('/api/gmat/orbit-keeping/analyze', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({
        question: 'What was the minimum altitude?',
        runPath: 'gmat/orbit-keeping/26-07-29_15-42',
      }),
    }))
  })
})
