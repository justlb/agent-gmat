import path from "node:path"

import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { adaptDigitalThreadToGmat, syncDigitalThreadFromGmatDraft } from "../digitalThread/gmatDigitalThreadAdapter.js"
import { draftDigitalThreadWorkspaceDir, isMissionRunWorkspace, loadOrCreateDigitalThread } from "../digitalThread/digitalThreadStore.js"
import { appendMissionConversation } from "../digitalThread/missionConversationStore.js"
import { appendChemicalHohmannDraftConversation, confirmChemicalHohmannDraft, createChemicalHohmannDraft, discussChemicalHohmannDraft, loadChemicalHohmannDraft } from "./chemicalHohmannDraft.js"
import { generateChemicalHohmannMission } from "./chemicalHohmann.service.js"

type WorkspaceBody = { workspaceDir?: unknown }
function resolveWorkspace(root: string, candidate: unknown) {
  if (typeof candidate !== "string" || !candidate.trim()) throw new Error("workspaceDir is required")
  const workspace = path.resolve(candidate)
  if (!isPathInside(path.resolve(root), workspace) || !isMissionRunWorkspace(workspace)) throw new Error("select a dated mission run workspace first")
  return workspace
}

/** Deterministic API boundary for the chemical Hohmann GMAT template. */
export async function chemicalHohmannRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.post<{ Body: WorkspaceBody }>("/api/gmat/chemical-hohmann-transfer/drafts", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const adapted = adaptDigitalThreadToGmat(await loadOrCreateDigitalThread(workspaceDir), "chemical-hohmann-transfer")
      const propulsionGuard = adapted.guards.find(guard => guard.code === "incompatible_propulsion")
      if (propulsionGuard) throw new Error(propulsionGuard.message)
      const draft = await createChemicalHohmannDraft(workspaceDir, adapted.values, adapted.requiredDraftPaths)
      await syncDigitalThreadFromGmatDraft(draftDigitalThreadWorkspaceDir(workspaceDir, "chemical-hohmann-transfer", draft.draftId), draft)
      return reply.send(draft)
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to create chemical Hohmann draft") }) }
  })

  fastify.get<{ Params: { draftId: string }; Querystring: { workspaceDir?: string } }>("/api/gmat/chemical-hohmann-transfer/drafts/:draftId", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try { return reply.send(await loadChemicalHohmannDraft(resolveWorkspace(root, req.query.workspaceDir), req.params.draftId)) } catch (error) { return reply.status(404).send({ error: getErrorMessage(error, "chemical Hohmann draft not found") }) }
  })

  fastify.post<{ Params: { draftId: string }; Body: WorkspaceBody & { message?: unknown } }>("/api/gmat/chemical-hohmann-transfer/drafts/:draftId/messages", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!message) return reply.status(400).send({ error: "message must be a non-empty string" })
    let workspaceDir = ""
    try {
      workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const draft = await discussChemicalHohmannDraft({ connection: resolveModelBackend(config, "chatModel"), draft: await loadChemicalHohmannDraft(workspaceDir, req.params.draftId), message, workspaceDir })
      await syncDigitalThreadFromGmatDraft(draftDigitalThreadWorkspaceDir(workspaceDir, "chemical-hohmann-transfer", draft.draftId), draft)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      await appendMissionConversation(workspaceDir, { answer: draft.assistantMessage ?? "Mission draft updated.", askedAt: draft.updatedAt, channel: "gmat-draft", question: message })
      return reply.send(draft)
    } catch (error) {
      const errorMessage = getErrorMessage(error, "failed to update chemical Hohmann GMAT draft")
      if (workspaceDir) await appendChemicalHohmannDraftConversation(workspaceDir, req.params.draftId, { assistant: `Mission configuration error: ${errorMessage}`, user: message }).catch(() => undefined)
      return reply.status(422).send({ error: errorMessage })
    }
  })

  fastify.post<{ Params: { draftId: string }; Body: WorkspaceBody }>("/api/gmat/chemical-hohmann-transfer/drafts/:draftId/confirm", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const draft = await confirmChemicalHohmannDraft(workspaceDir, req.params.draftId)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      return reply.send(draft)
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to confirm chemical Hohmann draft") }) }
  })

  fastify.post<{ Params: { draftId: string }; Body: WorkspaceBody }>("/api/gmat/chemical-hohmann-transfer/drafts/:draftId/execute", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    try {
      const workspaceDir = resolveWorkspace(root, req.body?.workspaceDir)
      const draft = await confirmChemicalHohmannDraft(workspaceDir, req.params.draftId)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      const result = await generateChemicalHohmannMission({ draft, workspaceDir, execution: config.tools.gmat.bin ? { bin: config.tools.gmat.bin, timeoutMs: config.tools.gmat.timeoutMs } : undefined })
      return reply.send({ ...result, runPath: path.relative(path.resolve(root), result.runDir) })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "failed to execute chemical Hohmann GMAT draft") }) }
  })
}
