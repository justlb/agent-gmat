import fs from "node:fs/promises"
import path from "node:path"
import { loadRunWorkflowLog, type WorkflowRunLog } from "../opalis/workflowRunLog.js"
import { resolveMissionWorkspace } from "../gmat/missionWorkspace.js"
import { isGmatTemplateId, gmatTemplateDefinition } from "../gmat/templateRegistry.js"
import { MISSION_RUN_ID_PATTERN, resolveMissionRun } from "./runWorkspace.js"

const stages = ["gmat", "simu_cic", "opalis", "rf_comlink"] as const

/** Each GMAT scenario writes one normalized series. Selecting it from the
 * manifest prevents a stale artifact from a different scenario driving charts. */
const TIME_SERIES_FILE_BY_TEMPLATE: Record<string, string> = {
  "chemical-hohmann-transfer": "chemical_hohmann_timeseries.json",
  "electric-propulsion-transfer": "electric_transfer_timeseries.json",
  "electrical-leo-orbit-maintenance": "electric_transfer_timeseries.json",
  "orbit-keeping": "orbit_timeseries.json",
}

type OrbitChartSample = { altitudeKm: number; elapsedDays: number }
const EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_S2 = 398600.4418

/** Keep tank observations in the chart payload without letting their sparse
 * post-reboost altitudes distort the dense OEM altitude polyline. */
function orbitReportForCharts(sample: unknown): Record<string, unknown> | null {
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) return null
  const { altitudeKm: _altitudeKm, ...values } = sample as Record<string, unknown>
  const seconds = typeof values.elapsedSeconds === "number"
    ? values.elapsedSeconds
    // Compatibility with reports generated before the column was named.
    : typeof values.epochA1ModJulian === "number" ? values.epochA1ModJulian : null
  return typeof values.elapsedDays === "number"
    ? values
    : seconds !== null && Number.isFinite(seconds) ? { ...values, elapsedDays: seconds / 86_400 } : values
}

/** Extracts the orbital altitude from the position records in GMAT's CCSDS
 * OEM. OrbitAnalysisReport is written only after reboost events, while the
 * OEM records the full propagated trajectory needed for a readable curve. */
export function parseOrbitKeepingOem(source: string): OrbitChartSample[] {
  const parsed: Array<{ altitudeKm: number; instantMs: number }> = []
  for (const line of source.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u)
    if (fields.length < 4 || !/^\d{4}-\d{2}-\d{2}T/u.test(fields[0])) continue
    const instantMs = Date.parse(`${fields[0]}Z`)
    const [x, y, z] = fields.slice(1, 4).map(Number)
    if (!Number.isFinite(instantMs) || ![x, y, z].every(Number.isFinite)) continue
    parsed.push({
      instantMs,
      altitudeKm: Math.hypot(x, y, z) - 6378.1363,
    })
  }
  const firstInstantMs = parsed[0]?.instantMs
  return firstInstantMs === undefined
    ? []
    : parsed.map(sample => ({ altitudeKm: sample.altitudeKm, elapsedDays: (sample.instantMs - firstInstantMs) / 86_400_000 }))
}

/** Estimates completed revolutions from GMAT OEM position/velocity records.
 * The estimate uses the median osculating Keplerian period, making it stable
 * across the individual OEM segments emitted around finite maneuvers. */
export function estimateOemRevolutions(source: string): number | null {
  const records: Array<{ instantMs: number; periodSeconds: number }> = []
  for (const line of source.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u)
    if (fields.length < 7 || !/^\d{4}-\d{2}-\d{2}T/u.test(fields[0])) continue
    const instantMs = Date.parse(`${fields[0]}Z`)
    const [x, y, z, vx, vy, vz] = fields.slice(1, 7).map(Number)
    const radius = Math.hypot(x, y, z)
    const speedSquared = vx * vx + vy * vy + vz * vz
    const reciprocalAxis = (2 / radius) - (speedSquared / EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_S2)
    if (!Number.isFinite(instantMs) || !Number.isFinite(reciprocalAxis) || reciprocalAxis <= 0) continue
    const semiMajorAxis = 1 / reciprocalAxis
    records.push({ instantMs, periodSeconds: 2 * Math.PI * Math.sqrt((semiMajorAxis ** 3) / EARTH_GRAVITATIONAL_PARAMETER_KM3_PER_S2) })
  }
  if (records.length < 2) return null
  const periods = records.map(record => record.periodSeconds).sort((left, right) => left - right)
  const medianPeriod = periods[Math.floor(periods.length / 2)]
  const durationSeconds = (records.at(-1)!.instantMs - records[0].instantMs) / 1000
  return durationSeconds > 0 && Number.isFinite(medianPeriod) && medianPeriod > 0 ? durationSeconds / medianPeriod : null
}

/** GMAT success alone is not evidence that the complete mission pipeline succeeded. */
export function resultRunStatus(manifestStatus: unknown, workflow: WorkflowRunLog) {
  const statuses = stages.map(stage => workflow.stages[stage].status)
  if (statuses.includes("failed") || manifestStatus === "failed" || manifestStatus === "timeout") return "failed"
  if (statuses.every(status => status === "completed")) return "completed"
  if (statuses.includes("running") || manifestStatus === "running") return "running"
  if (statuses.includes("completed") || manifestStatus === "completed" || manifestStatus === "generated") return "partial"
  return "not_started"
}

