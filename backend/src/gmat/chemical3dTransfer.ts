import fs from "node:fs/promises"
import path from "node:path"
import { parseDocument, stringify } from "yaml"

import { initializeDraftDigitalThread, isMissionRunWorkspace } from "../digitalThread/digitalThreadStore.js"
import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { runManagedProcess } from "./externalProcess.js"
import { requestGmatModel } from "./modelRequest.js"
import { toGmatNativePath } from "./orbitKeepingRunner.js"
import { gmatTemplateDefinition } from "./templateRegistry.js"
import { assertGmatMissionGuardrails, validateGmatMissionGuardrails } from "./missionGuardrails.js"
import { loadSatelliteYamlSnapshot } from "./satelliteYamlSnapshot.js"

type Value = string | number | null
type Run = { completedAt: string; result: { error?: string; status: string }; runId: string; runPath: string }
export type Chemical3dDraft = {
  assistantMessage?: string
  confirmed: boolean
  conversation: Array<{ assistant: string; user: string }>
  createdAt: string
  digitalThreadRequiredPaths?: string[]
  draftId: string
  missing: string[]
  runs: Run[]
  status: "collecting" | "ready" | "confirmed"
  templateId: "chemical-3d-transfer"
  updatedAt: string
  values: Record<string, Value>
}

const EARTH_RADIUS_KM = 6378.1363
// GMAT's TAIModJulian range is constrained by the time system bundled with
// this application. Keep the draft validator aligned with GMAT so it never
// emits a script rejected before the mission sequence starts.
const GMAT_TAI_MOD_JULIAN_MIN = 6116
const GMAT_TAI_MOD_JULIAN_MAX = 58127.5
const missionFields = [
  "initialOrbit.epoch",
  "initialOrbit.altitudeKm",
  "initialOrbit.eccentricity",
  "initialOrbit.inclinationDeg",
  "transfer.finalAltitudeKm",
  "transfer.finalInclinationDeg",
] as const
const physicalFields = ["spacecraft.dryMassKg", "spacecraft.dragAreaM2", "spacecraft.dragCoefficient", "propulsion.ispSeconds"] as const
const fields = [...missionFields, ...physicalFields]

function draftPath(workspaceDir: string, draftId: string) {
  if (!/^draft_[a-f0-9-]+$/u.test(draftId)) throw new Error("invalid GMAT draft id")
  return path.join(path.resolve(workspaceDir), "gmat", "chemical-3d-transfer", "drafts", draftId, "draft.json")
}

function refresh(draft: Omit<Chemical3dDraft, "missing" | "status" | "updatedAt">): Chemical3dDraft {
  const epoch = draft.values["initialOrbit.epoch"]
  if (epoch !== null && epoch !== undefined && epoch !== "") validateEpoch(epoch)
  const missing = fields.filter(field => draft.values[field] === null || draft.values[field] === undefined || draft.values[field] === "")
  return { ...draft, missing, status: draft.confirmed ? "confirmed" : missing.length ? "collecting" : "ready", updatedAt: new Date().toISOString() }
}

function validateEpoch(value: Value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value)) throw new Error("initial epoch must be numeric TAIModJulian")
  const epoch = Number(value)
  if (epoch < GMAT_TAI_MOD_JULIAN_MIN || epoch > GMAT_TAI_MOD_JULIAN_MAX) throw new Error(`initial epoch must be within GMAT's TAIModJulian range ${GMAT_TAI_MOD_JULIAN_MIN} to ${GMAT_TAI_MOD_JULIAN_MAX}`)
}

async function save(workspaceDir: string, draft: Chemical3dDraft) {
  const output = draftPath(workspaceDir, draft.draftId)
  await fs.mkdir(path.dirname(output), { recursive: true })
  const satelliteInputs = await loadSatelliteYamlSnapshot(workspaceDir)
  await Promise.all([
    fs.writeFile(output, `${JSON.stringify(draft, null, 2)}\n`),
    fs.writeFile(path.join(path.dirname(output), "chemical_3d_transfer.values.yaml"), stringify({ draft_id: draft.draftId, template_id: draft.templateId, values: draft.values, ...(satelliteInputs ? { satellite_inputs: satelliteInputs } : {}) })),
  ])
  return draft
}

