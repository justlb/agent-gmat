import { joinApiPath } from './apiBase'

type ErrorPayload = { error?: unknown; message?: unknown }

export type ApiRequestOptions = Omit<RequestInit, 'body'> & {
  apiBase?: string
  body?: BodyInit | null
  query?: Record<string, string | number | boolean | null | undefined>
}

export function buildApiUrl(path: string, { apiBase, query }: Pick<ApiRequestOptions, 'apiBase' | 'query'> = {}) {
  const url = joinApiPath(apiBase, path)
  const parameters = new URLSearchParams()
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== null && value !== undefined) parameters.set(key, String(value))
  }
  const suffix = parameters.toString()
  return suffix ? `${url}?${suffix}` : url
}

export async function getApiErrorMessage(response: Response, fallback = 'Request failed') {
  const source = await response.text().catch(() => '')
  const payload = (() => { try { return JSON.parse(source) as ErrorPayload } catch { return {} } })()
  if (typeof payload.error === 'string' && payload.error.trim()) return payload.error
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message
  if (source.trim()) return `${fallback}: ${response.status} — ${source.trim().slice(0, 500)}`
  return `${fallback}: ${response.status}`
}

export async function requestApiJson<T>(path: string, options: ApiRequestOptions = {}) {
  const { apiBase, query, ...request } = options
  const response = await fetch(buildApiUrl(path, { apiBase, query }), request)
  if (!response.ok) throw new Error(await getApiErrorMessage(response))
  return response.json() as Promise<T>
}

export type ServerSentEvent = {
  event: string
  payload: unknown
}

/** Reads the simple single-line event/data frames emitted by the GMAT API. */
export async function readServerSentEvents(response: Response, onEvent: (event: ServerSentEvent) => void) {
  if (!response.body) throw new Error('GMAT progress stream is unavailable')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    const frames = buffer.split(/\n\n/u)
    buffer = frames.pop() ?? ''

    for (const frame of frames) {
      const event = /^event: ([^\n]+)$/mu.exec(frame)?.[1]
      const source = /^data: (.+)$/mu.exec(frame)?.[1]
      if (!event || !source) continue
      onEvent({ event, payload: JSON.parse(source) as unknown })
    }
  }
}
