import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { PREDEFINED_GROUND_STATIONS, assertValidSimuCicRequest } from "../opalis/groundStationCatalog.js"

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }
export type DigitalThreadDocument = { [key: string]: JsonValue } & {
  schema_version: number
  digital_thread: { [key: string]: JsonValue }
  satellite: { [key: string]: JsonValue }
  analysis_requests: { [key: string]: JsonValue }
  provenance: { [key: string]: JsonValue }
}

const CURRENT_SCHEMA_VERSION = 1
const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SOURCE_DIR, "../../..")
const TEMPLATE_PATH = path.join(PROJECT_ROOT, "data", "templates", "satellite.digital-thread.template.json")

export function digitalThreadPath(workspaceDir: string) {
  return path.join(path.resolve(workspaceDir), "digital-thread", "satellite.json")
}

function asObject(value: JsonValue | undefined): { [key: string]: JsonValue } | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as { [key: string]: JsonValue } : null
}

/** Keeps older workspaces compatible when mission-only orbital inputs are added. */
function ensureMissionRequestShape(document: DigitalThreadDocument) {
  let changed = false
  const analysis = document.analysis_requests
  const gmat = asObject(analysis.gmat) ?? (analysis.gmat = {}, analysis.gmat as { [key: string]: JsonValue })
  for (const template of ["orbit_keeping", "electric_propulsion_transfer"]) {
    const request = asObject(gmat[template]) ?? (gmat[template] = {}, gmat[template] as { [key: string]: JsonValue })
    const orbit = asObject(request.initial_orbit) ?? (request.initial_orbit = {}, request.initial_orbit as { [key: string]: JsonValue })
    for (const field of ["epoch_tai_mod_julian", "semi_major_axis_km", "eccentricity", "inclination_deg", "raan_deg", "arg_of_perigee_deg", "true_anomaly_deg"]) {
      if (!(field in orbit)) { orbit[field] = null; changed = true }
    }
  }
  const simuCic = asObject(analysis.simu_cic) ?? (analysis.simu_cic = {}, analysis.simu_cic as { [key: string]: JsonValue })
  for (const [field, defaultValue] of Object.entries({
    attitude_mode: "nadir_pointing",
    ground_station_ids: [],
    simultaneous_visibility_policy: null,
  } satisfies { [key: string]: JsonValue })) {
    if (!(field in simuCic) || (field === "attitude_mode" && (simuCic[field] === null || simuCic[field] === "earth_pointing"))) { simuCic[field] = defaultValue; changed = true }
  }
  return changed
}

function getAtPath(document: DigitalThreadDocument, fieldPath: string): JsonValue | undefined {
  let current: JsonValue = document
  for (const key of fieldPath.split(".")) {
    const record = asObject(current)
    if (!record || !(key in record)) return undefined
    current = record[key]
  }
  return current
}

function setAtPath(document: DigitalThreadDocument, fieldPath: string, value: JsonValue) {
  const keys = fieldPath.split(".")
  let current: { [key: string]: JsonValue } = document
  for (const key of keys.slice(0, -1)) {
    const next = asObject(current[key])
    if (!next) throw new Error(`digital-thread path is not writable: ${fieldPath}`)
    current = next
  }
  current[keys.at(-1)!] = value
}

function leafPaths(value: JsonValue, prefix = ""): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return prefix ? [prefix] : []
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key))
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true
  if (typeof value === "number") return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(isJsonValue)
  return Boolean(value) && typeof value === "object" && Object.values(value as Record<string, unknown>).every(isJsonValue)
}

function assertDocument(value: unknown): asserts value is DigitalThreadDocument {
  const candidate = value as Partial<DigitalThreadDocument> | null
  if (!candidate || typeof candidate !== "object" || candidate.schema_version !== CURRENT_SCHEMA_VERSION || !candidate.satellite || !candidate.analysis_requests || !candidate.digital_thread || !candidate.provenance) {
    throw new Error(`unsupported satellite digital-thread schema; expected version ${CURRENT_SCHEMA_VERSION}`)
  }
}

async function readTemplate() {
  const parsed: unknown = JSON.parse(await fs.readFile(TEMPLATE_PATH, "utf8"))
  assertDocument(parsed)
  return parsed
}

export async function loadOrCreateDigitalThread(workspaceDir: string) {
  const output = digitalThreadPath(workspaceDir)
  const existing = await fs.readFile(output, "utf8").catch(() => null)
  if (existing !== null) {
    const parsed: unknown = JSON.parse(existing)
    assertDocument(parsed)
    if (ensureMissionRequestShape(parsed)) await saveDigitalThread(workspaceDir, parsed)
    return parsed
  }
  const document = await readTemplate()
  ensureMissionRequestShape(document)
  const now = new Date().toISOString()
  document.digital_thread.thread_id = crypto.randomUUID()
  document.digital_thread.created_at = now
  document.digital_thread.updated_at = now
  await saveDigitalThread(workspaceDir, document, false)
  return document
}

