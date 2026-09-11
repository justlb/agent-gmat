import { afterEach, describe, expect, it, vi } from 'vitest'
import { askResultAssistant, getResultSamples, listResultRuns } from '../../../src/pages/agent/runResultsApi'

afterEach(() => vi.unstubAllGlobals())
describe('Results API', () => {
  it('normalizes orbit elapsed seconds and derives electrical altitude without inventing absent metrics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ samples: [
      { elapsedSeconds: 30000, semiMajorAxisKm: 6878.1363, fuelMassKg: 8 },
      // Legacy orbit runs used this key even though the GMAT column is seconds.
      { epochA1ModJulian: 30001, altitudeKm: 490, fuelMassKg: 7 },
      { elapsedDays: 'not a number', altitudeKm: 600 },
    ] }))))
    const samples = await getResultSamples('gmat/mission-runs/26-09-04_12-00')
    expect(samples).toHaveLength(2)
    expect(samples[0].altitudeKm).toBeCloseTo(500)
    expect(samples[1].elapsedDays).toBeCloseTo(30001 / 86400)
    expect(samples[1].altitudeKm).toBe(490)
    expect(samples[0].powerAvailableKw).toBeUndefined()
  })
  it('sends only the selected run and the question to the read-only assistant route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answer: 'Saved evidence' })))
    vi.stubGlobal('fetch', fetchMock)
    await askResultAssistant('gmat/mission-runs/26-09-04_12-00', 'Explain')
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/analysis', expect.objectContaining({ body: JSON.stringify({ runPath: 'gmat/mission-runs/26-09-04_12-00', message: 'Explain' }) }))
  })
  it('reports a readable error when the service is restarting', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 502 })))
    await expect(listResultRuns()).rejects.toThrow('temporarily unavailable')
  })
})
