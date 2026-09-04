import crypto from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { PREDEFINED_GROUND_STATIONS, assertValidSimuCicRequest } from "../opalis/groundStationCatalog.js"
import { gmatTemplateDefinition, type GmatTemplateId } from "../gmat/templateRegistry.js"
import { isMissionRunWorkspacePath, missionRunDirectory } from "../runs/runWorkspace.js"
import { assertValidDigitalThreadDocument } from "./digitalThreadSchema.js"
import { updateJsonFile, writeTextAtomically } from "../shared/atomicPersistence.js"

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

/** Physical or electrical parameters that an engineer may vary for one
 * mission discussion.  They are deliberately written only to that run's
 * satellite.json; the satellite-library definition stays immutable. */
export const SATELLITE_RUN_OVERRIDE_PATHS = [
  "satellite.bus.physical.mass_kg.dry",
  "satellite.bus.physical.drag_area_m2",
  "satellite.bus.physical.drag_coefficient",
  "satellite.bus.propulsion_subsystem.specific_impulse_seconds",
  "satellite.bus.propulsion_subsystem.electric_thruster.propellant_mass_kg",
  "satellite.bus.propulsion_subsystem.electric_thruster.minimum_usable_power_kw",
  "satellite.bus.propulsion_subsystem.electric_thruster.maximum_usable_power_kw",
  "satellite.bus.electrical_subsystem.solar_panels.total_area_m2",
  "satellite.bus.electrical_subsystem.solar_panels.efficiency_percent",
  "satellite.bus.electrical_subsystem.solar_panels.total_power_generated_watts",
  "satellite.bus.electrical_subsystem.spacecraft_bus_load_kw",
  "satellite.bus.electrical_subsystem.electric_propulsion_mode.bus_load_kw",
  "satellite.bus.electrical_subsystem.system_margin_percent",
  "satellite.bus.opalis.power_distribution.consumption_mode",
  "satellite.bus.opalis.power_distribution.constant_load_w",
  "satellite.bus.opalis.power_distribution.margin_w",
  "satellite.bus.opalis.power_distribution.rated_power_w",
  "satellite.bus.opalis.battery.initial_state_of_charge",
  "satellite.bus.opalis.battery.initial_voltage_v",
] as const

export function digitalThreadPath(workspaceDir: string) {
  return path.join(path.resolve(workspaceDir), "satellite.json")
}

function satelliteRevisionPath(workspaceDir: string, revision: number) {
  return path.join(path.resolve(workspaceDir), ".digital-thread-revisions", `satellite.r${String(revision).padStart(6, "0")}.json`)
}

export function planningRunWorkspaceDir(workspaceDir: string, planningRunId: string) {
  return missionRunDirectory(workspaceDir, planningRunId)
}

export function isMissionRunWorkspace(workspaceDir: string) {
  return isMissionRunWorkspacePath(workspaceDir)
}

/** A draft owns a private digital-thread workspace. GMAT artifacts remain in the
 * parent workspace, while this context prevents another draft from changing its
 * satellite or mission inputs. */
export function draftDigitalThreadWorkspaceDir(workspaceDir: string, template: GmatTemplateId, draftId: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(draftId)) throw new Error("invalid GMAT draft id")
  const root = path.resolve(workspaceDir)
  return path.join(root, ...gmatTemplateDefinition(template).draftDirectory, draftId)
}

function asObject(value: JsonValue | undefined): { [key: string]: JsonValue } | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as { [key: string]: JsonValue } : null
}

