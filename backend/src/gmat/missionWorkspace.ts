import path from "node:path"

import { isMissionRunWorkspace } from "../digitalThread/digitalThreadStore.js"
import { isPathInside } from "../shared/index.js"

export type ResolveMissionWorkspaceOptions = {
  requireExplicitWorkspace?: boolean
  requireMissionRun?: boolean
  resolveRelativeToRoot?: boolean
}

/** Resolves a client workspace only after constraining it to the current user's root. */
export function resolveMissionWorkspace(
  userWorkspaceRoot: string,
  candidate: unknown,
  { requireExplicitWorkspace = false, requireMissionRun = false, resolveRelativeToRoot = false }: ResolveMissionWorkspaceOptions = {},
) {
  if (typeof candidate !== "string" || !candidate.trim()) {
    if (requireExplicitWorkspace) throw new Error("workspaceDir is required")
    return userWorkspaceRoot
  }

  const root = path.resolve(userWorkspaceRoot)
  const workspaceDir = resolveRelativeToRoot ? path.resolve(root, candidate) : path.resolve(candidate)
  if (!isPathInside(root, workspaceDir)) throw new Error("workspaceDir must be inside the current user workspace")
  if (requireMissionRun && !isMissionRunWorkspace(workspaceDir)) throw new Error("select a dated mission run workspace first")
  return workspaceDir
}
