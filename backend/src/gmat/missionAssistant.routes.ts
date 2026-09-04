import path from "node:path"
import fs from "node:fs/promises"

import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import { createEphemeralDigitalThread, isMissionRunWorkspace, loadOrCreateDigitalThread, syncSimuCicRequestToRunSnapshot, updateDigitalThreadWithLlm } from "../digitalThread/digitalThreadStore.js"
import { appendMissionConversation, appendRunConversation } from "../digitalThread/missionConversationStore.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage } from "../shared/index.js"
import { resolveMissionRun } from "../runs/runWorkspace.js"
import { analyzeElectricPropulsionRunWithLlm, loadElectricPropulsionRunConversation } from "./electricPropulsionAnalysis.js"
import { discussElectricPropulsionDraft, loadElectricPropulsionDraft } from "./electricPropulsionDraft.js"
import { analyzeChemicalHohmannRunWithLlm } from "./chemicalHohmannAnalysis.js"
import { discussChemicalHohmannDraft, loadChemicalHohmannDraft } from "./chemicalHohmannDraft.js"
import { discussChemical3dDraft, loadChemical3dDraft } from "./chemical3dTransfer.js"
import { analyzeOrbitKeepingRunWithLlm, loadOrbitKeepingRunConversation } from "./orbitKeepingAnalysis.js"
import { discussOrbitKeepingDraft, loadOrbitKeepingDraft } from "./orbitKeepingDraft.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { syncDigitalThreadFromGmatDraft } from "../digitalThread/gmatDigitalThreadAdapter.js"
import { resolveMissionWorkspace } from "./missionWorkspace.js"
import { analyzeRFComlinkRunWithLlm } from "../rfComlink/rfComlinkAnalysis.js"
import { loadRFComlinkResultSummary } from "../rfComlink/rfComlinkResults.js"
import { appendMissionTemplateDraftConversation } from "./missionTemplateRuntime.js"
import { isGmatTemplateId } from "./templateRegistry.js"
import { analyzeRunWithAnalysisContext } from "../analysis/runAnalysisLlm.js"

type Intent = "analysis" | "change" | "knowledge" | "advice" | "simu-cic"
type Body = { allowMissionChanges?: unknown; draftId?: unknown; message?: unknown; runPath?: unknown; workspaceDir?: unknown }

function resolveWorkspaceDir(root: string, requested: unknown) {
  return resolveMissionWorkspace(root, requested)
}