export async function createChemical3dDraft(workspaceDir: string, initialValues: Record<string, Value> = {}, digitalThreadRequiredPaths: string[] = []) {
  const now = new Date().toISOString()
  const draft = await save(workspaceDir, refresh({
    confirmed: false,
    conversation: [],
    createdAt: now,
    digitalThreadRequiredPaths,
    draftId: `draft_${crypto.randomUUID()}`,
    runs: [],
    templateId: "chemical-3d-transfer",
    values: Object.fromEntries(fields.map(field => [field, initialValues[field] ?? null])),
  }))
  // Every template owns a private, run-local satellite.json.  Without this
  // initialization Chemical 3D could capture an empty draft context even
  // though the planning run had a selected satellite.
  await initializeDraftDigitalThread(workspaceDir, "chemical-3d-transfer", draft.draftId)
  return draft
}

export async function loadChemical3dDraft(workspaceDir: string, draftId: string) {
  const source = JSON.parse(await fs.readFile(draftPath(workspaceDir, draftId), "utf8")) as Chemical3dDraft
  if (source.templateId !== "chemical-3d-transfer") throw new Error("unsupported chemical 3D GMAT draft")
  return refresh({ ...source, conversation: Array.isArray(source.conversation) ? source.conversation : [], runs: Array.isArray(source.runs) ? source.runs : [], values: source.values })
}

export async function setChemical3dDraftValue(workspaceDir: string, draft: Chemical3dDraft, field: string, raw: string) {
  if (!fields.includes(field as typeof fields[number])) throw new Error("unsupported chemical 3D mission field")
  const value: Value = field === "initialOrbit.epoch" ? raw.trim() : Number(raw)
  if (value === "" || (typeof value === "number" && !Number.isFinite(value))) throw new Error("a finite value is required")
  if (field === "initialOrbit.epoch") validateEpoch(value)
  const values = { ...draft.values, [field]: value }
  const guardrails = validateGmatMissionGuardrails("chemical-3d-transfer", values)
  if (guardrails.length) throw new Error(`GMAT mission guardrails failed: ${guardrails.map(guard => guard.message).join(" ")}`)
  return save(workspaceDir, refresh({ ...draft, confirmed: false, values }))
}

export async function confirmChemical3dDraft(workspaceDir: string, draftId: string) {
  const draft = await loadChemical3dDraft(workspaceDir, draftId)
  if (draft.missing.length) throw new Error(`GMAT draft is incomplete: ${draft.missing.join(", ")}`)
  assertGmatMissionGuardrails("chemical-3d-transfer", draft.values)
  return save(workspaceDir, refresh({ ...draft, confirmed: true }))
}

function responseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") return (payload as { output_text: string }).output_text.trim()
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const parts: string[] = []
  for (const item of Array.isArray(output) ? output : []) for (const part of Array.isArray(item && typeof item === "object" ? (item as { content?: unknown }).content : undefined) ? (item as { content: unknown[] }).content : []) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") parts.push((part as { text: string }).text.trim())
  return parts.filter(Boolean).join("\n")
}

function assistantPatch(source: string) {
  const document = parseDocument(source)
  if (document.errors.length) throw new Error("LLM Chemical 3D response is not valid YAML")
  const parsed = document.toJS() as { message?: unknown; updates?: unknown }
  if (!parsed || !Array.isArray(parsed.updates)) throw new Error("LLM Chemical 3D response must contain updates")
  const allowed = new Set<string>(fields)
  const updates = parsed.updates.map(item => {
    const update = item && typeof item === "object" ? item as { path?: unknown; value?: unknown } : null
    if (!update || typeof update.path !== "string" || !allowed.has(update.path) || (typeof update.value !== "string" && typeof update.value !== "number")) throw new Error("LLM Chemical 3D response contains an unsupported mission value")
    return { path: update.path, value: String(update.value) }
  })
  return { message: typeof parsed.message === "string" ? parsed.message.trim() : "", updates }
}

