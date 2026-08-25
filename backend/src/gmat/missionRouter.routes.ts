import type { FastifyInstance } from "fastify"
import path from "node:path"

import type { AppConfig } from "../config.js"
import { resolveModelBackend } from "../modelBackends/modelBackends.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { adaptDigitalThreadToGmat, syncDigitalThreadFromGmatDraft } from "../digitalThread/gmatDigitalThreadAdapter.js"
import { getSatelliteDefinition } from "../digitalThread/satelliteLibrary.js"
import { SATELLITE_RUN_OVERRIDE_PATHS, applyExplicitSimuCicConfiguration, draftDigitalThreadWorkspaceDir, isMissionRunWorkspace, loadOrCreateDigitalThread, saveDigitalThread, syncSimuCicRequestToRunSnapshot, updateDigitalThreadWithLlm } from "../digitalThread/digitalThreadStore.js"
import { PREDEFINED_GROUND_STATIONS } from "../opalis/groundStationCatalog.js"
import { appendMissionConversation, appendRunConversation } from "../digitalThread/missionConversationStore.js"
import { appendMissionTemplateDraftConversation, missionTemplateRuntime } from "./missionTemplateRuntime.js"
import { allGmatTemplateDefinitions, gmatTemplateDefinition, isGmatTemplateId, type GmatTemplateId } from "./templateRegistry.js"
import { resolveMissionRun } from "../runs/runWorkspace.js"

type RoutingDecision = { target: "clarify" | "general" | GmatTemplateId; message: string }

function isSimuCicRequest(message: string) {
  const normalized = message.toLocaleLowerCase()
  return /simu\s*-?\s*cic|ground\s+(?:station|sat+ion)s?|station\s+au\s+sol|attitude|point(?:age|ing)|nadir|\b(?:follow|track|suiv\w*)\b/iu.test(message)
    || PREDEFINED_GROUND_STATIONS.some(station => normalized.includes(station.id.toLocaleLowerCase()) || normalized.includes(station.name.toLocaleLowerCase()))
}

/** A mixed turn such as "electric transfer ... and follow Kourou" must not be
 * diverted into the Simu-CIC-only route before GMAT values are parsed. */
function hasGmatMissionRequest(message: string) {
  return /electric\s*(?:propulsion|transfer|thrust)|chemical\s*(?:transfer|burn)|hohmann|circulari[sz](?:e|ation)|orbit|reboost|station\s*keeping|initial\s*(?:altitude|semi|epoch)|\becc(?:entricity)?\b|\binc(?:lination)?\b|burn\s*duration|thrust\s*duration/iu.test(message)
}

/** These requests affect the selected vehicle for this discussion, rather
 * than the mission orbit. They are restricted to the explicit allow-list in
 * digitalThreadStore and never write the satellite-library JSON. */
function isSatelliteRunOverrideRequest(message: string) {
  return /\b(?:dry\s*mass|masse\s+s[eè]che|drag\s*(?:area|coefficient)|surface\s+de\s+tra[iî]n[eé]e|coefficient\s+de\s+tra[iî]n[eé]e|specific\s+impulse|impulsion\s+sp[eé]cifique|electric\s+propellant|ergol\s+[eé]lectrique|solar\s*(?:array|power)|puissance\s+solaire|bus\s+load|charge\s+bus|system\s+margin|marge\s+syst[eè]me|power\s+distribution|distribution\s+(?:de\s+)?puissance|constant\s+consumption|consommation\s+constante|battery\s+(?:voltage|soc)|tension\s+batterie|[eé]tat\s+de\s+charge)\b/iu.test(message)
}

function resolveActiveGmatRunDir(root: string, requested: unknown) {
  return resolveMissionRun(root, requested)?.runDir ?? null
}

async function appendRequestedDraftTurn(workspaceDir: string, draftId: string, template: unknown, assistant: string, user: string) {
  return draftId && typeof template === "string" && isGmatTemplateId(template)
    ? appendMissionTemplateDraftConversation(template, workspaceDir, draftId, { assistant, user })
    : undefined
}

async function applyMixedSimuCicRequest(message: string, draftWorkspace: string, planningWorkspace: string, activeRunDir: string | null) {
  if (!isSimuCicRequest(message)) return null
  const result = await applyExplicitSimuCicConfiguration(draftWorkspace, message)
  if (!result) return null
  // The draft is private until GMAT is launched, but Mission Studio renders
  // the planning workspace. Persist the same deterministic request in both.
  if (draftWorkspace !== planningWorkspace) await applyExplicitSimuCicConfiguration(planningWorkspace, message)
  if (activeRunDir) await syncSimuCicRequestToRunSnapshot(activeRunDir, result.document)
  return result.message
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
  if (candidate.target !== "clarify" && candidate.target !== "general" && (typeof candidate.target !== "string" || !isGmatTemplateId(candidate.target))) {
    throw new Error("LLM routing response has an unknown target")
  }
  if (typeof candidate.message !== "string" || !candidate.message.trim()) throw new Error("LLM routing response has no message")
  return { target: candidate.target, message: candidate.message.trim() }
}

