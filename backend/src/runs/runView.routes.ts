/**
 * Role: HTTP endpoint returning the canonical, run-scoped Mission Studio view.
 * Exports: runViewRoutes.
 * Dependencies: request context, run workspace and run view model.
 */
import type { FastifyInstance } from "fastify"

import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage } from "../shared/index.js"
import { resolveMissionRun } from "./runWorkspace.js"
import { buildRunViewModel } from "./runViewModel.js"

export async function runViewRoutes(fastify: FastifyInstance) {
  fastify.get<{ Querystring: { runPath?: unknown } }>("/api/runs/view", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const run = resolveMissionRun(root, req.query.runPath)
    if (!run) return reply.status(400).send({ error: "invalid GMAT run path" })
    try { return reply.send(await buildRunViewModel(run)) }
    catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to load the canonical mission run view") }) }
  })
}
