import type { ChildProcess } from "node:child_process"
import path from "node:path"

const activeCalculations = new Map<string, Set<ChildProcess>>()

export function registerActiveCalculation(runDir: string, child: ChildProcess) {
  const key = path.resolve(runDir)
  const children = activeCalculations.get(key) ?? new Set<ChildProcess>()
  children.add(child)
  activeCalculations.set(key, children)
}

export function unregisterActiveCalculation(runDir: string, child: ChildProcess) {
  const key = path.resolve(runDir)
  const children = activeCalculations.get(key)
  if (!children) return
  children.delete(child)
  if (children.size === 0) activeCalculations.delete(key)
}

export function cancelActiveCalculations(root: string, runDir?: string | null) {
  const scope = runDir ? path.resolve(runDir) : path.resolve(root)
  let cancelled = 0
  for (const [key, children] of activeCalculations) {
    if (key !== scope && !key.startsWith(scope + path.sep)) continue
    for (const child of children) {
      if (child.exitCode !== null || child.killed) continue
      child.kill("SIGKILL")
      cancelled += 1
    }
  }
  return cancelled
}
