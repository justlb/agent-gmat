import type { FastifyInstance } from "fastify"
import path from "node:path"

import type { AppConfig } from "../config.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { adaptDigitalThreadToGmat, syncDigitalThreadFromGmatDraft } from "../digitalThread/gmatDigitalThreadAdapter.js"
import { getSatelliteDefinition } from "../digitalThread/satelliteLibrary.js"
import { draftDigitalThreadWorkspaceDir, loadOrCreateDigitalThread, saveDigitalThread, updateDigitalThreadWithLlm } from "../digitalThread/digitalThreadStore.js"
import { appendElectricPropulsionDraftConversation, createElectricPropulsionDraft, discussElectricPropulsionDraft } from "./electricPropulsionDraft.js"
import { appendOrbitKeepingDraftConversation, createOrbitKeepingDraft, discussOrbitKeepingDraft } from "./orbitKeepingDraft.js"
import { appendMissionConversation, appendRunConversation } from "../digitalThread/missionConversationStore.js"

type MissionTemplate = "orbit-keeping" | "electric-propulsion-transfer"
type RoutingDecision = { target: "clarify" | "general" | MissionTemplate; message: string }

function isSimuCicRequest(message: string) {
  return /simu\s*-?\s*cic|ground\s+(?:station|sat+ion)s?|station\s+au\s+sol|attitude|point(?:age|ing)|nadir/iu.test(message)
}

function resolveActiveGmatRunDir(root: string, requested: unknown) {
  if (typeof requested !== "string" || !requested.trim()) return null
  const runDir = path.resolve(root, requested)
  const normalized = runDir.split(path.sep).join("/")
  return isPathInside(path.resolve(root), runDir) && /\/gmat\/(?:orbit-keeping|electric-propulsion-transfer)\/[^/]+$/u.test(normalized) ? runDir : null
}

async function appendRequestedDraftTurn(workspaceDir: string, draftId: string, template: unknown, assistant: string, user: string) {
  if (!draftId) return undefined
  if (template === "orbit-keeping") return appendOrbitKeepingDraftConversation(workspaceDir, draftId, { assistant, user })
  if (template === "electric-propulsion-transfer") return appendElectricPropulsionDraftConversation(workspaceDir, draftId, { assistant, user })
  return undefined
}

function responseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") {
    return (payload as { output_text: string }).output_text.trim()
  }
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const text: string[] = []
  for (const item of Array.isArray(output) ? output : []) {
    const content = item && typeof item === "object" ? (item as { content?: unknown }).content : undefined
    for (const part of Array.isArray(content) ? content : []) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") text.push((part as { text: string }).text)
    }
  }
  return text.join("\n").trim()
}

export function parseMissionRoutingDecision(source: string): RoutingDecision {
  const normalized = source.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "")
  let parsed: unknown
  try { parsed = JSON.parse(normalized) } catch { throw new Error("LLM routing response is not valid JSON") }
  if (!parsed || typeof parsed !== "object") throw new Error("LLM routing response is invalid")
  const candidate = parsed as { target?: unknown; message?: unknown }
  if (candidate.target !== "orbit-keeping" && candidate.target !== "electric-propulsion-transfer" && candidate.target !== "clarify" && candidate.target !== "general") {
    throw new Error("LLM routing response has an unknown target")
  }
  if (typeof candidate.message !== "string" || !candidate.message.trim()) throw new Error("LLM routing response has no message")
  return { target: candidate.target, message: candidate.message.trim() }
}

