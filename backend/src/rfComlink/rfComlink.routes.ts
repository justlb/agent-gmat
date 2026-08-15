import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

import type { FastifyInstance } from "fastify"

import { toGmatNativePath } from "../gmat/orbitKeepingRunner.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"

type RunBody = { runPath?: unknown }

/**
 * RF-COMLINK 1.1.1 is a WPF application.  It accepts a single .rfcl file as
 * its startup argument, but has no supported batch interface.  Keeping this
 * launcher here means the web application never asks the user to browse for
 * the generated scenario manually.
 */
function rfComlinkHomeForHost() {
  const configured = process.env.RF_COMLINK_HOME?.trim() || "D:\\STAGE\\APP\\rf-comlink"
  if (process.platform === "win32") return configured
  const normalized = configured.replace(/\\/gu, "/")
  const windowsPath = /^([a-z]):\/(.*)$/iu.exec(normalized)
  return windowsPath ? `/mnt/${windowsPath[1].toLowerCase()}/${windowsPath[2]}` : configured
}

function resolveGmatRunDir(root: string, candidate: unknown) {
  if (typeof candidate !== "string" || !candidate.trim()) return null
  const runDir = path.resolve(root, candidate)
  const normalized = runDir.split(path.sep).join("/")
  return isPathInside(root, runDir) && /\/gmat\/(?:orbit-keeping|electric-propulsion-transfer|mission-runs)\/[^/]+$/u.test(normalized)
    ? runDir
    : null
}

async function resolveScenario(runDir: string) {
  // The generator added in the next RF-COMLINK step will write these exact
  // paths. Prefer the calculated file so reopening an old run restores its
  // latest state, otherwise open its prepared input scenario.
  const candidates = [
    path.join(runDir, "rf-comlink", "03-results", "calculated-rf-comlink.rfcl"),
    path.join(runDir, "rf-comlink", "02-scenario", "prepared-rf-comlink.rfcl"),
  ]
  for (const candidate of candidates) {
    const stat = await fs.stat(candidate).catch(() => null)
    if (stat?.isFile() && stat.size > 0) return candidate
  }
  return null
}

export async function rfComlinkRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: RunBody }>("/api/rf-comlink/open-gui", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveGmatRunDir(path.resolve(root), req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })

    try {
      const scenario = await resolveScenario(runDir)
      if (!scenario) {
        throw new Error("Prepare the RF-COMLINK scenario first for this GMAT run")
      }
      const executable = path.join(rfComlinkHomeForHost(), "rf-comlink.exe")
      await fs.access(executable)

      // WSL starts the Windows executable through interop, but RF-COMLINK
      // itself requires the input path in native Windows notation.
      const child = spawn(executable, [toGmatNativePath(scenario)], {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      })
      await new Promise<void>((resolve, reject) => {
        child.once("error", reject)
        child.once("spawn", () => { child.unref(); resolve() })
      })
      return reply.send({ ok: true, scenario: path.relative(root, scenario) })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to open RF-COMLINK GUI") })
    }
  })
}