async function routeMissionMessage(config: AppConfig, message: string) {
  const connection = resolveModelBackend(config, "chatModel")
  const prompt = [
    "You route a user message in a spacecraft engineering application.",
    `Return JSON only: {\"target\": ${[...allGmatTemplateDefinitions().map(template => `\"${template.id}\"`), "\"clarify\"", "\"general\""].join("|")}, \"message\": \"string\"}.`,
    "Choose orbit-keeping only for station keeping, reboost, drag decay maintenance, or an orbit-maintenance GMAT mission.",
    "Choose electric-propulsion-transfer only for an electric/thrust transfer or finite electric burn GMAT mission.",
    "Choose chemical-hohmann-transfer only for a chemical two-impulse, Hohmann, or circularisation transfer.",
    "Choose clarify when the user appears to want a GMAT mission but its family is ambiguous. Ask one short question and do not invent parameters.",
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
  fastify.patch<{ Body: { draftId?: unknown; path?: unknown; template?: unknown; value?: unknown; workspaceDir?: unknown } }>("/api/gmat/mission-values", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const template = req.body?.template
    const fieldPath = typeof req.body?.path === "string" ? req.body.path : ""
    const rawValue = typeof req.body?.value === "string" || typeof req.body?.value === "number" ? String(req.body.value) : ""
    const draftId = typeof req.body?.draftId === "string" ? req.body.draftId : ""
    if (typeof template !== "string" || !isGmatTemplateId(template) || !fieldPath || !rawValue.trim()) {
      return reply.status(400).send({ error: "template, path, and value are required" })
    }
    const workspaceDir = typeof req.body?.workspaceDir === "string" && req.body.workspaceDir.trim() ? path.resolve(req.body.workspaceDir) : root
    if (!isPathInside(path.resolve(root), workspaceDir) || !isMissionRunWorkspace(workspaceDir)) {
      return reply.status(409).send({ error: "select a template and satellite for a dated mission run before entering mission values" })
    }
    try {
      const planningThread = await loadOrCreateDigitalThread(workspaceDir)
      const selection = planningThread.digital_thread.satellite_definition as { id?: unknown; version?: unknown } | undefined
      if (!selection || typeof selection.id !== "string") return reply.status(409).send({ error: "select a compatible satellite before entering mission values" })
      const satellite = await getSatelliteDefinition(selection.id, typeof selection.version === "string" ? selection.version : undefined)
      if (!satellite.mission_templates.includes(template)) return reply.status(409).send({ error: `selected satellite is not compatible with ${template}` })
      const adapted = adaptDigitalThreadToGmat(planningThread, template)
      if (adapted.guards.some(guard => guard.code === "incompatible_propulsion")) return reply.status(409).send({ error: "selected satellite propulsion is incompatible with this template" })
      const runtime = missionTemplateRuntime(template)
      const baseDraft = draftId ? await runtime.load(workspaceDir, draftId) : await runtime.create(workspaceDir, adapted.values, adapted.requiredDraftPaths)
      const draft = await runtime.setValue(workspaceDir, baseDraft, fieldPath, rawValue)
      const draftWorkspace = draftDigitalThreadWorkspaceDir(workspaceDir, template, draft.draftId)
      await syncDigitalThreadFromGmatDraft(draftWorkspace, draft)
      await syncDigitalThreadFromGmatDraft(workspaceDir, draft)
      return reply.send({ draft, template })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to update GMAT mission value") })
    }
  })

  fastify.post<{ Body: { draftId?: unknown; message?: unknown; runPath?: unknown; template?: unknown; workspaceDir?: unknown } }>("/api/gmat/route", async (req, reply) => {
    const message = typeof req.body?.message === "string" ? req.body.message.trim() : ""
    if (!message) return reply.status(400).send({ error: "message must be a non-empty string" })
    const root = getRequestUserWorkspaceRoot()
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    const workspaceDir = typeof req.body?.workspaceDir === "string" && req.body.workspaceDir.trim() ? path.resolve(req.body.workspaceDir) : root
    if (!isPathInside(path.resolve(root), workspaceDir)) return reply.status(400).send({ error: "workspaceDir must be inside the current user workspace" })
    if (!isMissionRunWorkspace(workspaceDir)) return reply.status(409).send({ error: "start a dated mission discussion before sending GMAT messages" })
    const draftId = typeof req.body?.draftId === "string" ? req.body.draftId : ""
    const template = req.body?.template
    const draftThreadWorkspace = draftId && typeof template === "string" && isGmatTemplateId(template)
      ? draftDigitalThreadWorkspaceDir(workspaceDir, template, draftId)
      : workspaceDir
    const activeRunDir = resolveActiveGmatRunDir(root, req.body?.runPath)
    try {
      if (isSimuCicRequest(message) && !hasGmatMissionRequest(message)) {
        const result = await updateDigitalThreadWithLlm({ connection: resolveModelBackend(config, "chatModel"), message, workspaceDir: draftThreadWorkspace })
        // The draft is the isolated conversation context, but the planning
        // workspace is the active satellite.json used by the Mission Studio.
        // Mirror Simu-CIC configuration so the UI and the next execution read
        // the same attitude law and station list.
        if (draftThreadWorkspace !== workspaceDir) {
          const planningThread = await loadOrCreateDigitalThread(workspaceDir)
          planningThread.analysis_requests.simu_cic = JSON.parse(JSON.stringify(result.document.analysis_requests.simu_cic))
          planningThread.provenance.values = {
            ...(planningThread.provenance.values && typeof planningThread.provenance.values === "object" && !Array.isArray(planningThread.provenance.values) ? planningThread.provenance.values : {}),
            "analysis_requests.simu_cic": { source: "gmat_mission_draft", synchronized_at: new Date().toISOString() },
          }
          await saveDigitalThread(workspaceDir, planningThread)
        }
        if (activeRunDir) await syncSimuCicRequestToRunSnapshot(activeRunDir, result.document)
        const turn = { answer: result.message, askedAt: new Date().toISOString(), channel: "simu-cic" as const, question: message }
        await appendMissionConversation(workspaceDir, turn)
        if (activeRunDir) await appendRunConversation(activeRunDir, turn)
        const draft = await appendRequestedDraftTurn(workspaceDir, draftId, template, result.message || "Simu-CIC configuration updated.", message)
        return reply.send({ digitalThread: result.document, draft, kind: "simu-cic", message: result.message || "Simu-CIC configuration updated." })
      }
      // Preserve the currently selected template for an explicit what-if
      // change (e.g. "set dry mass to 320 kg").  Such a message is often
      // routed as general by a model although it belongs to this GMAT draft.
      const runOverrideRequest = isSatelliteRunOverrideRequest(message)
      const selectedTemplate = typeof template === "string" && isGmatTemplateId(template) ? template : null
      const decision = runOverrideRequest && selectedTemplate
        ? { target: selectedTemplate, message: "Recorded the run-specific satellite configuration change." } satisfies RoutingDecision
        // The explicit UI choice is authoritative for the first turn. The
        // LLM still guides the mission definition inside that template.
        : selectedTemplate && !draftId
          ? { target: selectedTemplate, message: `Using the selected ${gmatTemplateDefinition(selectedTemplate).name} template.` } satisfies RoutingDecision
          : await routeMissionMessage(config, message)
      if (decision.target === "general") {
        // General questions must remain part of the mission record as well.
        // Otherwise the UI loses the user's turn as soon as the transient
        // composer state is refreshed.
        const turn = { answer: decision.message, askedAt: new Date().toISOString(), channel: "gmat-draft" as const, question: message }
        await appendMissionConversation(workspaceDir, turn)
        if (activeRunDir) await appendRunConversation(activeRunDir, turn)
        return reply.send({ kind: decision.target, message: decision.message })
      }
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
      // private digital thread, so synchronize the physical definition into
      // the draft whenever the user selects a different satellite. Keep the
      // draft's mission fields; only the satellite-owned source changes.
      if (draftThreadWorkspace !== workspaceDir) {
        const planningDigitalThread = await loadOrCreateDigitalThread(workspaceDir)
        const planningSelection = planningDigitalThread.digital_thread.satellite_definition as { id?: unknown; version?: unknown } | null
        const selectionChanged = planningSelection && typeof planningSelection.id === "string" && (
          !satelliteSelection ||
          satelliteSelection.id !== planningSelection.id ||
          satelliteSelection.version !== planningSelection.version ||
          JSON.stringify(currentDigitalThread.satellite) !== JSON.stringify(planningDigitalThread.satellite)
        )
        if (selectionChanged) {
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
        const templateName = gmatTemplateDefinition(decision.target).name
        const clarification = `Step 1: select a satellite compatible with the ${templateName} template. Step 2: enter the mission inputs shown in Required before GMAT can run, one at a time or in a single message. I will keep the run-specific satellite.json updated and tell you what is still needed.`
        // A mission discussion needs a visible, persistent GMAT draft even
        // before its satellite is selected.  It owns the empty satellite.json
        // that will later be populated by Satellite Library.
        const draft = await missionTemplateRuntime(decision.target).create(workspaceDir)
        const savedDraft = await appendRequestedDraftTurn(workspaceDir, draft.draftId, decision.target, clarification, message) ?? draft
        await appendMissionConversation(workspaceDir, { answer: clarification, askedAt: savedDraft.updatedAt, channel: "gmat-draft", question: message })
        return reply.send({ draft: savedDraft, kind: "mission", message: clarification, template: decision.target })
      }
      const selectedSatellite = await getSatelliteDefinition(satelliteSelection.id, typeof satelliteSelection.version === "string" ? satelliteSelection.version : undefined)
      if (!selectedSatellite.mission_templates.includes(decision.target)) {
        const clarification = `The selected satellite (${selectedSatellite.name}) is not compatible with the ${decision.target} GMAT template. Select a satellite with the required propulsion system or describe a compatible mission.`
        const draft = await appendRequestedDraftTurn(workspaceDir, draftId, template, clarification, message)
        return reply.send({ draft, kind: "clarify", message: clarification })
      }
      if (runOverrideRequest) {
        const override = await updateDigitalThreadWithLlm({
          connection: resolveModelBackend(config, "chatModel"),
          message,
          workspaceDir: draftThreadWorkspace,
          allowedPaths: SATELLITE_RUN_OVERRIDE_PATHS,
        })
        currentDigitalThread = override.document
        // The planning workspace is the user-facing satellite.json. Mirror
        // only the run-local satellite and its provenance from the private
        // draft; the library remains read-only.
        if (draftThreadWorkspace !== workspaceDir) {
          const planningThread = await loadOrCreateDigitalThread(workspaceDir)
          planningThread.satellite = JSON.parse(JSON.stringify(override.document.satellite))
          planningThread.provenance.values = JSON.parse(JSON.stringify(override.document.provenance.values))
          await saveDigitalThread(workspaceDir, planningThread)
        }
      }
        const adapted = adaptDigitalThreadToGmat(currentDigitalThread, decision.target)
      const propulsionGuard = adapted.guards.find(guard => guard.code === "incompatible_propulsion")
      if (propulsionGuard) {
        const clarification = `${propulsionGuard.message} Select a compatible satellite before continuing.`
        const draft = await appendRequestedDraftTurn(workspaceDir, draftId, template, clarification, message)
        return reply.send({ draft, kind: "clarify", message: clarification })
      }
      // Continue an existing draft after satellite selection; otherwise create
      // a template-owned draft from the digital-thread adapter values.
      const runtime = missionTemplateRuntime(decision.target)
      const existingDraft = draftId && template === decision.target ? await runtime.load(workspaceDir, draftId) : null
      const draft = existingDraft
        ? { ...existingDraft, digitalThreadRequiredPaths: adapted.requiredDraftPaths, values: { ...existingDraft.values, ...Object.fromEntries(Object.entries(adapted.values).filter(([, value]) => value !== null)) } }
        : await runtime.create(workspaceDir, adapted.values, adapted.requiredDraftPaths)
      let updatedDraft = await runtime.discuss({ connection: resolveModelBackend(config, "chatModel"), draft, message, workspaceDir })
      await appendMissionConversation(workspaceDir, { answer: updatedDraft.assistantMessage ?? "Mission draft updated.", askedAt: updatedDraft.updatedAt, channel: "gmat-draft", question: message })
      const createdDraftThreadWorkspace = draftDigitalThreadWorkspaceDir(workspaceDir, decision.target, updatedDraft.draftId)
      await syncDigitalThreadFromGmatDraft(createdDraftThreadWorkspace, updatedDraft)
      await syncDigitalThreadFromGmatDraft(workspaceDir, updatedDraft)
      const simuCicMessage = await applyMixedSimuCicRequest(message, createdDraftThreadWorkspace, workspaceDir, activeRunDir)
      if (simuCicMessage) updatedDraft = { ...updatedDraft, assistantMessage: [updatedDraft.assistantMessage, simuCicMessage].filter(Boolean).join("\n\n") }
      return reply.send({ adapter: adapted, digitalThread: await loadOrCreateDigitalThread(createdDraftThreadWorkspace), draft: updatedDraft, kind: "mission", message: [decision.message, simuCicMessage].filter((value): value is string => Boolean(value)).join("\n\n"), template: decision.target })
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
