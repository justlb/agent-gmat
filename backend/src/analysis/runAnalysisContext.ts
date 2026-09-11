import fs from "node:fs/promises"
import path from "node:path"

import { loadOpalisResultSummary } from "../opalis/opalisResults.js"
import { loadRunWorkflowLog } from "../opalis/workflowRunLog.js"
import { loadRFComlinkResultSummary } from "../rfComlink/rfComlinkResults.js"

const OUTPUT = "run-analysis-context.json"

type JsonRecord = Record<string, unknown>

const TIME_SERIES_SOURCE_BY_TEMPLATE: Record<string, string> = {
  "chemical-hohmann-transfer": "chemical_hohmann_timeseries.json",
  "electric-propulsion-transfer": "electric_transfer_timeseries.json",
  "electrical-leo-orbit-maintenance": "electric_transfer_timeseries.json",
  "orbit-keeping": "orbit_timeseries.json",
}

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

async function readJson(filePath: string): Promise<unknown | null> {
  try { return JSON.parse(await fs.readFile(filePath, "utf8")) as unknown } catch { return null }
}

async function summarizeCicOutputs(runDir: string) {
  const outputRoot = path.join(runDir, "opalis", "02-simu-cic", "02-fichiers-cic")
  const entries = await fs.readdir(outputRoot, { recursive: true }).catch(() => [])
  const files = entries.filter((entry): entry is string => typeof entry === "string" && /\.(?:txt|cic)$/iu.test(entry))
  const samples: Array<{ source_file: string; numeric_rows: number }> = []
  for (const relative of files.slice(0, 30)) {
    const source = await fs.readFile(path.join(outputRoot, relative), "utf8").catch(() => "")
    const numericRows = source.split(/\r?\n/u).filter(line => /^\s*[-+]?\d/u.test(line)).length
    samples.push({ source_file: path.join("opalis", "02-simu-cic", "02-fichiers-cic", relative).split(path.sep).join("/"), numeric_rows: numericRows })
  }
  return { files: samples, generated_file_count: files.length }
}

