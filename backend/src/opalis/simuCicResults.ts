/**
 * Role: Parses Simu-CIC CIC files and computes attitude/eclipse/contact metrics.
 * Exports: parseCicScalar, activeDuration, contactLatencyMs, loadSimuCicResultMetrics, loadSimuCicResultSummary.
 * Dependencies: none.
 * Invariant: CIC parsing is strict — malformed files throw rather than return partial data.
 */
import fs from "node:fs/promises"
import path from "node:path"

import { loadRunWorkflowLog } from "./workflowRunLog.js"

const SIMU_CIC_DIR = path.join("opalis", "02-simu-cic")
const CIC_OUTPUT_DIR = path.join(SIMU_CIC_DIR, "02-fichiers-cic")
const SPEED_OF_LIGHT_KM_PER_MS = 299.792458
const SECONDS_PER_MINUTE = 60

export type CicSample = { time: number; value: number }
export type MetricEntry = { value: string; source: string }

// ─── CIC parsing ──────────────────────────────────────────────────────────────

/**
 * Parses a CIC scalar file (META_STOP header, then date/seconds/value rows).
 * Supports both MJD format ("61262 60 1") and ISO 8601 format ("2026-08-10T00:01:00Z 1").
 * Returns samples with relative time in seconds from the first row.
 * Throws on: missing META_STOP, fewer than 2 data rows, duplicate timestamps, NaN values.
 */
export function parseCicScalar(text: string): CicSample[] {
  const lines = text.split(/\r?\n/u)
  const metaIndex = lines.findIndex(line => line.trim() === "META_STOP")
  if (metaIndex === -1) throw new Error("CIC file missing META_STOP marker")
  const dataLines = lines.slice(metaIndex + 1).filter(line => line.trim())
  if (dataLines.length < 2) throw new Error("CIC file needs at least two data rows")

  const samples: CicSample[] = []
  let firstAbsoluteTime: number | null = null

  for (const line of dataLines) {
    const parts = line.trim().split(/\s+/u)
    if (parts.length < 2) throw new Error(`Malformed CIC row: ${line}`)

    let absoluteTime: number
    let value: number

    const firstToken = Number(parts[0])
    if (parts.length >= 3 && Number.isFinite(firstToken) && Number.isInteger(firstToken)) {
      // MJD format: "61262 60 1"
      const secondsInDay = Number(parts[1])
      value = Number(parts[2])
      if (!Number.isFinite(secondsInDay)) throw new Error(`CIC seconds not numeric: ${parts[1]}`)
      absoluteTime = firstToken * 86400 + secondsInDay
    } else {
      // ISO 8601 format: "2026-08-10T00:01:00Z 1" or "2026-08-10T00:00:00 0"
      const dateStr = parts[0]
      // Normalize: dates without timezone suffix are treated as UTC
      const hasTimezone = /[zZ]$|[+-]\d{2}:?\d{2}$/u.test(dateStr)
      const normalized = hasTimezone ? dateStr : `${dateStr}Z`
      const parsedDate = new Date(normalized)
      if (Number.isNaN(parsedDate.getTime())) throw new Error(`Unparseable CIC date: ${parts[0]}`)
      absoluteTime = parsedDate.getTime() / 1000
      value = Number(parts[1])
    }

    if (!Number.isFinite(value)) throw new Error(`CIC value is not finite: ${parts.at(-1)}`)

    if (firstAbsoluteTime === null) firstAbsoluteTime = absoluteTime
    samples.push({ time: absoluteTime - firstAbsoluteTime, value })
  }

  for (let i = 1; i < samples.length; i++) {
    if (samples[i].time === samples[i - 1].time) {
      throw new Error(`Duplicate CIC timestamp at relative time ${samples[i].time}`)
    }
  }

  return samples
}

// ─── Derived metrics from CIC samples ──────────────────────────────────────────

/** Computes the total duration (in seconds) where the predicate is true, using step-forward integration. */
export function activeDuration(samples: CicSample[], predicate: (value: number) => boolean): number {
  if (samples.length < 2) return 0
  let total = 0
  for (let i = 1; i < samples.length; i++) {
    if (predicate(samples[i - 1].value)) {
      total += samples[i].time - samples[i - 1].time
    }
  }
  return total
}

