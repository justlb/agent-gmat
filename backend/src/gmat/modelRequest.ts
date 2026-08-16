const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504])

function wait(delayMs: number) {
  return new Promise<void>(resolve => setTimeout(resolve, delayMs))
}

/** Retries only transient model-gateway failures, preserving the caller's request payload. */
export async function requestGmatModel(
  fetchImpl: typeof fetch,
  url: string,
  init: Omit<RequestInit, "signal">,
  { attempts = 3, timeoutMs = 60_000 }: { attempts?: number; timeoutMs?: number } = {},
) {
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) })
      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt === attempts) return response
      // Drain the retryable response so the connection can be reused.
      await response.arrayBuffer().catch(() => undefined)
    } catch (error) {
      lastError = error
      if (attempt === attempts) break
    }
    await wait(500 * attempt)
  }
  const detail = lastError instanceof Error && lastError.message ? ` (${lastError.message})` : ""
  throw new Error(`GMAT assistant could not reach the model after ${attempts} attempts. Please retry.${detail}`)
}
