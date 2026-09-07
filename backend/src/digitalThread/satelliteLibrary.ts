import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { type JsonValue, loadOrCreateDigitalThread, saveDigitalThread } from "./digitalThreadStore.js"

type JsonRecord = { [key: string]: JsonValue }
export type SatelliteDefinition = { id: string; version: string; name: string; description: string; capabilities: string[]; mission_templates: string[]; satellite: JsonRecord; analysis_requests?: JsonRecord }

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url))
const LIBRARY_DIR = path.resolve(SOURCE_DIR, "../../../data/satellite-library")

function isRecord(value: JsonValue | undefined): value is JsonRecord { return Boolean(value) && typeof value === "object" && !Array.isArray(value) }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T }
function merge(target: JsonRecord, source: JsonRecord) {
  for (const [key, value] of Object.entries(source)) target[key] = isRecord(value) && isRecord(target[key]) ? merge(target[key] as JsonRecord, value) : clone(value)
  return target
}
function validDefinition(value: unknown): value is SatelliteDefinition {
  const candidate = value as Partial<SatelliteDefinition> | null
  return Boolean(candidate && typeof candidate.id === "string" && typeof candidate.version === "string" && typeof candidate.name === "string" && typeof candidate.description === "string" && Array.isArray(candidate.capabilities) && Array.isArray(candidate.mission_templates) && candidate.satellite && typeof candidate.satellite === "object")
}

export async function listSatelliteDefinitions() {
  const files = (await fs.readdir(LIBRARY_DIR)).filter(file => file.endsWith(".json"))
  const definitions = await Promise.all(files.map(async file => JSON.parse(await fs.readFile(path.join(LIBRARY_DIR, file), "utf8")) as unknown))
  if (!definitions.every(validDefinition)) throw new Error("satellite library contains an invalid definition")
  return definitions.sort((left, right) => left.name.localeCompare(right.name))
}

export async function getSatelliteDefinition(id: string, version?: string) {
  const definition = (await listSatelliteDefinitions()).find(item => item.id === id && (!version || item.version === version))
  if (!definition) throw new Error("satellite definition was not found")
  return definition
}

export async function selectSatelliteDefinition(workspaceDir: string, id: string, version?: string) {
  const definition = await getSatelliteDefinition(id, version)
  const document = await loadOrCreateDigitalThread(workspaceDir)
  // A new satellite is a replacement of the physical source of truth.  A
  // deep merge left propulsion or power fields from the previously selected
  // satellite behind, which could create an impossible hybrid spacecraft.
  const activeMissionOrbit = isRecord(document.satellite.orbit) ? clone(document.satellite.orbit) : undefined
  document.satellite = clone(definition.satellite)
  // A library record must not define an orbit, but satellite.json does: it is
  // the current mission state shared with GMAT, Simu-CIC, and later tools.
  // Preserve that mutable mission state while replacing the physical vehicle.
  if (activeMissionOrbit) document.satellite.orbit = activeMissionOrbit
  if (definition.analysis_requests) merge(document.analysis_requests, definition.analysis_requests)
  document.digital_thread.satellite_definition = { id: definition.id, version: definition.version, selected_at: new Date().toISOString() }
  const provenance = (document.provenance.values && typeof document.provenance.values === "object" && !Array.isArray(document.provenance.values)) ? document.provenance.values as JsonRecord : {}
  provenance["satellite"] = { source: "satellite_library", definition_id: definition.id, version: definition.version, recorded_at: new Date().toISOString() }
  document.provenance.values = provenance
  await saveDigitalThread(workspaceDir, document)
  return { definition, document }
}