function interpolateValue(samples: CicSample[], time: number): number | null {
  if (samples.length === 0) return null
  if (time <= samples[0].time) return samples[0].value
  if (time >= samples.at(-1)!.time) return samples.at(-1)!.value
  for (let i = 1; i < samples.length; i++) {
    if (time >= samples[i - 1].time && time <= samples[i].time) {
      const fraction = (time - samples[i - 1].time) / (samples[i].time - samples[i - 1].time)
      return samples[i - 1].value + (samples[i].value - samples[i - 1].value) * fraction
    }
  }
  return null
}

/**
 * Computes the time-weighted average one-way latency (in ms) over contact periods.
 * Contact is defined as visibility value > 0. Distance is linearly interpolated at interval midpoints.
 * Returns null when there is no contact. Throws when the distance series starts after the visibility series.
 */
export function contactLatencyMs(visibility: CicSample[], distances: CicSample[]): number | null {
  if (distances.length < 2) throw new Error("Distance series needs at least two samples")
  if (visibility.length < 2) return null
  if (distances[0].time > visibility[0].time) {
    throw new Error("Distance series must start at or before the visibility series")
  }

  let totalLatencyWeighted = 0
  let totalContactDuration = 0

  for (let i = 1; i < visibility.length; i++) {
    if (visibility[i - 1].value > 0) {
      const dt = visibility[i].time - visibility[i - 1].time
      if (dt <= 0) continue
      const midTime = (visibility[i].time + visibility[i - 1].time) / 2
      const distance = interpolateValue(distances, midTime)
      if (distance !== null) {
        totalLatencyWeighted += (distance / SPEED_OF_LIGHT_KM_PER_MS) * dt
        totalContactDuration += dt
      }
    }
  }

  if (totalContactDuration === 0) return null
  return totalLatencyWeighted / totalContactDuration
}

// ─── File discovery ────────────────────────────────────────────────────────────

async function findCicFile(runDir: string, pattern: RegExp): Promise<string | null> {
  const root = path.join(runDir, CIC_OUTPUT_DIR)
  const entries = await fs.readdir(root, { recursive: true }).catch(() => [] as string[])
  const files = entries.filter((entry): entry is string => typeof entry === "string")
  const match = files.find(file => pattern.test(path.basename(file)))
  return match ? path.join(root, match) : null
}

async function readCicFile(runDir: string, pattern: RegExp): Promise<string | null> {
  const filePath = await findCicFile(runDir, pattern)
  if (!filePath) return null
  return fs.readFile(filePath, "utf8")
}

// ─── Run-level metrics (used by runViewModel) ──────────────────────────────────

function metric(value: string, source: string): MetricEntry {
  return { value, source }
}

function waitingMetrics(status: string): Record<string, MetricEntry> {
  const label = status === "failed" ? "Unavailable" : "Waiting for Simu-CIC"
  const source = "workflow-status"
  return {
    contactTime: metric(label, source),
    latency: metric(label, source),
    eclipseTime: metric(label, source),
  }
}

type GroundStation = { id: string }

function extractGroundStations(definition: unknown): GroundStation[] {
  const attitude = (definition as Record<string, unknown> | null)?.attitude
  if (!attitude || typeof attitude !== "object" || Array.isArray(attitude)) return []
  const stations = (attitude as Record<string, unknown>).ground_stations
  if (!Array.isArray(stations)) return []
  return stations
    .filter((s): s is Record<string, unknown> => typeof s === "object" && s !== null && !Array.isArray(s))
    .map(s => ({ id: typeof s.id === "string" ? s.id : "unknown" }))
    .filter(s => s.id !== "unknown")
}

/**
 * Loads run-level Simu-CIC metrics: contact time per station, latency per station, and total eclipse time.
 * Returns formatted strings suitable for the overview panel. Respects workflow status.
 */