async function resolveRunDir(root: string, requested: unknown) {
  const resolvedRun = resolveMissionRun(root, requested)
  if (!resolvedRun) return null
  const runDir = resolvedRun.runDir
  const normalized = runDir.split(path.sep).join("/")
  if (normalized.includes("/orbit-keeping/")) return { runDir, template: "orbit-keeping" as const }
  if (normalized.includes("/electric-propulsion-transfer/")) return { runDir, template: "electric-propulsion-transfer" as const }
  const manifest = JSON.parse(await fs.readFile(path.join(runDir, "run_manifest.json"), "utf8").catch(() => "{}")) as { templateId?: unknown }
  if (manifest.templateId !== "orbit-keeping" && manifest.templateId !== "electric-propulsion-transfer" && manifest.templateId !== "chemical-hohmann-transfer" && manifest.templateId !== "chemical-3d-transfer") return null
  return { runDir, template: manifest.templateId }
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
    "analysis = asks about a saved GMAT, Simu-CIC, or OPALIS run or its results; change = asks to change mission/satellite values or create a new what-if; knowledge = asks a factual/explanatory question; advice = asks what to choose or recommends a trade-off; simu-cic = asks to configure attitude, nadir pointing, or ground stations. Questions about OPALIS results are analysis, not simu-cic.",
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
  // A generic engineering question before a mission exists must not create a
  // shared satellite.json at the user-workspace root.
  const document = isMissionRunWorkspace(workspaceDir)
    ? await loadOrCreateDigitalThread(workspaceDir)
    : await createEphemeralDigitalThread()
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
  // Results discussion is always read-only with respect to mission inputs and execution.
  // It bypasses the intent router so every question uses the selected run, for every template.
  fastify.post<{ Body: { runPath?: unknown; message?: unknown } }>("/api/runs/analysis", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const run = resolveMissionRun(root, req.body?.runPath)
    if (!run) return reply.status(400).send({ error: "invalid GMAT run path" })
    const question = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!question || question.length > 12000) return reply.status(400).send({ error: "message must contain between 1 and 12000 characters" })
    try {
      await fs.access(path.join(run.runDir, "run_manifest.json"))
      return await analyzeRunWithAnalysisContext({ connection: resolveModelBackend(config, "chatModel"), question, runDir: run.runDir, refreshContext: true })
    } catch (error) { return reply.status(422).send({ error: getErrorMessage(error, "run analysis failed") }) }
  })
  fastify.post<{ Body: Body }>("/api/gmat/assistant", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!message) return reply.status(400).send({ error: "message must be a non-empty string" })
    try {
      const workspaceDir = resolveWorkspaceDir(root, req.body?.workspaceDir)
      const activeRun = await resolveRunDir(root, req.body?.runPath)
      const intent = await classify(config, message)
      if (intent === "simu-cic") {
        if (activeRun && req.body?.allowMissionChanges !== true) {
          return reply.send({ answer: "This run's Simu-CIC configuration is immutable. Select Change mission values before creating a new variation; OPALIS and RF-COMLINK remain available for the saved CIC output.", intent, kind: "answer" })
        }
        if (!isMissionRunWorkspace(workspaceDir)) {
          return reply.status(409).send({ error: "start a dated mission discussion before configuring Simu-CIC" })
        }
        const result = await updateDigitalThreadWithLlm({ connection: resolveModelBackend(config, "chatModel"), message, workspaceDir })
        const turn = { answer: result.message, askedAt: new Date().toISOString(), channel: "simu-cic" as const, question: message }
        await appendMissionConversation(workspaceDir, turn)
        if (activeRun) await appendRunConversation(activeRun.runDir, turn)
        if (activeRun) await syncSimuCicRequestToRunSnapshot(activeRun.runDir, result.document)
        return reply.send({ answer: result.message, intent, kind: "answer" })
      }
      if (intent === "change") {
        const draftId = typeof req.body?.draftId === "string" ? req.body.draftId : ""
        if (!draftId || !activeRun) return reply.send({ answer: "To change mission values, open or create a GMAT draft first. Existing runs remain immutable; the change will create a new run.", intent, kind: "answer" })
        if (req.body?.allowMissionChanges !== true) {
          return reply.send({ answer: "This run is immutable. Select Change mission values before requesting a new trajectory or satellite variation; OPALIS and RF-COMLINK remain available for this saved run.", intent, kind: "answer" })
        }
        if (activeRun.template === "chemical-3d-transfer") {
          const existingDraft = await loadChemical3dDraft(workspaceDir, draftId)
          const draft = await discussChemical3dDraft({ connection: resolveModelBackend(config, "chatModel"), draft: existingDraft, message, workspaceDir })
          await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
          await appendMissionConversation(workspaceDir, { answer: draft.assistantMessage ?? "Mission draft updated.", askedAt: draft.updatedAt, channel: "gmat-draft", question: message })
          return reply.send({ draft, intent, kind: "draft" })
        }
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
        if (activeRun.template === "chemical-hohmann-transfer") {
          const existingDraft = await loadChemicalHohmannDraft(workspaceDir, draftId)
          const draft = await discussChemicalHohmannDraft({ connection: resolveModelBackend(config, "chatModel"), draft: existingDraft, message, workspaceDir })
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
        if (await loadRFComlinkResultSummary(activeRun.runDir)) {
          const result = await analyzeRFComlinkRunWithLlm({ connection: resolveModelBackend(config, "chatModel"), question: message, runDir: activeRun.runDir })
          return reply.send({ answer: result.answer, intent, kind: "analysis" })
        }
        if (activeRun.template === "chemical-hohmann-transfer") {
          const draft = draftId ? await loadChemicalHohmannDraft(workspaceDir, draftId) : null
          const result = await analyzeChemicalHohmannRunWithLlm({ connection: resolveModelBackend(config, "chatModel"), question: message, relatedRuns: draft?.runs ?? [], runDir: activeRun.runDir })
          return reply.send({ answer: result.answer, intent, kind: "analysis" })
        }
        if (activeRun.template === "orbit-keeping") {
          const draft = draftId ? await loadOrbitKeepingDraft(workspaceDir, draftId) : null
          const result = await analyzeOrbitKeepingRunWithLlm({ connection: resolveModelBackend(config, "chatModel"), question: message, relatedRuns: draft?.runs ?? [], runDir: activeRun.runDir })
          return reply.send({ answer: result.answer, intent, kind: "analysis" })
        }
        if (activeRun.template === "electric-propulsion-transfer") {
          const draft = draftId ? await loadElectricPropulsionDraft(workspaceDir, draftId) : null
          const result = await analyzeElectricPropulsionRunWithLlm({ connection: resolveModelBackend(config, "chatModel"), question: message, relatedRuns: draft?.runs ?? [], runDir: activeRun.runDir })
          return reply.send({ answer: result.answer, intent, kind: "analysis" })
        }
        const result = await analyzeRunWithAnalysisContext({ connection: resolveModelBackend(config, "chatModel"), question: message, runDir: activeRun.runDir })
        return reply.send({ answer: result.answer, intent, kind: "analysis" })
      }
      const answer = await answerFromContext(config, intent, message, workspaceDir)
      if (activeRun) await appendRunConversation(activeRun.runDir, { answer, askedAt: new Date().toISOString(), channel: "gmat-draft", question: message })
      return reply.send({ answer, intent, kind: "answer" })
    } catch (error) {
      const errorMessage = getErrorMessage(error, "mission assistant request failed")
      const answer = `Mission assistant error: ${errorMessage}`
      const workspaceDir = (() => { try { return resolveWorkspaceDir(root, req.body?.workspaceDir) } catch { return null } })()
      const activeRun = await resolveRunDir(root, req.body?.runPath)
      const draftId = typeof req.body?.draftId === "string" ? req.body.draftId : ""
      if (workspaceDir && activeRun) {
        await appendRunConversation(activeRun.runDir, { answer, askedAt: new Date().toISOString(), channel: "gmat-draft", question: message }).catch(() => undefined)
        if (draftId && isGmatTemplateId(activeRun.template)) await appendMissionTemplateDraftConversation(activeRun.template, workspaceDir, draftId, { assistant: answer, user: message }).catch(() => undefined)
      }
      return reply.status(422).send({ error: errorMessage })
    }
  })
}
