import fs from "node:fs/promises"
import path from "node:path"
import { parseDocument, stringify } from "yaml"

import { initializeDraftDigitalThread, isMissionRunWorkspace } from "../digitalThread/digitalThreadStore.js"
import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { requestGmatModel } from "./modelRequest.js"

export type ChemicalHohmannDraftValue = string | number | null
export type ChemicalHohmannDraft = {
  assistantMessage?: string
  confirmed: boolean
  conversation: Array<{ assistant: string; user: string }>
  createdAt: string
  digitalThreadRequiredPaths?: string[]
  draftId: string
  missing: string[]
  status: "collecting" | "ready" | "confirmed"
  templateId: "chemical-hohmann-transfer"
  updatedAt: string
  values: Record<string, ChemicalHohmannDraftValue>
}

const EARTH_EQUATORIAL_RADIUS_KM = 6378.1363
const JULIAN_DATE_AT_UNIX_EPOCH = 2440587.5
const GMAT_MODIFIED_JULIAN_OFFSET = 2430000
const TAI_UTC_LEAP_SECONDS: ReadonlyArray<readonly [string, number]> = [
  ["1972-01-01T00:00:00Z", 10], ["1972-07-01T00:00:00Z", 11], ["1973-01-01T00:00:00Z", 12], ["1974-01-01T00:00:00Z", 13],
  ["1975-01-01T00:00:00Z", 14], ["1976-01-01T00:00:00Z", 15], ["1977-01-01T00:00:00Z", 16], ["1978-01-01T00:00:00Z", 17],
  ["1979-01-01T00:00:00Z", 18], ["1980-01-01T00:00:00Z", 19], ["1981-07-01T00:00:00Z", 20], ["1982-07-01T00:00:00Z", 21],
  ["1983-01-01T00:00:00Z", 22], ["1985-01-01T00:00:00Z", 23], ["1988-01-01T00:00:00Z", 24], ["1990-01-01T00:00:00Z", 25],
  ["1991-01-01T00:00:00Z", 26], ["1992-07-01T00:00:00Z", 27], ["1993-01-01T00:00:00Z", 28], ["1994-01-01T00:00:00Z", 29],
  ["1996-01-01T00:00:00Z", 30], ["1997-01-01T00:00:00Z", 31], ["1999-01-01T00:00:00Z", 32], ["2006-01-01T00:00:00Z", 33],
  ["2009-01-01T00:00:00Z", 34], ["2012-07-01T00:00:00Z", 35], ["2015-01-01T00:00:00Z", 36], ["2017-01-01T00:00:00Z", 37],
]
const fields = [
  { label: "Initial epoch", path: "initialOrbit.epoch", required: true },
  { label: "Initial semi-major axis", min: EARTH_EQUATORIAL_RADIUS_KM, path: "initialOrbit.smaKm", required: true },
  { label: "Initial eccentricity", max: 0.999999, min: 0, path: "initialOrbit.eccentricity", required: true },
  { label: "Initial inclination", max: 180, min: 0, path: "initialOrbit.inclinationDeg", required: true },
  { label: "Target orbit radius", min: EARTH_EQUATORIAL_RADIUS_KM, path: "transfer.targetRadiusKm", required: true },
  { label: "Target eccentricity", max: 0.999999, min: 0, path: "transfer.targetEccentricity", required: false },
  { label: "Final propagation duration", min: 0, path: "transfer.finalPropagationSeconds", required: false },
  { label: "Dry mass", min: 0.001, path: "spacecraft.dryMassKg", required: false },
  { label: "Drag area", min: 0.0001, path: "spacecraft.dragAreaM2", required: false },
  { label: "Drag coefficient", min: 0.0001, path: "spacecraft.dragCoefficient", required: false },
  { label: "Specific impulse", min: 0.1, path: "propulsion.ispSeconds", required: false },
] as const

