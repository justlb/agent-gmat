import { describe, expect, it, vi } from 'vitest'

import { buildApiUrl, getApiErrorMessage, readServerSentEvents, requestApiJson } from '../../src/app/apiClient'

describe('apiClient', () => {
  it('builds API URLs using the configured base and skips empty query values', () => {
    expect(buildApiUrl('/gmat/drafts', {
      apiBase: '/gateway/api/',
      query: { draftId: 'draft_1', empty: null, workspaceDir: '/data/current' },
    })).toBe('/gateway/api/gmat/drafts?draftId=draft_1&workspaceDir=%2Fdata%2Fcurrent')
  })

  it('uses a server error message when a JSON request fails', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'draft is not ready' }), { status: 422 }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(requestApiJson('/gmat/drafts')).rejects.toThrow('draft is not ready')
    expect(fetchMock).toHaveBeenCalledWith('/api/gmat/drafts', {})
  })

  it('falls back to the supplied message for malformed error responses', async () => {
    await expect(getApiErrorMessage(new Response('not json', { status: 503 }), 'GMAT request failed')).resolves.toBe('GMAT request failed: 503')
  })

  it('reads SSE frames split across network chunks', async () => {
    const encoder = new TextEncoder()
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: progress\ndata: {"percent":40}'))
        controller.enqueue(encoder.encode('\n\nevent: result\ndata: {"runId":"run_1"}\n\n'))
        controller.close()
      },
    }))
    const events: Array<{ event: string; payload: unknown }> = []

    await readServerSentEvents(response, (event) => events.push(event))

    expect(events).toEqual([
      { event: 'progress', payload: { percent: 40 } },
      { event: 'result', payload: { runId: 'run_1' } },
    ])
  })
})
