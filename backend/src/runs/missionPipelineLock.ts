import path from "node:path"

/** In-memory per-run mutex for long-running mission pipeline operations.
 * The workflow log remains durable; this lock prevents concurrent requests in
 * this backend process from mutating the same run at the same time. */
const activeRuns = new Set<string>()

export function acquireMissionPipelineLock(runDir: string, operation: string) {
  const key = `${path.resolve(runDir)}\u0000${operation}`
  if (activeRuns.has(key)) return false
  activeRuns.add(key)
  return true
}

export function releaseMissionPipelineLock(runDir: string, operation: string) {
  activeRuns.delete(`${path.resolve(runDir)}\u0000${operation}`)
}