/** Lists dated runs, including failed runs without any time-series artifact. */
export async function listResultRuns(root: string, workspaceCandidate?: unknown) {
  const workspace = resolveMissionWorkspace(root, workspaceCandidate, { resolveRelativeToRoot: true })
  const selectedRun = resolveMissionRun(root, workspace)
  const base = selectedRun ? path.resolve(selectedRun.runDir, "../../..") : workspace
  const collections = [...new Set([path.resolve(root), base])].flatMap(directory =>
    ["mission-runs", "orbit-keeping", "electric-propulsion-transfer"].map(collection => path.join(directory, "gmat", collection)))
  const runs = []
  for (const collection of collections) {
    const entries = await fs.readdir(collection, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
    for (const entry of entries) {
      if (!entry.isDirectory() || !MISSION_RUN_ID_PATTERN.test(entry.name)) continue
      const run = resolveMissionRun(root, path.join(collection, entry.name))
      if (!run) continue
      try {
        const [source, workflow, stat] = await Promise.all([
          fs.readFile(path.join(run.runDir, "run_manifest.json"), "utf8"),
          loadRunWorkflowLog(run.runDir), fs.stat(run.runDir),
        ])
        const manifest = JSON.parse(source) as Record<string, unknown>
        const templateId = typeof manifest.templateId === "string" ? manifest.templateId : null
        runs.push({
          runId: run.runId, runPath: run.runPath, templateId,
          name: templateId && isGmatTemplateId(templateId) ? gmatTemplateDefinition(templateId).name : templateId ?? "Mission draft",
          createdAt: typeof manifest.createdAt === "string" && Number.isFinite(Date.parse(manifest.createdAt)) ? manifest.createdAt : stat.birthtime.toISOString(),
          status: resultRunStatus(manifest.status, workflow), workflow,
        })
      } catch {
        runs.push({ runId: run.runId, runPath: run.runPath, templateId: null, name: "Unreadable run", createdAt: null, status: "unknown" as const, workflow: null })
      }
    }
  }
  // Keep unreadable directories visible, but do not auto-select one ahead of a dated run.
  return runs.sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? "") || b.runId.localeCompare(a.runId))
}

export async function loadResultConversation(runDir: string) {
  const source = await fs.readFile(path.join(runDir, "conversation.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return "[]"
    throw error
  })
  const parsed: unknown = JSON.parse(source)
  if (!Array.isArray(parsed)) throw new Error("invalid run conversation")
  return parsed.filter((turn): turn is { question: string; answer: string; askedAt?: string } => Boolean(turn && typeof turn.question === "string" && typeof turn.answer === "string"))
}

export async function loadResultSamples(runDir: string) {
  const manifestSource = await fs.readFile(path.join(runDir, "run_manifest.json"), "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null
    throw error
  })
  const manifest = manifestSource ? JSON.parse(manifestSource) as Record<string, unknown> : null
  const templateId = typeof manifest?.templateId === "string" ? manifest.templateId : null
  const expectedFile = templateId ? TIME_SERIES_FILE_BY_TEMPLATE[templateId] : null

  // A declared scenario must only expose its own artifact. This is especially
  // important when a user reuses a workspace that still contains old outputs.
  const candidates = expectedFile ? [expectedFile] : ["orbit_timeseries.json", "electric_transfer_timeseries.json", "chemical_hohmann_timeseries.json"]
  for (const file of candidates) {
    const source = await fs.readFile(path.join(runDir, file), "utf8").catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null
      throw error
    })
    if (source === null) continue
    const samples: unknown = JSON.parse(source)
    if (!Array.isArray(samples)) throw new Error("invalid GMAT time series")
    if (templateId === "orbit-keeping") {
      const oem = await fs.readFile(path.join(runDir, "EphemerisFile1.oem"), "utf8").catch(() => "")
      const trajectory = parseOrbitKeepingOem(oem)
      if (trajectory.length) {
        // Keep sparse report samples as well: they are the only source for
        // tank mass. The frontend filters each metric independently.
        const reportSamples = samples.map(orbitReportForCharts).filter((sample): sample is Record<string, unknown> => sample !== null)
        return {
          samples: [...trajectory, ...reportSamples].sort((left, right) => {
            const leftTime = typeof (left as { elapsedDays?: unknown }).elapsedDays === "number" ? (left as { elapsedDays: number }).elapsedDays : Number.POSITIVE_INFINITY
            const rightTime = typeof (right as { elapsedDays?: unknown }).elapsedDays === "number" ? (right as { elapsedDays: number }).elapsedDays : Number.POSITIVE_INFINITY
            return leftTime - rightTime
          }),
          source: "EphemerisFile1.oem + orbit_timeseries.json",
        }
      }
    }
    return { samples, source: file }
  }
  return { samples: [], source: null }
}
