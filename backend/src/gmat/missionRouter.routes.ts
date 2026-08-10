import type { FastifyInstance } from "fastify"
import path from "node:path"

import type { AppConfig } from "../config.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { adaptDigitalThreadToGmat, syncDigitalThreadFromGmatDraft } from "../digitalThread/gmatDigitalThreadAdapter.js"
import { getSatelliteDefinition } from "../digitalThread/satelliteLibrary.js"
import { loadOrCreateDigitalThread } from "../digitalThread/digitalThreadStore.js"
import { createElectricPropulsionDraft, discussElectricPropulsionDraft } from "./electricPropulsionDraft.js"
import { createOrbitKeepingDraft, discussOrbitKeepingDraft } from "./orbitKeepingDraft.js"

type MissionTemplate = "orbit-keeping" | "electric-propulsion-transfer"
type RoutingDecision = { target: "clarify" | "general" | MissionTemplate; message: string }

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
  fastify.post<{ Body: { message?: unknown; workspaceDir?: unknown } }>("/api/gmat/route", async (req, reply) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!message) return reply.status(400).send({ error: "message must be a non-empty string" })
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const workspaceDir = typeof req.body?.workspaceDir === "string" && req.body.workspaceDir.trim() ? path.resolve(req.body.workspaceDir) : root
    if (!isPathInside(path.resolve(root), workspaceDir)) return reply.status(400).send({ error: "workspaceDir must be inside the current user workspace" })
    try {
      const decision = await routeMissionMessage(config, message)
      if (decision.target === "general" || decision.target === "clarify") return reply.send({ kind: decision.target, message: decision.message })
      const currentDigitalThread = await loadOrCreateDigitalThread(workspaceDir)
      const satelliteSelection = currentDigitalThread.digital_thread.satellite_definition as { id?: unknown; version?: unknown } | null
      if (!satelliteSelection || typeof satelliteSelection.id !== "string") {
        return reply.send({ kind: "clarify", message: "Select a satellite version in Satellite Library before defining a GMAT mission." })
      }
      const selectedSatellite = await getSatelliteDefinition(satelliteSelection.id, typeof satelliteSelection.version === "string" ? satelliteSelection.version : undefined)
      if (!selectedSatellite.mission_templates.includes(decision.target)) {
        return reply.send({
          kind: "clarify",
          message: `The selected satellite (${selectedSatellite.name}) is not compatible with the ${decision.target} GMAT template. Select a satellite with the required propulsion system or describe a compatible mission.`,
        })
      }
      const adapted = adaptDigitalThreadToGmat(currentDigitalThread, decision.target)
      const propulsionGuard = adapted.guards.find(guard => guard.code === "incompatible_propulsion")
      if (propulsionGuard) return reply.send({ kind: "clarify", message: `${propulsionGuard.message} Select a compatible satellite before continuing.` })
      if (decision.target === "orbit-keeping") {
        const draft = await createOrbitKeepingDraft(workspaceDir, adapted.values, adapted.requiredDraftPaths)
        const updatedDraft = await discussOrbitKeepingDraft({ connection: resolveModelBackend(config, "chatModel"), draft, message, workspaceDir })
        await syncDigitalThreadFromGmatDraft(workspaceDir, updatedDraft)
        return reply.send({ adapter: adapted, digitalThread: await loadOrCreateDigitalThread(workspaceDir), draft: updatedDraft, kind: "mission", message: decision.message, template: decision.target })
      }
      const draft = await createElectricPropulsionDraft(workspaceDir, adapted.values, adapted.requiredDraftPaths)
      const updatedDraft = await discussElectricPropulsionDraft({ connection: resolveModelBackend(config, "chatModel"), draft, message, workspaceDir })
      await syncDigitalThreadFromGmatDraft(workspaceDir, updatedDraft)
      return reply.send({ adapter: adapted, digitalThread: await loadOrCreateDigitalThread(workspaceDir), draft: updatedDraft, kind: "mission", message: decision.message, template: decision.target })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to route GMAT mission") })
    }
  })
}