function newDraftId() { return `draft_${crypto.randomUUID()}` }
function draftPath(workspaceDir: string, draftId: string) {
  if (!/^draft_[a-f0-9-]+$/u.test(draftId)) throw new Error("invalid GMAT draft id")
  return path.join(path.resolve(workspaceDir), "gmat", "chemical-hohmann-transfer", "drafts", draftId, "draft.json")
}
function isEpoch(value: unknown): value is string { return typeof value === "string" && /^\d+(?:\.\d+)?$/u.test(value.trim()) }
function utcGregorianToTaiModJulian(utcGregorian: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(utcGregorian)) throw new Error("calendar epoch must use UTC ISO format, for example 2026-08-15T04:00:00Z")
  const milliseconds = Date.parse(utcGregorian)
  if (!Number.isFinite(milliseconds) || milliseconds < Date.parse(TAI_UTC_LEAP_SECONDS[0][0])) throw new Error("calendar epoch is unsupported")
  const taiMinusUtc = TAI_UTC_LEAP_SECONDS.reduce((offset, [effectiveAt, candidate]) => milliseconds >= Date.parse(effectiveAt) ? candidate : offset, 0)
  return (milliseconds / 86_400_000 + JULIAN_DATE_AT_UNIX_EPOCH + taiMinusUtc / 86_400 - GMAT_MODIFIED_JULIAN_OFFSET).toFixed(12)
}
function validate(values: ChemicalHohmannDraft["values"], requiredPaths: string[] = []) {
  const missing: string[] = []
  for (const field of fields) {
    const value = values[field.path]
    if (field.required && (value === null || value === undefined || value === "")) { missing.push(field.path); continue }
    if (value === null || value === undefined || value === "") continue
    if (field.path === "initialOrbit.epoch") { if (!isEpoch(value)) throw new Error("Initial epoch must be a numeric TAIModJulian value"); continue }
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field.label} must be a finite number`)
    if ("min" in field && field.min !== undefined && value < field.min) throw new Error(`${field.label} must be at least ${field.min}`)
    if ("max" in field && field.max !== undefined && value > field.max) throw new Error(`${field.label} must be at most ${field.max}`)
  }
  for (const value of requiredPaths) if ((values[value] === null || values[value] === undefined || values[value] === "") && !missing.includes(value)) missing.push(value)
  return missing
}
function refresh(draft: Omit<ChemicalHohmannDraft, "missing" | "status" | "updatedAt">): ChemicalHohmannDraft {
  const missing = validate(draft.values, draft.digitalThreadRequiredPaths)
  return { ...draft, missing, status: draft.confirmed ? "confirmed" : missing.length ? "collecting" : "ready", updatedAt: new Date().toISOString() }
}
async function save(workspaceDir: string, draft: ChemicalHohmannDraft) {
  const output = draftPath(workspaceDir, draft.draftId)
  await fs.mkdir(path.dirname(output), { recursive: true })
  const valuesSource = stringify({ draft_id: draft.draftId, template_id: draft.templateId, updated_at: draft.updatedAt, values: draft.values })
  await Promise.all([
    fs.writeFile(output, `${JSON.stringify(draft, null, 2)}\n`, "utf8"),
    fs.writeFile(path.join(path.dirname(output), "chemical_hohmann_transfer.values.yaml"), valuesSource, "utf8"),
    ...(isMissionRunWorkspace(workspaceDir) ? [fs.writeFile(path.join(path.resolve(workspaceDir), "chemical_hohmann_transfer.values.yaml"), valuesSource, "utf8")] : []),
  ])
  return draft
}

export async function createChemicalHohmannDraft(workspaceDir: string, initialValues: Record<string, ChemicalHohmannDraftValue> = {}, digitalThreadRequiredPaths: string[] = []) {
  const values = Object.fromEntries(fields.map(field => [field.path, initialValues[field.path] ?? (field.path === "transfer.targetEccentricity" ? 0.005 : field.path === "transfer.finalPropagationSeconds" ? 86400 : null)]))
  const now = new Date().toISOString()
  const draft = await save(workspaceDir, refresh({ confirmed: false, conversation: [], createdAt: now, digitalThreadRequiredPaths, draftId: newDraftId(), templateId: "chemical-hohmann-transfer", values }))
  await initializeDraftDigitalThread(workspaceDir, "chemical-hohmann-transfer", draft.draftId)
  return draft
}
export async function loadChemicalHohmannDraft(workspaceDir: string, draftId: string) {
  const parsed = JSON.parse(await fs.readFile(draftPath(workspaceDir, draftId), "utf8")) as ChemicalHohmannDraft
  if (parsed.templateId !== "chemical-hohmann-transfer" || !parsed.values) throw new Error("unsupported chemical Hohmann GMAT draft")
  return refresh({ ...parsed, confirmed: parsed.confirmed === true, conversation: Array.isArray(parsed.conversation) ? parsed.conversation : [], digitalThreadRequiredPaths: Array.isArray(parsed.digitalThreadRequiredPaths) ? parsed.digitalThreadRequiredPaths : [], values: { ...parsed.values } })
}
export async function setChemicalHohmannDraftValue(workspaceDir: string, draft: ChemicalHohmannDraft, requestedPath: string, rawValue: string) {
  const raw = rawValue.trim()
  if (!raw) throw new Error("a value is required")
  const values = { ...draft.values }
  if (requestedPath === "initialOrbit.altitudeKm") {
    const altitude = Number(raw)
    if (!Number.isFinite(altitude) || altitude < 0) throw new Error("initial altitude must be a non-negative number in km")
    values["initialOrbit.smaKm"] = Number((EARTH_EQUATORIAL_RADIUS_KM + altitude).toFixed(9))
  } else if (requestedPath === "transfer.targetAltitudeKm") {
    const altitude = Number(raw)
    if (!Number.isFinite(altitude) || altitude < 0) throw new Error("target altitude must be a non-negative number in km")
    values["transfer.targetRadiusKm"] = Number((EARTH_EQUATORIAL_RADIUS_KM + altitude).toFixed(9))
  } else if (requestedPath === "initialOrbit.utcGregorian") {
    values["initialOrbit.epoch"] = utcGregorianToTaiModJulian(raw)
  } else {
    const field = fields.find(candidate => candidate.path === requestedPath)
    if (!field) throw new Error("unsupported chemical Hohmann mission field")
    const value = requestedPath === "initialOrbit.epoch" ? raw : Number(raw)
    if (requestedPath !== "initialOrbit.epoch" && (!Number.isFinite(value) || typeof value !== "number")) throw new Error(`${field.label} must be a finite number`)
    values[requestedPath] = value
  }
  return save(workspaceDir, refresh({ ...draft, confirmed: false, values }))
}
export async function confirmChemicalHohmannDraft(workspaceDir: string, draftId: string) {
  const draft = await loadChemicalHohmannDraft(workspaceDir, draftId)
  if (draft.missing.length) throw new Error(`GMAT draft is incomplete: ${draft.missing.join(", ")}`)
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
  const parsed = parseDocument(source)
  if (parsed.errors.length) throw new Error("LLM Hohmann response is not valid YAML")
  const result = parsed.toJS() as { message?: unknown; updates?: unknown }
  if (!result || !Array.isArray(result.updates)) throw new Error("LLM Hohmann response must contain updates")
  const allowed = new Set([...fields.map(field => field.path), "initialOrbit.altitudeKm", "initialOrbit.utcGregorian", "transfer.targetAltitudeKm"])
  const updates = result.updates.map(item => {
    const candidate = item && typeof item === "object" ? item as { path?: unknown; value?: unknown } : null
    if (!candidate || typeof candidate.path !== "string" || !allowed.has(candidate.path) || (typeof candidate.value !== "string" && typeof candidate.value !== "number")) throw new Error("LLM Hohmann response contains an unsupported mission value")
    return { path: candidate.path, value: String(candidate.value) }
  })
  return { message: typeof result.message === "string" ? result.message.trim() : "", updates }
}

/** Lets the LLM fill the same deterministic inputs as the form. It may only
 * return an allow-listed patch; validation and satellite.json synchronization
 * remain backend-owned. */
export async function discussChemicalHohmannDraft({ connection, draft, message, workspaceDir, fetchImpl = fetch }: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">
  draft: ChemicalHohmannDraft
  message: string
  workspaceDir: string
  fetchImpl?: typeof fetch
}) {
  const prompt = [
    "You assist an engineer filling a deterministic GMAT chemical Hohmann-transfer form.",
    "Return YAML only: message: string; updates: [{ path: string, value: string|number }]. Use updates: [] if the message gives no supported numeric value.",
    "Never invent values. Record every supported value present in the user's message. Ask one concise question for the most important missing value.",
    "The fixed template requires an epoch, initial SMA in km (or initial altitude in km), eccentricity, inclination in degrees, and target orbit radius (or target altitude) in km.",
    "For a calendar time with an explicit timezone, emit initialOrbit.utcGregorian as UTC ISO; the backend converts it deterministically to TAIModJulian. Do not emit an epoch for a calendar time without a timezone.",
    "For phrases such as 'from 300 km to 500 km', emit initialOrbit.altitudeKm and transfer.targetAltitudeKm; the backend derives the two radii using Earth equatorial radius 6378.1363 km.",
    `Allowed paths: ${[...fields.map(field => field.path), "initialOrbit.altitudeKm", "initialOrbit.utcGregorian", "transfer.targetAltitudeKm"].join(", ")}.`,
    `Current values: ${JSON.stringify(draft.values)}.`,
    `User message: ${message}`,
  ].join("\n\n")
  const response = await requestGmatModel(fetchImpl, `${connection.baseUrl.replace(/\/+$/u, "")}/responses`, { method: "POST", headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: connection.model, input: prompt, max_output_tokens: 600 }) })
  const body = await response.text()
  if (!response.ok) throw new Error(`LLM Hohmann draft request failed: HTTP ${response.status}`)
  let payload: unknown
  try { payload = JSON.parse(body) } catch { throw new Error("LLM Hohmann response is invalid JSON") }
  const patch = assistantPatch(responseText(payload))
  let updated = draft
  for (const change of patch.updates) updated = await setChemicalHohmannDraftValue(workspaceDir, updated, change.path, change.value)
  const assistantMessage = patch.message || (patch.updates.length ? "I recorded the supplied Hohmann-transfer values." : "Please provide one of the required Hohmann-transfer mission values.")
  return save(workspaceDir, refresh({ ...updated, assistantMessage, confirmed: false, conversation: [...updated.conversation, { assistant: assistantMessage, user: message }] }))
}

export async function appendChemicalHohmannDraftConversation(workspaceDir: string, draftId: string, turn: { assistant: string; user: string }) {
  const draft = await loadChemicalHohmannDraft(workspaceDir, draftId)
  return save(workspaceDir, refresh({ ...draft, conversation: [...draft.conversation, turn] }))
}
