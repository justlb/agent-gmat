/**
 * Role: HTTP endpoint returning the canonical, run-scoped Mission Studio view.
 * Exports: runViewRoutes.
 * Dependencies: request context, run workspace and run view model.
 */
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"

import type { FastifyInstance } from "fastify"

import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { resolveMissionRun } from "./runWorkspace.js"
import { buildRunViewModel } from "./runViewModel.js"
import { listResultRuns, loadResultConversation, loadResultSamples } from "./runResults.js"
import { RUN_ARTIFACTS, artifactDefinitionForPath } from "./artifactRegistry.js"

export async function runViewRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { workspaceDir?: string } }>("/api/runs/results", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try { return { runs: await listResultRuns(root, req.query.workspaceDir) } }
    catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to list mission runs") }) }
  })
  for (const [endpoint, load] of [["conversation", loadResultConversation], ["timeseries", loadResultSamples]] as const) {
    fastify.get<{ Querystring: { runPath?: string } }>(`/api/runs/${endpoint}`, async (req, reply) => {
      const root = getRequestUserWorkspaceRoot()
      if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
      const run = resolveMissionRun(root, req.query.runPath)
      if (!run) return reply.status(400).send({ error: "invalid GMAT run path" })
      try {
        const result = await load(run.runDir)
        return endpoint === "conversation" ? { conversation: result } : result
      } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to read run results") }) }
    })
  }
  fastify.get<{ Querystring: { runPath?: unknown } }>("/api/runs/view", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const run = resolveMissionRun(root, req.query.runPath)
    if (!run) return reply.status(400).send({ error: "invalid GMAT run path" })
    try { return reply.send(await buildRunViewModel(run)) }
    catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to load the canonical mission run view") }) }
  })

  /** Streams one generated artifact (GMAT/Simu-CIC/OPALIS/RF-COMLINK) from a
   * dated run. Only paths declared in the shared artifact registry are served,
   * and the resolved file must stay inside the run directory. */
  fastify.get<{ Querystring: { runPath?: unknown; relativePath?: string } }>("/api/runs/artifact", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const run = resolveMissionRun(root, req.query.runPath)
    if (!run) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      const requested = typeof req.query.relativePath === "string" ? req.query.relativePath.replace(/\\/gu, "/") : ""
      const declared = RUN_ARTIFACTS.find(artifact => artifact.relativePath === requested) ?? artifactDefinitionForPath(requested)
      if (!declared) return reply.status(404).send({ error: "run artifact not found" })
      const filePath = path.join(run.runDir, ...declared.relativePath.split("/"))
      if (!isPathInside(run.runDir, filePath)) return reply.status(404).send({ error: "run artifact not found" })
      const stat = await fs.stat(filePath).catch(() => null)
      if (!stat?.isFile()) return reply.status(404).send({ error: "run artifact not found" })
      return reply
        .header("Content-Type", declared.contentType)
        .header("Content-Disposition", `attachment; filename="${path.basename(filePath)}"`)
        .header("Content-Length", String(stat.size))
        .send(createReadStream(filePath))
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to download run artifact") }) }
  })
}
