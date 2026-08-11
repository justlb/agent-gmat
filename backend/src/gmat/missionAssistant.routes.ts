import path from "node:path"

import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import { loadOrCreateDigitalThread, updateDigitalThreadWithLlm } from "../digitalThread/digitalThreadStore.js"
import { appendMissionConversation, appendRunConversation } from "../digitalThread/missionConversationStore.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { analyzeElectricPropulsionRunWithLlm, loadElectricPropulsionRunConversation } from "./electricPropulsionAnalysis.js"
import { discussElectricPropulsionDraft, loadElectricPropulsionDraft } from "./electricPropulsionDraft.js"
import { analyzeOrbitKeepingRunWithLlm, loadOrbitKeepingRunConversation } from "./orbitKeepingAnalysis.js"
import { discussOrbitKeepingDraft, loadOrbitKeepingDraft } from "./orbitKeepingDraft.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { syncDigitalThreadFromGmatDraft } from "../digitalThread/gmatDigitalThreadAdapter.js"

type Intent = "analysis" | "change" | "knowledge" | "advice" | "simu-cic"
type Body = { draftId?: unknown; message?: unknown; runPath?: unknown; workspaceDir?: unknown }

function resolveWorkspaceDir(root: string, requested: unknown) {
  const workspaceDir = typeof requested === "string" && requested.trim() ? path.resolve(requested) : path.resolve(root)
  if (!isPathInside(path.resolve(root), workspaceDir)) throw new Error("workspaceDir must be inside the current user workspace")
  return workspaceDir
}

function resolveRunDir(root: string, requested: unknown) {
  if (typeof requested !== "string" || !requested.trim()) return null
  const runDir = path.resolve(root, requested)
  const normalized = runDir.split(path.sep).join("/")
  if (!isPathInside(path.resolve(root), runDir) || !/\/gmat\/(orbit-keeping|electric-propulsion-transfer)\/[^/]+$/u.test(normalized)) return null
  return { runDir, template: normalized.includes("/orbit-keeping/") ? "orbit-keeping" as const : "electric-propulsion-transfer" as const }
}

function responseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") return (payload as { output_text: string }).output_text.trim()
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const texts: string[] = []
  for (const item of Array.isArray(output) ? output : []) for (const part of Array.isArray(item && typeof item === "object" ? (item as { content?: unknown }).content : undefined) ? (item as { content: unknown[] }).content : []) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") texts.push((part as { text: string }).text)
  return texts.join("\n").trim()
}

async function classify(config: AppConfig, message: string): Promise<Intent> {
  const connection = resolveModelBackend(config, "chatModel")
  const prompt = [
    "Classify one request in a spacecraft mission application.",
    "Return JSON only: {\"intent\":\"analysis\"|\"change\"|\"knowledge\"|\"advice\"|\"simu-cic\"}.",
    "analysis = asks about a saved GMAT run or its results; change = asks to change mission/satellite values or create a new what-if; knowledge = asks a factual/explanatory question; advice = asks what to choose or recommends a trade-off; simu-cic = asks about attitude, nadir, ground stations, Simu-CIC or OPALIS.",
    `Request: ${message}`,
  ].join("\n\n")
  const response = await fetch(`${connection.baseUrl.replace(/\/+$/u, "")}/responses`, { method: "POST", headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: connection.model, input: prompt, max_output_tokens: 120 }), signal: AbortSignal.timeout(30_000) })
  const source = await response.text()
  if (!response.ok) throw new Error(`mission assistant routing failed: HTTP ${response.status}`)
  const parsed = JSON.parse(responseText(JSON.parse(source)).replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "")) as { intent?: unknown }
  if (parsed.intent === "analysis" || parsed.intent === "change" || parsed.intent === "knowledge" || parsed.intent === "advice" || parsed.intent === "simu-cic") return parsed.intent
  throw new Error("mission assistant returned an unknown intent")
}

async function answerFromContext(config: AppConfig, intent: "knowledge" | "advice", message: string, workspaceDir: string) {
  const connection = resolveModelBackend(config, "chatModel")
  const document = await loadOrCreateDigitalThread(workspaceDir)
  const prompt = [
    "You are a spacecraft engineering assistant.",
    intent === "advice" ? "Give a concise, conditional engineering recommendation. Clearly state assumptions and do not invent project values." : "Answer concisely using engineering knowledge. Clearly distinguish general knowledge from project-specific facts.",
    "The selected satellite/digital-thread data below is authoritative for this project. If it lacks a value, say so.",
    `Digital thread: ${JSON.stringify(document)}`,
    `Engineer question: ${message}`,
  ].join("\n\n")
  const response = await fetch(`${connection.baseUrl.replace(/\/+$/u, "")}/responses`, { method: "POST", headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: connection.model, input: prompt, max_output_tokens: 1000 }), signal: AbortSignal.timeout(60_000) })
  const source = await response.text()
  if (!response.ok) throw new Error(`mission assistant response failed: HTTP ${response.status}`)
  const answer = responseText(JSON.parse(source))
  if (!answer) throw new Error("mission assistant returned no answer")
  return answer
}