export async function saveDigitalThread(workspaceDir: string, document: DigitalThreadDocument, incrementRevision = true) {
  assertDocument(document)
  const metadata = document.digital_thread
  metadata.revision = incrementRevision ? Number(metadata.revision ?? 0) + 1 : Number(metadata.revision ?? 0)
  metadata.updated_at = new Date().toISOString()
  const output = digitalThreadPath(workspaceDir)
  await fs.mkdir(path.dirname(output), { recursive: true })
  const temporary = `${output}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporary, `${JSON.stringify(document, null, 2)}\n`, "utf8")
  await fs.rename(temporary, output)
  return document
}

export type DigitalThreadSnapshot = {
  document: DigitalThreadDocument
  source: string
}

/** Captures the exact source-of-truth state before a tool starts running. */
export async function captureDigitalThreadSnapshot(workspaceDir: string): Promise<DigitalThreadSnapshot> {
  const document = await loadOrCreateDigitalThread(workspaceDir)
  return { document, source: `${JSON.stringify(document, null, 2)}\n` }
}

/** Writes a previously captured digital-thread state into an immutable run. */
export async function snapshotDigitalThreadForRun(workspaceDir: string, runDir: string, snapshot?: DigitalThreadSnapshot) {
  const captured = snapshot ?? await captureDigitalThreadSnapshot(workspaceDir)
  const { document, source } = captured
  const fileName = "satellite.digital-thread.json"
  await fs.writeFile(path.join(runDir, fileName), source, "utf8")
  const sha256 = crypto.createHash("sha256").update(source).digest("hex")
  const manifestPath = path.join(runDir, "run_manifest.json")
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Record<string, unknown>
  manifest.digitalThread = { file: fileName, revision: document.digital_thread.revision, schemaVersion: document.schema_version, sha256, threadId: document.digital_thread.thread_id }
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  return { fileName, sha256 }
}

function extractResponseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") return (payload as { output_text: string }).output_text.trim()
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const texts: string[] = []
  for (const item of Array.isArray(output) ? output : []) for (const part of Array.isArray(item && typeof item === "object" ? (item as { content?: unknown }).content : undefined) ? (item as { content: unknown[] }).content : []) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") texts.push((part as { text: string }).text)
  return texts.join("\n").trim()
}

export async function updateDigitalThreadWithLlm({ connection, message, workspaceDir, fetchImpl = fetch }: { connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">; message: string; workspaceDir: string; fetchImpl?: typeof fetch }) {
  const document = await loadOrCreateDigitalThread(workspaceDir)
  const allowedPaths = leafPaths(document).filter(fieldPath => fieldPath.startsWith("satellite.") || fieldPath.startsWith("analysis_requests."))
  const prompt = [
    "You update a spacecraft digital-thread JSON document from an engineer message.",
    "Never invent engineering values. Record only facts explicitly supplied or unambiguously stated by the engineer.",
    "Return JSON only: {\"message\":\"short response\",\"updates\":[{\"path\":\"allowed.path\",\"value\":valid JSON value}]}",
    "Use only paths from the allowed list. Do not calculate orbital conversions, power, or other derived values; deterministic adapters do that.",
    "The default Simu-CIC attitude is nadir_pointing. Use ground_station_tracking only when the engineer explicitly asks to point at one or more predefined stations; it must fall back to nadir when none are visible.",
    "When setting one or more ground_station_ids, also set attitude_mode to ground_station_tracking and simultaneous_visibility_policy to first_visible_station_wins.",
    "For analysis_requests.simu_cic.attitude_mode, use only nadir_pointing or ground_station_tracking.",
    "For analysis_requests.simu_cic.ground_station_ids, use an array containing only predefined IDs. Do not create stations or coordinates.",
    `Predefined Simu-CIC ground stations: ${PREDEFINED_GROUND_STATIONS.map(station => `${station.id} (${station.name})`).join(", ")}.`,
    "If the engineer asks for available ground stations, answer with the matching predefined name(s) and ID(s) in message and return an empty updates array.",
    "For analysis_requests.simu_cic.simultaneous_visibility_policy, use only null or first_visible_station_wins.",
    `Allowed paths: ${allowedPaths.join(", ")}`,
    `Current digital thread: ${JSON.stringify(document)}`,
    `Engineer message: ${message}`,
  ].join("\n\n")
  const response = await fetchImpl(`${connection.baseUrl.replace(/\/+$/u, "")}/responses`, { method: "POST", headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: connection.model, input: prompt, max_output_tokens: 1400 }), signal: AbortSignal.timeout(60_000) })
  const body = await response.text()
  if (!response.ok) throw new Error(`digital-thread LLM update failed: HTTP ${response.status}`)
  let payload: unknown
  try { payload = JSON.parse(body) } catch { throw new Error("digital-thread LLM response is invalid JSON") }
  const source = extractResponseText(payload).replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "")
  const patch = JSON.parse(source) as { message?: unknown; updates?: unknown }
  if (!Array.isArray(patch.updates)) throw new Error("digital-thread LLM response has no updates array")
  const provenance = asObject(document.provenance.values) ?? {}
  document.provenance.values = provenance
  for (const item of patch.updates) {
    const update = item && typeof item === "object" ? item as { path?: unknown; value?: unknown } : null
    if (!update || typeof update.path !== "string" || !allowedPaths.includes(update.path)) throw new Error("digital-thread LLM response references an unknown path")
    if (!isJsonValue(update.value)) throw new Error(`invalid digital-thread value for ${update.path}`)
    setAtPath(document, update.path, update.value)
    provenance[update.path] = { source: "engineer_message", recorded_at: new Date().toISOString() }
  }
  const simuCicRequest = asObject(document.analysis_requests.simu_cic)
  if (!simuCicRequest) throw new Error("Simu-CIC request is missing from the digital thread")
  assertValidSimuCicRequest(simuCicRequest)
  await saveDigitalThread(workspaceDir, document)
  return { document, message: typeof patch.message === "string" ? patch.message.trim() : "Digital thread updated." }
}

export { getAtPath, setAtPath }