/** Keeps older workspaces compatible when mission-only orbital inputs are added. */
function ensureMissionRequestShape(document: DigitalThreadDocument) {
  let changed = false
  // Satellite-library records intentionally contain physical properties only.
  // Keep the mutable mission orbit in satellite.json, including in workspaces
  // that were created while a physical-only record replaced this object.
  const satellite = asObject(document.satellite) ?? (document.satellite = {}, document.satellite as { [key: string]: JsonValue })
  const satelliteOrbit = asObject(satellite.orbit) ?? (satellite.orbit = {}, satellite.orbit as { [key: string]: JsonValue })
  const keplerian = asObject(satelliteOrbit.keplerian_elements) ?? (satelliteOrbit.keplerian_elements = {}, satelliteOrbit.keplerian_elements as { [key: string]: JsonValue })
  const orbitDefaults: Record<string, JsonValue> = {
    reference_epoch_utc: null,
    reference_epoch_tai_mod_julian: null,
    central_body: "Earth",
    reference_frame: "EarthMJ2000Eq",
  }
  for (const [field, defaultValue] of Object.entries(orbitDefaults)) {
    if (!(field in satelliteOrbit)) { satelliteOrbit[field] = defaultValue; changed = true }
  }
  for (const field of ["semi_major_axis_km", "eccentricity", "inclination_deg", "raan_deg", "arg_of_perigee_deg", "true_anomaly_deg", "mean_anomaly_deg"]) {
    if (!(field in keplerian)) { keplerian[field] = null; changed = true }
  }
  const analysis = document.analysis_requests
  const gmat = asObject(analysis.gmat) ?? (analysis.gmat = {}, analysis.gmat as { [key: string]: JsonValue })
  for (const template of ["orbit_keeping", "electric_propulsion_transfer", "chemical_hohmann_transfer", "chemical_3d_transfer"]) {
    const request = asObject(gmat[template]) ?? (gmat[template] = {}, gmat[template] as { [key: string]: JsonValue })
    const orbit = asObject(request.initial_orbit) ?? (request.initial_orbit = {}, request.initial_orbit as { [key: string]: JsonValue })
    for (const field of ["epoch_tai_mod_julian", "semi_major_axis_km", "eccentricity", "inclination_deg", "raan_deg", "arg_of_perigee_deg", "true_anomaly_deg"]) {
      if (!(field in orbit)) { orbit[field] = null; changed = true }
    }
  }
  const hohmann = asObject(gmat.chemical_hohmann_transfer)!
  const targetOrbit = asObject(hohmann.target_orbit) ?? (hohmann.target_orbit = {}, hohmann.target_orbit as { [key: string]: JsonValue })
  for (const [field, defaultValue] of Object.entries({ radius_km: null, eccentricity: 0.005 } satisfies Record<string, JsonValue>)) {
    if (!(field in targetOrbit)) { targetOrbit[field] = defaultValue; changed = true }
  }
  if (!("final_propagation_seconds" in hohmann)) { hohmann.final_propagation_seconds = 86400; changed = true }
  const simuCic = asObject(analysis.simu_cic) ?? (analysis.simu_cic = {}, analysis.simu_cic as { [key: string]: JsonValue })
  for (const [field, defaultValue] of Object.entries({
    attitude_mode: "nadir_pointing",
    ground_station_ids: [],
    simultaneous_visibility_policy: null,
  } satisfies { [key: string]: JsonValue })) {
    if (!(field in simuCic) || (field === "attitude_mode" && (simuCic[field] === null || simuCic[field] === "earth_pointing"))) { simuCic[field] = defaultValue; changed = true }
  }
  const bus = asObject(satellite.bus) ?? (satellite.bus = {}, satellite.bus as { [key: string]: JsonValue })
  const rfComlink = asObject(bus.rf_comlink) ?? (bus.rf_comlink = {}, bus.rf_comlink as { [key: string]: JsonValue })
  if (rfComlink.schema_version !== 1) { rfComlink.schema_version = 1; changed = true }
  if (!Array.isArray(rfComlink.links)) { rfComlink.links = []; changed = true }
  const rfRequest = asObject(analysis.rf_comlink) ?? (analysis.rf_comlink = {}, analysis.rf_comlink as { [key: string]: JsonValue })
  const rfDefaults: Record<string, JsonValue> = {
    requested_link_ids: [],
    selected_ground_station_id: null,
    ground_station_source: "simu_cic_attitude",
  }
  for (const [field, defaultValue] of Object.entries(rfDefaults)) {
    if (!(field in rfRequest)) { rfRequest[field] = defaultValue; changed = true }
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

function assertDocument(value: unknown): asserts value is DigitalThreadDocument { assertValidDigitalThreadDocument(value) }

async function readTemplate() {
  const parsed: unknown = JSON.parse(await fs.readFile(TEMPLATE_PATH, "utf8"))
  assertDocument(parsed)
  return parsed
}

export async function createEphemeralDigitalThread() {
  const document = await readTemplate()
  const now = new Date().toISOString()
  document.digital_thread.thread_id = crypto.randomUUID()
  document.digital_thread.created_at = now
  document.digital_thread.updated_at = now
  return document
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
  const document = await createEphemeralDigitalThread()
  ensureMissionRequestShape(document)
  await saveDigitalThread(workspaceDir, document, false)
  return document
}

/** Starts a clean, per-draft digital thread from the selected satellite only.
 * Earlier mission values deliberately do not leak into a new draft. */
export async function initializeDraftDigitalThread(workspaceDir: string, template: "orbit-keeping" | "electric-propulsion-transfer" | "chemical-hohmann-transfer" | "chemical-3d-transfer", draftId: string) {
  const draftWorkspaceDir = draftDigitalThreadWorkspaceDir(workspaceDir, template, draftId)
  const output = digitalThreadPath(draftWorkspaceDir)
  const existing = await fs.readFile(output, "utf8").catch(() => null)
  if (existing !== null) {
    const parsed: unknown = JSON.parse(existing)
    assertDocument(parsed)
    return parsed
  }
  const selected = await loadOrCreateDigitalThread(workspaceDir)
  const document = await createEphemeralDigitalThread()
  document.satellite = JSON.parse(JSON.stringify(selected.satellite)) as DigitalThreadDocument["satellite"]
  const selection = selected.digital_thread.satellite_definition
  if (selection !== undefined) document.digital_thread.satellite_definition = JSON.parse(JSON.stringify(selection)) as JsonValue
  const provenance = asObject(document.provenance.values) ?? {}
  if (selection !== undefined) provenance.satellite = { source: "satellite_library", copied_from_workspace_at: new Date().toISOString() }
  document.provenance.values = provenance
  ensureMissionRequestShape(document)
  await saveDigitalThread(draftWorkspaceDir, document, false)
  return document
}

/** Reads the immutable digital-thread snapshot belonging to an executed run. */
export async function loadRunDigitalThreadSnapshot(runDir: string) {
  const source = await fs.readFile(path.join(path.resolve(runDir), "satellite.json"), "utf8")
  const document: unknown = JSON.parse(source)
  assertDocument(document)
  return document
}

export async function saveDigitalThread(workspaceDir: string, document: DigitalThreadDocument, incrementRevision = true) {
  assertDocument(document)
  const metadata = document.digital_thread
  metadata.revision = incrementRevision ? Number(metadata.revision ?? 0) + 1 : Number(metadata.revision ?? 0)
  metadata.updated_at = new Date().toISOString()
  metadata.canonical_satellite_path = "satellite.json"
  const output = digitalThreadPath(workspaceDir)
  const source = `${JSON.stringify(document, null, 2)}\n`
  await fs.mkdir(path.dirname(output), { recursive: true })
  const temporary = `${output}.${crypto.randomUUID()}.tmp`
  await fs.writeFile(temporary, source, "utf8")
  await fs.rename(temporary, output)
  const revision = satelliteRevisionPath(workspaceDir, Number(metadata.revision ?? 0))
  await fs.mkdir(path.dirname(revision), { recursive: true })
  await fs.writeFile(revision, source, "utf8")
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
  const fileName = "satellite.json"
  await writeTextAtomically(path.join(runDir, fileName), source)
  const sha256 = crypto.createHash("sha256").update(source).digest("hex")
  const manifestPath = path.join(runDir, "run_manifest.json")
  await updateJsonFile<Record<string, unknown>>(manifestPath, {}, manifest => ({
    ...manifest,
    digitalThread: { file: fileName, revision: document.digital_thread.revision, schemaVersion: document.schema_version, sha256, threadId: document.digital_thread.thread_id },
  }))
  return { fileName, sha256 }
}

/** Applies the mutable Simu-CIC request to the selected run before Simu-CIC
 * executes. GMAT results stay intact; attitude is a downstream scenario input. */
export async function syncSimuCicRequestToRunSnapshot(runDir: string, sourceDocument: DigitalThreadDocument) {
  const outputDir = path.resolve(runDir)
  const snapshot = await loadRunDigitalThreadSnapshot(outputDir)
  snapshot.analysis_requests.simu_cic = JSON.parse(JSON.stringify(sourceDocument.analysis_requests.simu_cic)) as JsonValue
  // RF-COMLINK inherits a unique Simu-CIC target. Keep that companion request
  // in the immutable run snapshot too; otherwise RF preparation would read
  // the pre-edit station choice even though Mission Studio shows the new one.
  snapshot.analysis_requests.rf_comlink = JSON.parse(JSON.stringify(sourceDocument.analysis_requests.rf_comlink)) as JsonValue
  const provenance = asObject(snapshot.provenance.values) ?? {}
  provenance["analysis_requests.simu_cic"] = { source: "mission_discussion", synchronized_at: new Date().toISOString() }
  provenance["analysis_requests.rf_comlink"] = { source: "mission_discussion", synchronized_at: new Date().toISOString() }
  snapshot.provenance.values = provenance
  assertDocument(snapshot)
  const source = `${JSON.stringify(snapshot, null, 2)}\n`
  await writeTextAtomically(path.join(outputDir, "satellite.json"), source)
  return snapshot
}

/** Carries the current Mission Studio attitude/RF selection into a draft just
 * before GMAT snapshots it as an immutable run. Drafts keep their own GMAT
 * values, but these downstream mission requests are selected in the shared
 * workspace and may have changed after the draft was created. */
export async function syncMissionAnalysisRequestsToDraft(workspaceDir: string, draftWorkspaceDir: string) {
  const source = await loadOrCreateDigitalThread(workspaceDir)
  const draft = await loadOrCreateDigitalThread(draftWorkspaceDir)
  // A template draft is initially created with an empty digital thread.  Its
  // GMAT values belong to the draft, whereas the selected spacecraft remains
  // owned by the dated mission workspace.  Carry that definition over before
  // the immutable run snapshot is captured; otherwise downstream OPALIS and
  // RF-COMLINK see an empty satellite even though Mission V2 showed one.
  const sourceSelection = asObject(source.digital_thread.satellite_definition)
  const draftSelection = asObject(draft.digital_thread.satellite_definition)
  if (typeof sourceSelection?.id === "string" && sourceSelection.id.trim() && typeof draftSelection?.id !== "string") {
    draft.digital_thread.satellite_definition = JSON.parse(JSON.stringify(source.digital_thread.satellite_definition)) as JsonValue
    draft.satellite = JSON.parse(JSON.stringify(source.satellite)) as DigitalThreadDocument["satellite"]
    const values = asObject(draft.provenance.values) ?? {}
    values["digital_thread.satellite_definition"] = { source: "mission_workspace", synchronized_at: new Date().toISOString() }
    draft.provenance.values = values
  }
  draft.analysis_requests.simu_cic = JSON.parse(JSON.stringify(source.analysis_requests.simu_cic)) as JsonValue
  draft.analysis_requests.rf_comlink = JSON.parse(JSON.stringify(source.analysis_requests.rf_comlink)) as JsonValue
  const provenance = asObject(draft.provenance.values) ?? {}
  provenance["analysis_requests.simu_cic"] = { source: "mission_workspace", synchronized_at: new Date().toISOString() }
  provenance["analysis_requests.rf_comlink"] = { source: "mission_workspace", synchronized_at: new Date().toISOString() }
  draft.provenance.values = provenance
  return saveDigitalThread(draftWorkspaceDir, draft)
}

function extractResponseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") return (payload as { output_text: string }).output_text.trim()
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const texts: string[] = []
  for (const item of Array.isArray(output) ? output : []) for (const part of Array.isArray(item && typeof item === "object" ? (item as { content?: unknown }).content : undefined) ? (item as { content: unknown[] }).content : []) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") texts.push((part as { text: string }).text)
  return texts.join("\n").trim()
}

function explicitSimuCicConfiguration(message: string) {
  const normalizedMessage = message.toLocaleLowerCase()
  const groundStationIds = PREDEFINED_GROUND_STATIONS
    .filter(station => normalizedMessage.includes(station.id.toLocaleLowerCase()) || normalizedMessage.includes(station.name.toLocaleLowerCase()))
    .map(station => station.id)
  const requestsTracking = /\b(?:follow|track|suiv\w*|point\w*)\b/iu.test(message)
  const requestsNadir = /\b(?:nadir|earth[ -]?(?:pointing|tracking)|point(?:age)?\s+(?:vers\s+)?(?:la\s+)?terre)\b/iu.test(message)
  if (groundStationIds.length && requestsTracking) {
    return { attitude_mode: "ground_station_tracking" as const, ground_station_ids: groundStationIds, simultaneous_visibility_policy: "first_visible_station_wins" as const }
  }
  if (requestsNadir && !groundStationIds.length) {
    return { attitude_mode: "nadir_pointing" as const, ground_station_ids: [], simultaneous_visibility_policy: null }
  }
  return null
}

/** Apply a simple, explicitly stated attitude command without involving the
 * LLM. This is also used for mixed mission messages: a single turn may define
 * both a GMAT orbit and a Simu-CIC attitude request. */
export async function applyExplicitSimuCicConfiguration(workspaceDir: string, message: string) {
  const request = explicitSimuCicConfiguration(message)
  if (!request) return null
  const document = await loadOrCreateDigitalThread(workspaceDir)
  document.analysis_requests.simu_cic = request
  synchronizeRfGroundStationChoice(document)
  const provenance = asObject(document.provenance.values) ?? {}
  provenance["analysis_requests.simu_cic"] = { source: "engineer_message", recorded_at: new Date().toISOString() }
  document.provenance.values = provenance
  assertValidSimuCicRequest(request)
  await saveDigitalThread(workspaceDir, document)
  const behavior = request.attitude_mode === "nadir_pointing"
    ? "nadir pointing"
    : `ground-station tracking for ${request.ground_station_ids.join(", ")} (nadir fallback when no station is visible)`
  return { document, message: `Recorded Simu-CIC attitude behavior: ${behavior}.` }
}

/** Keep the RF target synchronized with an unambiguous Simu-CIC request.
 * With multiple tracked stations, the RF selection remains a deliberate
 * follow-up decision; with one station there is no second value to ask for. */
function synchronizeRfGroundStationChoice(document: DigitalThreadDocument) {
  const simuCic = asObject(document.analysis_requests.simu_cic)
  const rfComlink = asObject(document.analysis_requests.rf_comlink) ?? {}
  const stationIds = Array.isArray(simuCic?.ground_station_ids) && simuCic.ground_station_ids.every(value => typeof value === "string")
    ? simuCic.ground_station_ids as string[]
    : []
  if (simuCic?.attitude_mode === "ground_station_tracking" && stationIds.length === 1) {
    rfComlink.selected_ground_station_id = stationIds[0]
  } else if (simuCic?.attitude_mode === "nadir_pointing") {
    rfComlink.selected_ground_station_id = null
  }
  document.analysis_requests.rf_comlink = rfComlink
}

export async function updateDigitalThreadWithLlm({ connection, message, workspaceDir, allowedPaths: requestedAllowedPaths, fetchImpl = fetch }: { connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">; message: string; workspaceDir: string; allowedPaths?: readonly string[]; fetchImpl?: typeof fetch }) {
  const document = await loadOrCreateDigitalThread(workspaceDir)
  const explicitSimuCicRequest = explicitSimuCicConfiguration(message)
  if (explicitSimuCicRequest) {
    return (await applyExplicitSimuCicConfiguration(workspaceDir, message))!
  }
  const documentPaths = new Set(leafPaths(document))
  const allowedPaths = requestedAllowedPaths
    ? requestedAllowedPaths.filter(fieldPath => documentPaths.has(fieldPath))
    : [...documentPaths].filter(fieldPath => fieldPath.startsWith("satellite.") || fieldPath.startsWith("analysis_requests."))
  if (!allowedPaths.length) throw new Error("no writable digital-thread paths are available for this request")
  const prompt = [
    "You update a spacecraft digital-thread JSON document from an engineer message.",
    "Never invent engineering values. Record only facts explicitly supplied or unambiguously stated by the engineer.",
    requestedAllowedPaths ? "This is a run-specific satellite override. Update only the allowed fields below. Never update the satellite-library definition." : "",
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
  // A station/attitude request is safety-critical for the downstream
  // simulation. Do not rely solely on a probabilistic LLM patch for simple,
  // explicit commands supported by the UI.
  const simuCicRequest = asObject(document.analysis_requests.simu_cic)
  if (!simuCicRequest) throw new Error("Simu-CIC request is missing from the digital thread")
  assertValidSimuCicRequest(simuCicRequest)
  synchronizeRfGroundStationChoice(document)
  await saveDigitalThread(workspaceDir, document)
  return { document, message: typeof patch.message === "string" ? patch.message.trim() : "Digital thread updated." }
}

export { getAtPath, setAtPath }
