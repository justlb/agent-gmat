import type { FastifyInstance } from "fastify"
import type { AppConfig } from "../config.js"
import type { Logger } from "../logger.js"
import { imageRoutes } from "../artifacts/index.js"
import { managedRunRoutes, taskRoutes } from "../codex-run/index.js"
import { cosyVoiceRoutes } from "../cosyvoice/index.js"
import { gncConfigRoutes } from "../gnc_config/index.js"
import { manifestRoutes } from "../manifests/index.js"
import { sessionRoutes } from "../sessions/index.js"
import { authRoutes } from "../system/auth.routes.js"
import { healthRoutes, remoteToolsRoutes, skillsRoutes } from "../system/index.js"
import { funasrRoutes } from "../funasr/index.js"
import { workspaceRoutes, stageLogsRoutes } from "../workspaces/index.js"
import { responsesCompatRoutes } from "../codex-run/responsesCompat.js"
import { orbitKeepingRoutes } from "../gmat/orbitKeeping.routes.js"
import { electricPropulsionRoutes } from "../gmat/electricPropulsion.routes.js"
import { missionRouterRoutes } from "../gmat/missionRouter.routes.js"
import { digitalThreadRoutes } from "../digitalThread/digitalThread.routes.js"
import { simuCicRoutes } from "../opalis/simuCic.routes.js"
import { opalisPreparationRoutes } from "../opalis/opalisPreparation.routes.js"
import { opalisRunRoutes } from "../opalis/opalisRun.routes.js"
import { missionAssistantRoutes } from "../gmat/missionAssistant.routes.js"
import { rfComlinkRoutes } from "../rfComlink/rfComlink.routes.js"
import { rfComlinkPreparationRoutes } from "../rfComlink/rfComlinkPreparation.routes.js"

export async function registerApiRoutes(
  fastify: FastifyInstance,
  { config, logger }: { config: AppConfig; logger: Logger },
) {
  await fastify.register(authRoutes, { config })
  await fastify.register(responsesCompatRoutes, { config, logger })
  await fastify.register(taskRoutes, { config, logger })
  await fastify.register(managedRunRoutes, { config, logger })
  await fastify.register(sessionRoutes, { logger })
  await fastify.register(imageRoutes)
  await fastify.register(healthRoutes, { config, logger })
  await fastify.register(remoteToolsRoutes, { config, logger })
  await fastify.register(skillsRoutes)
  await fastify.register(workspaceRoutes, { config })
  await fastify.register(gncConfigRoutes)
  await fastify.register(manifestRoutes, { logger })
  await fastify.register(stageLogsRoutes)
  await fastify.register(cosyVoiceRoutes, { config, logger })
  await fastify.register(funasrRoutes, { config, logger })
  await fastify.register(orbitKeepingRoutes, { config })
  await fastify.register(electricPropulsionRoutes, { config })
  await fastify.register(missionRouterRoutes, { config })
  await fastify.register(missionAssistantRoutes, { config })
  await fastify.register(digitalThreadRoutes, { config })
  await fastify.register(simuCicRoutes, { config })
  await fastify.register(opalisPreparationRoutes)
  await fastify.register(opalisRunRoutes, { config })
  await fastify.register(rfComlinkRoutes)
  await fastify.register(rfComlinkPreparationRoutes)
}