export async function loadSimuCicResultMetrics(
  runDir: string,
  simuCicStatus: string,
): Promise<Record<string, MetricEntry>> {
  if (simuCicStatus !== "completed") return waitingMetrics(simuCicStatus)

  const definitionPath = path.join(runDir, SIMU_CIC_DIR, "simucic.definition.json")
  const definitionSource = await fs.readFile(definitionPath, "utf8").catch(() => null)
  if (!definitionSource) return waitingMetrics("failed")
  const definition = JSON.parse(definitionSource) as unknown
  const stations = extractGroundStations(definition)

  // Eclipse
  const eclipseText = await readCicFile(runDir, /SATELLITE_ECLIPSE/iu)
  let eclipseValue = "Unavailable"
  let eclipseSource = "Simu-CIC eclipse file"
  if (eclipseText) {
    try {
      const samples = parseCicScalar(eclipseText)
      const durationSec = activeDuration(samples, v => v > 0)
      eclipseValue = `${(durationSec / SECONDS_PER_MINUTE).toFixed(2)} min`
    } catch {
      eclipseValue = "Unavailable"
    }
  }

  // Per-station contact + latency
  const contactParts: string[] = []
  const latencyParts: string[] = []
  const contactSource = "Simu-CIC visibility files"
  const latencySource = "Simu-CIC distance files"

  if (stations.length === 0) {
    return {
      contactTime: metric("Not applicable", contactSource),
      latency: metric("Not applicable", latencySource),
      eclipseTime: metric(eclipseValue, eclipseSource),
    }
  }

  for (let i = 0; i < stations.length; i++) {
    const stationId = stations[i].id
    const stationNum = i + 1
    const visibilityText = await readCicFile(runDir, new RegExp(`GEOMETRICAL_VISIBILITY_GROUND_STATION_${stationNum}`, "iu"))
    const distanceText = await readCicFile(runDir, new RegExp(`DISTANCE_GROUND_STATION_${stationNum}`, "iu"))

    let contactValue: string
    let latencyValue: string

    if (!visibilityText) {
      contactValue = "Unavailable"
      latencyValue = "Unavailable"
    } else {
      try {
        const visibilitySamples = parseCicScalar(visibilityText)
        const contactSec = activeDuration(visibilitySamples, v => v > 0)
        if (contactSec === 0) {
          contactValue = `${stationId}: No contact`
        } else {
          contactValue = `${stationId}: ${(contactSec / SECONDS_PER_MINUTE).toFixed(2)} min`
        }

        if (!distanceText || contactSec === 0) {
          latencyValue = contactSec === 0 ? `${stationId}: No contact` : `${stationId}: Unavailable`
        } else {
          try {
            const distanceSamples = parseCicScalar(distanceText)
            const oneWayMs = contactLatencyMs(visibilitySamples, distanceSamples)
            if (oneWayMs === null) {
              latencyValue = `${stationId}: No contact`
            } else {
              latencyValue = `${stationId}: ${oneWayMs.toFixed(2)} / ${(oneWayMs * 2).toFixed(2)} ms`
            }
          } catch {
            latencyValue = `${stationId}: Unavailable`
          }
        }
      } catch {
        contactValue = `${stationId}: Unavailable`
        latencyValue = `${stationId}: Unavailable`
      }
    }

    contactParts.push(contactValue)
    latencyParts.push(latencyValue)
  }

  return {
    contactTime: metric(contactParts.join("; "), contactSource),
    latency: metric(latencyParts.join("; "), latencySource),
    eclipseTime: metric(eclipseValue, eclipseSource),
  }
}

// ─── Consolidated summary (used by consolidatedRunReport) ──────────────────────

export type SimuCicResultSummary = {
  attitude_mode: string | null
  calculation: {
    eclipse: { duration_seconds: number | null; source_file: string | null }
    method: {
      contact_duration: "step-forward integration where visibility > 0"
      latency: "contact-duration-weighted distance/c with linear midpoint interpolation"
    }
    stations: Array<{
      contact_duration_seconds: number | null
      distance_source_file: string | null
      one_way_latency_ms: number | null
      round_trip_latency_ms: number | null
      station_id: string
      visibility_source_file: string | null
    }>
    workflow_status: string
  }
  ground_station_ids: string[]
  eclipse_time: MetricEntry
  contact_time: MetricEntry
  latency: MetricEntry
  generated_files: Array<{ source_file: string; numeric_rows: number }>
  generated_file_count: number
  schema_version: number
}

function relativeSource(runDir: string, filePath: string | null) {
  return filePath ? path.relative(runDir, filePath).split(path.sep).join("/") : null
}

/** Computes numeric CIC evidence for export. Display formatting remains in
 * loadSimuCicResultMetrics so the report never needs to parse UI strings. */
