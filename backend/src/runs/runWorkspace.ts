/**
 * Role: Resolves and validates dated mission-run directories for every tool.
 * Exports: resolveMissionRun, requireMissionRun, relativeToWorkspaceRoot.
 * Dependencies: node:path and the shared path-containment guard.
 * Invariant: a resolved run is always inside the authenticated user's root.
 */
import path from "node:path"

import { isPathInside } from "../shared/index.js"
import { artifactDefinitionForPath } from "./artifactRegistry.js"

export type MissionRunReference = {
  root: string
  runDir: string
  runPath: string
  runId: string
}

export const MISSION_RUN_ID_PATTERN = /^\d{2}-\d{2}-\d{2}_\d{2}-\d{2}(?:_\d{2})?$/u

export function missionRunsDirectory(rootCandidate: string) {
  return path.join(path.resolve(rootCandidate), "gmat", "mission-runs")
}

export function missionRunDirectory(rootCandidate: string, runId: string) {
  if (!MISSION_RUN_ID_PATTERN.test(runId)) throw new Error("invalid mission run id")
  return path.join(missionRunsDirectory(rootCandidate), runId)
}

/** True only for a direct child of a recognized run collection. */
export function isMissionRunWorkspacePath(candidate: string) {
  const normalized = path.resolve(candidate).split(path.sep).join("/")
  const runId = path.posix.basename(normalized)
  return MISSION_RUN_ID_PATTERN.test(runId)
    && /\/gmat\/(?:mission-runs|orbit-keeping|electric-propulsion-transfer)\/[^/]+$/u.test(normalized)
}

/** Returns a run only when its path is a dated GMAT run owned by this workspace. */
export function resolveMissionRun(rootCandidate: string, candidate: unknown): MissionRunReference | null {
  if (typeof candidate !== "string" || !candidate.trim()) return null
  const root = path.resolve(rootCandidate)
  const runDir = path.resolve(root, candidate)
  if (!isPathInside(root, runDir) || !isMissionRunWorkspacePath(runDir)) return null
  return { root, runDir, runId: path.basename(runDir), runPath: path.relative(root, runDir).split(path.sep).join("/") }
}

/** Same as resolveMissionRun, but supplies the stable API error used by tool routes. */
export function requireMissionRun(root: string, candidate: unknown) {
  const run = resolveMissionRun(root, candidate)
  if (!run) throw new Error("invalid GMAT run path")
  return run
}

/** Converts an owned absolute path to an API-safe workspace-relative path. */
export function relativeToWorkspaceRoot(rootCandidate: string, filePath: string) {
  const root = path.resolve(rootCandidate)
  const resolved = path.resolve(filePath)
  if (!isPathInside(root, resolved)) throw new Error("path must be inside the current user workspace")
  return path.relative(root, resolved).split(path.sep).join("/")
}

/** Resolves a downloadable artifact only when both its run and its run-local
 * relative path belong to the shared registries. */
export function resolveMissionRunArtifact(rootCandidate: string, candidate: unknown) {
  if (typeof candidate !== "string" || !candidate.trim()) return null
  const root = path.resolve(rootCandidate)
  const filePath = path.resolve(root, candidate)
  if (!isPathInside(root, filePath)) return null
  const segments = path.relative(root, filePath).split(path.sep)
  if (segments.length < 4 || segments[0] !== "gmat") return null
  const run = resolveMissionRun(root, segments.slice(0, 3).join(path.sep))
  if (!run) return null
  const artifactPath = segments.slice(3).join("/")
  return artifactDefinitionForPath(artifactPath) ? filePath : null
}
