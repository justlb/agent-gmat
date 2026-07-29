import { joinApiPath } from '../../app/apiBase'

export type OrbitKeepingChange = {
  id: string
  value: string
}

export type OrbitKeepingGenerateResult = {
  changes: OrbitKeepingChange[]
  latencyMs: number
  scriptPath: string
  valuesPath: string
}

async function getResponseErrorMessage(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown }
  if (typeof payload.error === 'string') return payload.error
  if (typeof payload.message === 'string') return payload.message
  return `GMAT request failed: ${response.status}`
}

/** Calls the deterministic GMAT pipeline directly, without the managed-agent dispatcher. */
export async function generateOrbitKeeping(request: string, {
  apiBase,
  workspaceDir,
}: {
  apiBase?: string
  workspaceDir?: string | null
} = {}) {
  const response = await fetch(joinApiPath(apiBase, '/gmat/orbit-keeping/generate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request, ...(workspaceDir ? { workspaceDir } : {}) }),
  })
  if (!response.ok) throw new Error(await getResponseErrorMessage(response))
  return response.json() as Promise<OrbitKeepingGenerateResult>
}
