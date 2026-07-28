import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getErrorMessage } from "../shared/index.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { generateOrbitKeepingMission } from "./orbitKeeping.service.js"

type GenerateOrbitKeepingBody = { request?: unknown }

/** HTTP boundary for the one-call, deterministic orbit-keeping pipeline. */
export async function orbitKeepingRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.post<{ Body: GenerateOrbitKeepingBody }>("/api/gmat/orbit-keeping/generate", async (req, reply) => {
    const request = typeof req.body?.request === "string" ? req.body.request.trim() : ""
    if (!request) return reply.status(400).send({ error: "request must be a non-empty string" })

    const workspaceDir = getRequestUserWorkspaceRoot()
    if (!workspaceDir) return reply.status(500).send({ error: "user workspace is unavailable" })

    try {
      return reply.send(await generateOrbitKeepingMission({
        connection: resolveModelBackend(config, "chatModel"),
        request,
        workspaceDir,
      }))
    } catch (err) {
      return reply.status(422).send({ error: getErrorMessage(err, "failed to generate orbit-keeping mission") })
    }
  })
}