async function routeMissionMessage(config: AppConfig, message: string) {
  const connection = resolveModelBackend(config, "chatModel")
  const prompt = [
    "You route a user message in a spacecraft engineering application.",
    "Return JSON only: {\"target\": \"orbit-keeping\"|\"electric-propulsion-transfer\"|\"clarify\"|\"general\", \"message\": \"string\"}.",
    "Choose orbit-keeping only when the user clearly requests station keeping, reboost, drag decay maintenance, or an orbit-maintenance GMAT mission.",
    "Choose electric-propulsion-transfer only when the user clearly requests an electric/thrust transfer or finite electric burn GMAT mission.",
    "Choose clarify when the user appears to want a GMAT mission but its mission family is ambiguous. In message, ask one short question that distinguishes orbit keeping from electric propulsion. Do not invent parameters.",
    "Choose general for all non-GMAT mission requests. In message, briefly state that it is a general request.",
    `User message: ${message}`,
  ].join("\n\n")
  const response = await fetch(`${connection.baseUrl.replace(/\/+$/u, "")}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: connection.model, input: prompt, max_output_tokens: 220 }),
    signal: AbortSignal.timeout(30_000),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`LLM mission routing failed: HTTP ${response.status}`)
  let payload: unknown
  try { payload = JSON.parse(body) } catch { throw new Error("LLM mission routing response is invalid JSON") }
  return parseMissionRoutingDecision(responseText(payload))
}

/** One entry point for mission chat: route first, then use the selected draft workflow. */
export async function missionRouterRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.post<{ Body: { draftId?: unknown; message?: unknown; runPath?: unknown; template?: unknown; workspaceDir?: unknown } }>("/api/gmat/route", async (req, reply) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!message) return reply.status(400).send({ error: "message must be a non-empty string" })
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const workspaceDir = typeof req.body?.workspaceDir === "string" && req.body.workspaceDir.trim() ? path.resolve(req.body.workspaceDir) : root
    if (!isPathInside(path.resolve(root), workspaceDir)) return reply.status(400).send({ error: "workspaceDir must be inside the current user workspace" })
    const draftId = typeof req.body?.draftId === "string" ? req.body.draftId : ""
    const template = req.body?.template
    const draftThreadWorkspace = draftId && (template === "orbit-keeping" || template === "electric-propulsion-transfer")
      ? draftDigitalThreadWorkspaceDir(workspaceDir, template, draftId)
      : workspaceDir
    const activeRunDir = resolveActiveGmatRunDir(root, req.body?.runPath)
    try {
      const decision = await routeMissionMessage(config, message)
      if (decision.target === "general" && isSimuCicRequest(message)) {
        const result = await updateDigitalThreadWithLlm({ connection: resolveModelBackend(config, "chatModel"), message, workspaceDir: draftThreadWorkspace })
        const turn = { answer: result.message, askedAt: new Date().toISOString(), channel: "simu-cic" as const, question: message }
        await appendMissionConversation(workspaceDir, turn)
        if (activeRunDir) await appendRunConversation(activeRunDir, turn)
        const draft = await appendRequestedDraftTurn(workspaceDir, draftId, template, result.message || "Simu-CIC configuration updated.", message)
        return reply.send({ digitalThread: result.document, draft, kind: "simu-cic", message: result.message || "Simu-CIC configuration updated." })
      }
      if (decision.target === "general") return reply.send({ kind: decision.target, message: decision.message })
      if (decision.target === "clarify") {
        const turn = { answer: decision.message, askedAt: new Date().toISOString(), channel: "gmat-draft" as const, question: message }
        await appendMissionConversation(workspaceDir, turn)
        if (activeRunDir) await appendRunConversation(activeRunDir, turn)
        const draft = await appendRequestedDraftTurn(workspaceDir, draftId, template, decision.message, message)
        return reply.send({ draft, kind: "clarify", message: decision.message })
      }
      let currentDigitalThread = await loadOrCreateDigitalThread(draftThreadWorkspace)
      let satelliteSelection = currentDigitalThread.digital_thread.satellite_definition as { id?: unknown; version?: unknown } | null
      // Satellite Library writes to the planning workspace. A draft owns a
      // private digital thread, so copy a newly selected physical definition
      // into that draft without replacing the mission data it already holds.
      if ((!satelliteSelection || typeof satelliteSelection.id !== "string") && draftThreadWorkspace !== workspaceDir) {
        const planningDigitalThread = await loadOrCreateDigitalThread(workspaceDir)
        const planningSelection = planningDigitalThread.digital_thread.satellite_definition as { id?: unknown; version?: unknown } | null
        if (planningSelection && typeof planningSelection.id === "string") {
          currentDigitalThread.satellite = JSON.parse(JSON.stringify(planningDigitalThread.satellite))
          currentDigitalThread.digital_thread.satellite_definition = JSON.parse(JSON.stringify(planningSelection))
          const provenance = currentDigitalThread.provenance.values && typeof currentDigitalThread.provenance.values === "object" && !Array.isArray(currentDigitalThread.provenance.values)
            ? currentDigitalThread.provenance.values as Record<string, unknown>
            : {}
          provenance.satellite = { copied_from: "planning_run", source: "satellite_library", synchronized_at: new Date().toISOString() }
          currentDigitalThread.provenance.values = provenance as typeof currentDigitalThread.provenance.values
          await saveDigitalThread(draftThreadWorkspace, currentDigitalThread)
          satelliteSelection = planningSelection
        }
      }
      if (!satelliteSelection || typeof satelliteSelection.id !== "string") {
        const clarification = "Select a satellite version in Satellite Library before defining a GMAT mission."
        // A mission discussion needs a visible, persistent GMAT draft even
        // before its satellite is selected.  It owns the empty satellite.json
        // that will later be populated by Satellite Library.
        const draft = decision.target === "orbit-keeping"
          ? await createOrbitKeepingDraft(workspaceDir)
          : await createElectricPropulsionDraft(workspaceDir)
        const savedDraft = decision.target === "orbit-keeping"
          ? await appendOrbitKeepingDraftConversation(workspaceDir, draft.draftId, { assistant: clarification, user: message })
          : await appendElectricPropulsionDraftConversation(workspaceDir, draft.draftId, { assistant: clarification, user: message })
        await appendMissionConversation(workspaceDir, { answer: clarification, askedAt: savedDraft.updatedAt, channel: "gmat-draft", question: message })
        return reply.send({ draft: savedDraft, kind: "mission", message: clarification, template: decision.target })
      }
      const selectedSatellite = await getSatelliteDefinition(satelliteSelection.id, typeof satelliteSelection.version === "string" ? satelliteSelection.version : undefined)
      if (!selectedSatellite.mission_templates.includes(decision.target)) {
        const clarification = `The selected satellite (${selectedSatellite.name}) is not compatible with the ${decision.target} GMAT template. Select a satellite with the required propulsion system or describe a compatible mission.`
        const draft = await appendRequestedDraftTurn(workspaceDir, draftId, template, clarification, message)
        return reply.send({ draft, kind: "clarify", message: clarification })
      }
        const adapted = adaptDigitalThreadToGmat(currentDigitalThread, decision.target)
      const propulsionGuard = adapted.guards.find(guard => guard.code === "incompatible_propulsion")
      if (propulsionGuard) {
        const clarification = `${propulsionGuard.message} Select a compatible satellite before continuing.`
        const draft = await appendRequestedDraftTurn(workspaceDir, draftId, template, clarification, message)
        return reply.send({ draft, kind: "clarify", message: clarification })
      }
        if (decision.target === "orbit-keeping") {
          const draft = await createOrbitKeepingDraft(workspaceDir, adapted.values, adapted.requiredDraftPaths)
          const updatedDraft = await discussOrbitKeepingDraft({ connection: resolveModelBackend(config, "chatModel"), draft, message, workspaceDir })
          await appendMissionConversation(workspaceDir, { answer: updatedDraft.assistantMessage ?? "Mission draft updated.", askedAt: updatedDraft.updatedAt, channel: "gmat-draft", question: message })
          const createdDraftThreadWorkspace = draftDigitalThreadWorkspaceDir(workspaceDir, "orbit-keeping", updatedDraft.draftId)
          await syncDigitalThreadFromGmatDraft(createdDraftThreadWorkspace, updatedDraft)
          await syncDigitalThreadFromGmatDraft(workspaceDir, updatedDraft)
        return reply.send({ adapter: adapted, digitalThread: await loadOrCreateDigitalThread(draftDigitalThreadWorkspaceDir(workspaceDir, "orbit-keeping", updatedDraft.draftId)), draft: updatedDraft, kind: "mission", message: decision.message, template: decision.target })
      }
      const draft = await createElectricPropulsionDraft(workspaceDir, adapted.values, adapted.requiredDraftPaths)
      const updatedDraft = await discussElectricPropulsionDraft({ connection: resolveModelBackend(config, "chatModel"), draft, message, workspaceDir })
      await appendMissionConversation(workspaceDir, { answer: updatedDraft.assistantMessage ?? "Mission draft updated.", askedAt: updatedDraft.updatedAt, channel: "gmat-draft", question: message })
      const createdDraftThreadWorkspace = draftDigitalThreadWorkspaceDir(workspaceDir, "electric-propulsion-transfer", updatedDraft.draftId)
      await syncDigitalThreadFromGmatDraft(createdDraftThreadWorkspace, updatedDraft)
      await syncDigitalThreadFromGmatDraft(workspaceDir, updatedDraft)
      return reply.send({ adapter: adapted, digitalThread: await loadOrCreateDigitalThread(createdDraftThreadWorkspace), draft: updatedDraft, kind: "mission", message: decision.message, template: decision.target })
    } catch (error) {
      const errorMessage = getErrorMessage(error, "failed to route GMAT mission")
      const turn = { answer: `Mission configuration error: ${errorMessage}`, askedAt: new Date().toISOString(), channel: "gmat-draft" as const, question: message }
      await appendMissionConversation(workspaceDir, turn).catch(() => undefined)
      if (activeRunDir) await appendRunConversation(activeRunDir, turn).catch(() => undefined)
      await appendRequestedDraftTurn(workspaceDir, draftId, template, turn.answer, message).catch(() => undefined)
      return reply.status(422).send({ error: errorMessage })
    }
  })
}