async function calculateSimuCicEvidence(runDir: string, status: string, stations: GroundStation[]) {
  const unavailable = {
    eclipse: { duration_seconds: null, source_file: null },
    method: {
      contact_duration: "step-forward integration where visibility > 0" as const,
      latency: "contact-duration-weighted distance/c with linear midpoint interpolation" as const,
    },
    stations: stations.map(station => ({
      contact_duration_seconds: null,
      distance_source_file: null,
      one_way_latency_ms: null,
      round_trip_latency_ms: null,
      station_id: station.id,
      visibility_source_file: null,
    })),
    workflow_status: status,
  }
  if (status !== "completed") return unavailable

  const eclipsePath = await findCicFile(runDir, /SATELLITE_ECLIPSE/iu)
  let eclipseDuration: number | null = null
  if (eclipsePath) {
    try { eclipseDuration = activeDuration(parseCicScalar(await fs.readFile(eclipsePath, "utf8")), value => value > 0) } catch { /* unavailable evidence stays null */ }
  }
  const calculatedStations = await Promise.all(stations.map(async (station, index) => {
    const stationNumber = index + 1
    const visibilityPath = await findCicFile(runDir, new RegExp(`GEOMETRICAL_VISIBILITY_GROUND_STATION_${stationNumber}`, "iu"))
    const distancePath = await findCicFile(runDir, new RegExp(`DISTANCE_GROUND_STATION_${stationNumber}`, "iu"))
    let contactDuration: number | null = null
    let oneWayLatency: number | null = null
    if (visibilityPath) {
      try {
        const visibility = parseCicScalar(await fs.readFile(visibilityPath, "utf8"))
        contactDuration = activeDuration(visibility, value => value > 0)
        if (distancePath && contactDuration > 0) {
          const distances = parseCicScalar(await fs.readFile(distancePath, "utf8"))
          oneWayLatency = contactLatencyMs(visibility, distances)
        }
      } catch { /* keep this station's unavailable values isolated */ }
    }
    return {
      contact_duration_seconds: contactDuration,
      distance_source_file: relativeSource(runDir, distancePath),
      one_way_latency_ms: oneWayLatency,
      round_trip_latency_ms: oneWayLatency === null ? null : oneWayLatency * 2,
      station_id: station.id,
      visibility_source_file: relativeSource(runDir, visibilityPath),
    }
  }))
  return {
    eclipse: { duration_seconds: eclipseDuration, source_file: relativeSource(runDir, eclipsePath) },
    method: unavailable.method,
    stations: calculatedStations,
    workflow_status: status,
  }
}

/**
 * Loads a compact summary of the Simu-CIC results: definition info + metrics + file inventory.
 * Returns null when the Simu-CIC definition is absent so the consolidated report degrades gracefully.
 */
export async function loadSimuCicResultSummary(runDir: string): Promise<SimuCicResultSummary | null> {
  const definitionPath = path.join(runDir, SIMU_CIC_DIR, "simucic.definition.json")
  const source = await fs.readFile(definitionPath, "utf8").catch(() => null)
  if (!source) return null
  const definition = JSON.parse(source) as Record<string, unknown> | null
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null

  const stations = extractGroundStations(definition)
  const groundStationIds = stations.map(s => s.id)
  const attitudeMode = typeof definition.attitude_mode === "string" ? definition.attitude_mode : null

  // Load metrics using the actual workflow status
  const workflow = await loadRunWorkflowLog(runDir)
  const simuCicStatus = workflow.stages.simu_cic.status
  const [metrics, calculation] = await Promise.all([
    loadSimuCicResultMetrics(runDir, simuCicStatus),
    calculateSimuCicEvidence(runDir, simuCicStatus, stations),
  ])

  // Inventory generated CIC files
  const outputRoot = path.join(runDir, CIC_OUTPUT_DIR)
  const entries = await fs.readdir(outputRoot, { recursive: true }).catch(() => [] as string[])
  const files = entries.filter((entry): entry is string => typeof entry === "string" && /\.(?:txt|cic)$/iu.test(entry))

  const generatedFiles: SimuCicResultSummary["generated_files"] = []
  for (const relative of files.slice(0, 30)) {
    const fileContent = await fs.readFile(path.join(outputRoot, relative), "utf8").catch(() => "")
    const numericRows = fileContent.split(/\r?\n/u).filter(line => /^\s*[-+]?\d/u.test(line)).length
    generatedFiles.push({
      source_file: path.join(CIC_OUTPUT_DIR, relative).split(path.sep).join("/"),
      numeric_rows: numericRows,
    })
  }

  return {
    attitude_mode: attitudeMode,
    calculation,
    ground_station_ids: groundStationIds,
    eclipse_time: metrics.eclipseTime,
    contact_time: metrics.contactTime,
    latency: metrics.latency,
    generated_files: generatedFiles,
    generated_file_count: files.length,
    schema_version: 1,
  }
}