function finite(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function scalarMetrics(value: unknown, names: string[]) {
  const record = isRecord(value) ? value : {}
  return Object.fromEntries(names.flatMap(name => {
    const candidate = record[name]
    return typeof candidate === "string" || typeof candidate === "number" || typeof candidate === "boolean" ? [[name, candidate]] : []
  }))
}

function summarizeTimeSeries(value: unknown) {
  const rows = Array.isArray(value) ? value.filter(isRecord) : []
  if (!rows.length) return null
  const numericKeys = new Set<string>()
  for (const row of rows) for (const [key, candidate] of Object.entries(row)) if (finite(candidate) !== null) numericKeys.add(key)
  const metrics: Record<string, { first: number; last: number; minimum: number; maximum: number }> = {}
  for (const key of numericKeys) {
    const samples = rows.map(row => finite(row[key])).filter((item): item is number => item !== null)
    if (!samples.length) continue
    // Run reports can be very long. Reducers remain safe where a variadic
    // Math.min/Math.max call would overflow the JavaScript call stack.
    const extrema = samples.reduce((result, sample) => ({
      minimum: Math.min(result.minimum, sample),
      maximum: Math.max(result.maximum, sample),
    }), { minimum: Number.POSITIVE_INFINITY, maximum: Number.NEGATIVE_INFINITY })
    metrics[key] = { first: samples[0], last: samples.at(-1)!, minimum: extrema.minimum, maximum: extrema.maximum }
  }
  return { sample_count: rows.length, metrics }
}

function linesWithNumbers(text: string, source: string) {
  const keywords = /(?:availability|margin|data\s*rate|bit\s*rate|received\s*power|eirp|c\/n|eb\/n0)/iu
  return text.split(/\r?\n/u).flatMap((line, index) => {
    if (!keywords.test(line) || !/[-+]?\d+(?:[.,]\d+)?/u.test(line)) return []
    return [{ source_file: source, line: index + 1, text: line.trim().slice(0, 240) }]
  }).slice(0, 20)
}

function requestedMission(satellite: unknown) {
  const root = isRecord(satellite) ? satellite : {}
  const satelliteRecord = isRecord(root.satellite) ? root.satellite : {}
  const orbit = isRecord(satelliteRecord.orbit) ? satelliteRecord.orbit : {}
  const analysisRequests = isRecord(root.analysis_requests) ? root.analysis_requests : {}
  const identity = isRecord(satelliteRecord.identity) ? satelliteRecord.identity : {}
  return {
    satellite: { id: root.satellite_definition_id ?? null, name: identity.name ?? null, version: root.satellite_definition_version ?? null },
    orbit: {
      epoch_utc: orbit.reference_epoch_utc ?? null,
      semi_major_axis_km: isRecord(orbit.keplerian_elements) ? orbit.keplerian_elements.semi_major_axis_km ?? null : null,
      eccentricity: isRecord(orbit.keplerian_elements) ? orbit.keplerian_elements.eccentricity ?? null : null,
      inclination_deg: isRecord(orbit.keplerian_elements) ? orbit.keplerian_elements.inclination_deg ?? null : null,
    },
    gmat: analysisRequests.gmat ?? null,
    simu_cic: analysisRequests.simu_cic ?? null,
    rf_comlink: analysisRequests.rf_comlink ?? null,
  }
}

export type RunAnalysisContext = {
  schema_version: 1
  generated_at: string
  run: { id: string | null; template: string | null; source_of_truth: string }
  configuration: ReturnType<typeof requestedMission>
  workflow: Awaited<ReturnType<typeof loadRunWorkflowLog>>
  results: JsonRecord
  verdicts: Array<{ level: "blocker" | "warning" | "info"; tool: string; message: string; source_file: string }>
}

/** Writes a compact, versioned evidence layer for a mission run.
 * It intentionally contains engineering metrics and source references, not
 * unbounded tool logs, so it is suitable for an LLM prompt. */
export async function writeRunAnalysisContext(runDir: string) {
  const [manifest, gmatResult, satellite, orbitSeries, electricSeries, chemicalSeries, simuCicDefinition, workflow, opalis, rf, cicOutputs] = await Promise.all([
    readJson(path.join(runDir, "run_manifest.json")),
    readJson(path.join(runDir, "gmat_result.json")),
    readJson(path.join(runDir, "satellite.json")),
    readJson(path.join(runDir, "orbit_timeseries.json")),
    readJson(path.join(runDir, "electric_transfer_timeseries.json")),
    readJson(path.join(runDir, "chemical_hohmann_timeseries.json")),
    readJson(path.join(runDir, "opalis", "02-simu-cic", "simucic.definition.json")),
    loadRunWorkflowLog(runDir),
    loadOpalisResultSummary(runDir),
    loadRFComlinkResultSummary(runDir),
    summarizeCicOutputs(runDir),
  ])
  const manifestRecord = isRecord(manifest) ? manifest : {}
  const gmatRecord = isRecord(gmatResult) ? gmatResult : {}
  const gmatStatus = typeof gmatRecord.status === "string" ? gmatRecord.status : "not_available"
  const timeSeriesCandidates = [
    { source: "orbit_timeseries.json", summary: summarizeTimeSeries(orbitSeries) },
    { source: "electric_transfer_timeseries.json", summary: summarizeTimeSeries(electricSeries) },
    { source: "chemical_hohmann_timeseries.json", summary: summarizeTimeSeries(chemicalSeries) },
  ]
  const declaredTimeSeriesSource = typeof manifestRecord.templateId === "string"
    ? TIME_SERIES_SOURCE_BY_TEMPLATE[manifestRecord.templateId]
    : null
  // Prefer the artifact declared by the run. The fallback only supports legacy
  // runs that predate a manifest and prevents stale files from changing facts.
  const selectedTimeSeries = declaredTimeSeriesSource
    ? timeSeriesCandidates.find(candidate => candidate.source === declaredTimeSeriesSource && candidate.summary)
    : timeSeriesCandidates.find(candidate => candidate.summary)
  const timeSeries = selectedTimeSeries?.summary ?? null
  const timeSeriesSource = selectedTimeSeries?.source ?? null
  const rfEvidence = rf ? rf.reports.flatMap(report => linesWithNumbers(report.text, report.path)) : []
  const verdicts: RunAnalysisContext["verdicts"] = []
  if (gmatStatus === "failed" || gmatStatus === "timeout") verdicts.push({ level: "blocker", tool: "GMAT", message: String(gmatRecord.error ?? `GMAT ${gmatStatus}.`), source_file: "gmat_result.json" })
  else if (gmatStatus === "completed") verdicts.push({ level: "info", tool: "GMAT", message: "GMAT completed; inspect the normalized result and time-series metrics for mission performance.", source_file: "gmat_result.json" })
  for (const alert of opalis?.alerts ?? []) verdicts.push({ level: alert.level === "warning" ? "warning" : "info", tool: "OPALIS", message: alert.message, source_file: "opalis/03-opalis/02-resultats/calculated-opalis.json" })
  if (workflow.stages.simu_cic.status === "failed") verdicts.push({ level: "blocker", tool: "Simu-CIC", message: workflow.stages.simu_cic.message ?? "Simu-CIC failed.", source_file: "workflow-status.json" })
  if (workflow.stages.rf_comlink.status === "failed") verdicts.push({ level: "blocker", tool: "RF-COMLINK", message: workflow.stages.rf_comlink.message ?? "RF-COMLINK failed.", source_file: "workflow-status.json" })
  const context: RunAnalysisContext = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    run: { id: typeof manifestRecord.runId === "string" ? manifestRecord.runId : null, template: typeof manifestRecord.templateId === "string" ? manifestRecord.templateId : null, source_of_truth: "satellite.json" },
    configuration: requestedMission(satellite),
    workflow,
    results: {
      gmat: {
        status: gmatStatus,
        metrics: scalarMetrics(gmatResult, ["executionDurationMs", "reportSampleCount", "timeSeriesSampleCount", "finalAltitudeKm", "finalElapsedSeconds", "finalFuelMassKg", "fuelUsedBetweenReportsKg", "maximumReportedThrustPowerKw", "minimumUsablePowerKw", "powerEligibleSampleCount", "error"]),
        time_series: timeSeries,
        sources: ["gmat_result.json", timeSeries ? timeSeriesSource : null].filter(Boolean),
      },
      simu_cic: {
        workflow_status: workflow.stages.simu_cic.status,
        requested: requestedMission(satellite).simu_cic,
        executed_definition: simuCicDefinition,
        generated_outputs: cicOutputs,
        source: "opalis/02-simu-cic/simucic.definition.json",
      },
      opalis: opalis ?? { workflow_status: workflow.stages.opalis.status, available: false },
      rf_comlink: rf ? {
        workflow_status: workflow.stages.rf_comlink.status,
        report_count: rf.reports.length,
        link_files: rf.link_files,
        link_budgets: rf.link_budgets,
        metrics: rf.indicators,
        indicators: rfEvidence,
        source: "rf-comlink/03-results/rf-comlink-results.json",
      } : { workflow_status: workflow.stages.rf_comlink.status, available: false },
    },
    verdicts,
  }
  const output = path.join(runDir, OUTPUT)
  await fs.writeFile(output, `${JSON.stringify(context, null, 2)}\n`, "utf8")
  return { context, output }
}

export async function loadRunAnalysisContext(runDir: string): Promise<RunAnalysisContext | null> {
  const parsed = await readJson(path.join(runDir, OUTPUT))
  return isRecord(parsed) && parsed.schema_version === 1 ? parsed as RunAnalysisContext : null
}

export function analysisContextForPrompt(context: RunAnalysisContext) {
  return [
    "Run-analysis context is authoritative for this saved run. Use only its reported values and named source files.",
    "Separate facts, engineering interpretation, and missing evidence. Do not claim a calculation was rerun. If evidence is absent, say what file/metric is needed.",
    JSON.stringify(context),
  ].join("\n")
}