export async function missionAssistantRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.post<{ Body: Body }>("/api/gmat/assistant", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!message) return reply.status(400).send({ error: "message must be a non-empty string" })
    try {
      const workspaceDir = resolveWorkspaceDir(root, req.body?.workspaceDir)
      const activeRun = resolveRunDir(root, req.body?.runPath)
      const intent = await classify(config, message)
      if (intent === "simu-cic") {
        const result = await updateDigitalThreadWithLlm({ connection: resolveModelBackend(config, "chatModel"), message, workspaceDir })
        const turn = { answer: result.message, askedAt: new Date().toISOString(), channel: "simu-cic" as const, question: message }
        await appendMissionConversation(workspaceDir, turn)
        if (activeRun) await appendRunConversation(activeRun.runDir, turn)
        return reply.send({ answer: result.message, intent, kind: "answer" })
      }
      if (intent === "change") {
        const draftId = typeof req.body?.draftId === "string" ? req.body.draftId : ""
        if (!draftId || !activeRun) return reply.send({ answer: "To change mission values, open or create a GMAT draft first. Existing runs remain immutable; the change will create a new run.", intent, kind: "answer" })
        if (activeRun.template === "orbit-keeping") {
          const existingDraft = await loadOrbitKeepingDraft(workspaceDir, draftId)
          // A revision continues the same engineering discussion. Bring the
          // saved result discussion into the draft before adding the requested
          // change, while the old run itself stays immutable on disk.
          const runConversation = await loadOrbitKeepingRunConversation(activeRun.runDir)
          const draft = await discussOrbitKeepingDraft({ connection: resolveModelBackend(config, "chatModel"), draft: {
            ...existingDraft,
            conversation: [...existingDraft.conversation, ...runConversation.map(turn => ({ assistant: turn.answer, user: turn.question }))]
              .filter((turn, index, turns) => turns.findIndex(candidate => candidate.user === turn.user && candidate.assistant === turn.assistant) === index),
          }, message, workspaceDir })
          await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
          await appendMissionConversation(workspaceDir, { answer: draft.assistantMessage ?? "Mission draft updated.", askedAt: draft.updatedAt, channel: "gmat-draft", question: message })
          return reply.send({ draft, intent, kind: "draft" })
        }
        const existingDraft = await loadElectricPropulsionDraft(workspaceDir, draftId)
        const runConversation = await loadElectricPropulsionRunConversation(activeRun.runDir)
        const draft = await discussElectricPropulsionDraft({ connection: resolveModelBackend(config, "chatModel"), draft: {
          ...existingDraft,
          conversation: [...existingDraft.conversation, ...runConversation.map(turn => ({ assistant: turn.answer, user: turn.question }))]
            .filter((turn, index, turns) => turns.findIndex(candidate => candidate.user === turn.user && candidate.assistant === turn.assistant) === index),
        }, message, workspaceDir })
        await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
        await appendMissionConversation(workspaceDir, { answer: draft.assistantMessage ?? "Mission draft updated.", askedAt: draft.updatedAt, channel: "gmat-draft", question: message })
        return reply.send({ draft, intent, kind: "draft" })
      }
      if (intent === "analysis") {
        if (!activeRun) return reply.send({ answer: "Select a GMAT run before asking for an analysis of saved results.", intent, kind: "answer" })
        const draftId = typeof req.body?.draftId === "string" ? req.body.draftId : ""
        if (activeRun.template === "orbit-keeping") {
          const draft = draftId ? await loadOrbitKeepingDraft(workspaceDir, draftId) : null
          const result = await analyzeOrbitKeepingRunWithLlm({ connection: resolveModelBackend(config, "chatModel"), question: message, relatedRuns: draft?.runs ?? [], runDir: activeRun.runDir })
          return reply.send({ answer: result.answer, intent, kind: "analysis" })
        }
        const draft = draftId ? await loadElectricPropulsionDraft(workspaceDir, draftId) : null
        const result = await analyzeElectricPropulsionRunWithLlm({ connection: resolveModelBackend(config, "chatModel"), question: message, relatedRuns: draft?.runs ?? [], runDir: activeRun.runDir })
        return reply.send({ answer: result.answer, intent, kind: "analysis" })
      }
      const answer = await answerFromContext(config, intent, message, workspaceDir)
      if (activeRun) await appendRunConversation(activeRun.runDir, { answer, askedAt: new Date().toISOString(), channel: "gmat-draft", question: message })
      return reply.send({ answer, intent, kind: "answer" })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "mission assistant request failed") }) }
  })
}