export async function discussChemical3dDraft({ connection, draft, message, workspaceDir, fetchImpl = fetch }: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">
  draft: Chemical3dDraft
  message: string
  workspaceDir: string
  fetchImpl?: typeof fetch
}) {
  const prompt = [
    "You fill a deterministic GMAT Chemical 3D GEO transfer form.",
    "Return YAML only: message: string; updates: [{ path: string, value: string|number }]. Include updates: [] when no supported value is supplied.",
    "Never invent values. Record every explicit value from the engineer message and ask one concise question only when required values are missing.",
    `The mission requires numeric TAIModJulian epoch in GMAT's allowed range ${GMAT_TAI_MOD_JULIAN_MIN} to ${GMAT_TAI_MOD_JULIAN_MAX}, initial altitude in km, eccentricity, initial inclination in degrees, final altitude in km, final inclination in degrees, dry mass in kg, drag area in m2, drag coefficient, and chemical Isp in seconds.`,
    `Allowed paths: ${fields.join(", ")}.`,
    "Initial and final altitude are altitudes above Earth, not orbital radii. Do not calculate a radius; the backend does this deterministically.",
    `Current values: ${JSON.stringify(draft.values)}.`,
    draft.conversation.length ? `Recent discussion: ${JSON.stringify(draft.conversation.slice(-12))}.` : "Recent discussion: none.",
    `Engineer message: ${message}`,
  ].join("\n\n")
  const response = await requestGmatModel(fetchImpl, `${connection.baseUrl.replace(/\/+$/u, "")}/responses`, {
    method: "POST", headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: connection.model, input: prompt, max_output_tokens: 700 }),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`LLM Chemical 3D draft request failed: HTTP ${response.status}`)
  let payload: unknown
  try { payload = JSON.parse(body) } catch { throw new Error("LLM Chemical 3D response is invalid JSON") }
  const patch = assistantPatch(responseText(payload))
  let updated = draft
  for (const change of patch.updates) updated = await setChemical3dDraftValue(workspaceDir, updated, change.path, change.value)
  const assistantMessage = patch.message || (patch.updates.length ? "I recorded the supplied Chemical 3D GEO values." : "Please provide one Chemical 3D GEO mission value.")
  return save(workspaceDir, refresh({ ...updated, assistantMessage, confirmed: false, conversation: [...updated.conversation, { assistant: assistantMessage, user: message }] }))
}

export async function appendChemical3dDraftConversation(workspaceDir: string, draftId: string, turn: { assistant: string; user: string }) {
  const draft = await loadChemical3dDraft(workspaceDir, draftId)
  return save(workspaceDir, refresh({ ...draft, conversation: [...draft.conversation, turn] }))
}

function requiredNumber(values: Record<string, Value>, field: string) {
  const value = values[field]
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`chemical 3D template requires ${field}`)
  return value
}

function replace(script: string, property: string, value: string) {
  const pattern = new RegExp(`^(${property.replace(/\./gu, "\\.")}\\s*=\\s*)[^;]+;`, "mu")
  if (!pattern.test(script)) throw new Error(`chemical 3D template does not expose ${property}`)
  return script.replace(pattern, `$1${value};`)
}

function renderScript(source: string, values: Record<string, Value>, ephemerisPath: string) {
  const initialSmaKm = EARTH_RADIUS_KM + requiredNumber(values, "initialOrbit.altitudeKm")
  const finalSmaKm = EARTH_RADIUS_KM + requiredNumber(values, "transfer.finalAltitudeKm")
  let script = source
  for (const [property, value] of [
    ["geoSat.Epoch", `'${values["initialOrbit.epoch"]}'`],
    ["geoSat.SMA", String(initialSmaKm)],
    ["geoSat.ECC", String(requiredNumber(values, "initialOrbit.eccentricity"))],
    ["geoSat.INC", String(requiredNumber(values, "initialOrbit.inclinationDeg"))],
    ["geoSat.DryMass", String(requiredNumber(values, "spacecraft.dryMassKg"))],
    ["geoSat.Cd", String(requiredNumber(values, "spacecraft.dragCoefficient"))],
    ["geoSat.DragArea", String(requiredNumber(values, "spacecraft.dragAreaM2"))],
    ["TOI.Isp", String(requiredNumber(values, "propulsion.ispSeconds"))],
    ["MCC.Isp", String(requiredNumber(values, "propulsion.ispSeconds"))],
    ["MOI.Isp", String(requiredNumber(values, "propulsion.ispSeconds"))],
    // GMAT otherwise resolves the relative OEM filename against its own
    // output directory. The downstream tools only inspect the dated run
    // directory, therefore the generated script must own an explicit path.
    ["EphemerisFile1.Filename", `'${toGmatNativePath(ephemerisPath).replace(/\\\\/gu, "/")}'`],
  ] as const) script = replace(script, property, value)
  return script
    .replace(/INC = 2/u, `INC = ${requiredNumber(values, "transfer.finalInclinationDeg")}`)
    .replace(/geoSat\.Earth\.SMA = 42166\.90/u, `geoSat.Earth.SMA = ${finalSmaKm}`)
}

export async function generateChemical3dMission({ draft, workspaceDir, execution }: { draft: Chemical3dDraft; workspaceDir: string; execution?: { bin: string; timeoutMs: number } }) {
  if (!draft.confirmed || draft.missing.length) throw new Error("confirm the complete chemical 3D draft before execution")
  assertGmatMissionGuardrails("chemical-3d-transfer", draft.values)
  if (!isMissionRunWorkspace(workspaceDir)) throw new Error("chemical 3D generation requires a dated mission run workspace")
  const runDir = path.resolve(workspaceDir)
  const definition = gmatTemplateDefinition("chemical-3d-transfer")
  const scriptPath = path.join(runDir, "chemical_3d_transfer.script")
  const valuesPath = path.join(runDir, "chemical_3d_transfer.values.yaml")
  const resultPath = path.join(runDir, "gmat_result.json")
  const manifestPath = path.join(runDir, "run_manifest.json")
  const logPath = path.join(runDir, "gmat.log")
  const ephemerisPath = path.join(runDir, "EphemerisFile1.oem")
  const script = renderScript(await fs.readFile(path.join(definition.skillDirectory, definition.gmatReferenceScript), "utf8"), draft.values, ephemerisPath)
  const satelliteInputs = await loadSatelliteYamlSnapshot(workspaceDir)
  await Promise.all([fs.writeFile(scriptPath, script), fs.writeFile(valuesPath, stringify({ draft_id: draft.draftId, template_id: draft.templateId, values: draft.values, ...(satelliteInputs ? { satellite_inputs: satelliteInputs } : {}) }))])
  let result: { error?: string; executionDurationMs?: number; status: "generated" | "completed" | "failed" | "timeout" } = { status: "generated" }
  if (execution) {
    const started = Date.now()
    const run = await runManagedProcess({ args: ["--run", toGmatNativePath(scriptPath)], command: execution.bin, cwd: runDir, timeoutMs: execution.timeoutMs })
    await fs.writeFile(logPath, run.output)
    const oemWritten = await fs.stat(ephemerisPath).then(stat => stat.size > 0).catch(() => false)
    const status = run.timedOut ? "timeout" : run.exitCode === 0 && oemWritten ? "completed" : "failed"
    result = { executionDurationMs: Date.now() - started, status, ...(status === "completed" ? {} : { error: run.timedOut ? "GMAT timed out" : run.exitCode === 0 ? "GMAT completed but did not produce EphemerisFile1.oem" : run.exitCode === null ? "GMAT stopped before completing; inspect gmat.log for the last solver iteration" : `GMAT exited with code ${run.exitCode}` }) }
  }
  await Promise.all([
    fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`),
    fs.writeFile(manifestPath, `${JSON.stringify({ schemaVersion: 1, templateId: draft.templateId, runId: path.basename(runDir), status: result.status, outputs: { ephemeris: result.status === "completed" ? path.basename(ephemerisPath) : null } }, null, 2)}\n`),
  ])
  return { changes: [], result, runDir, runId: path.basename(runDir), scriptPath, valuesPath, resultPath, manifestPath }
}

export async function recordChemical3dDraftRun({ draft, execution, runPath, workspaceDir }: { draft: Chemical3dDraft; execution: Awaited<ReturnType<typeof generateChemical3dMission>>; runPath: string; workspaceDir: string }) {
  return save(workspaceDir, refresh({ ...draft, runs: [...draft.runs, { completedAt: new Date().toISOString(), result: execution.result, runId: execution.runId, runPath }] }))
}
