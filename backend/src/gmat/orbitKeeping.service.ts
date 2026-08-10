import fs from "node:fs/promises"
import path from "node:path"
import { stringify } from "yaml"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { assertOrbitKeepingSimulationSafety } from "./orbitKeepingDraft.js"
import { editOrbitKeepingValuesWithLlm, type OrbitKeepingLlmEditResult } from "./orbitKeepingLlmEdit.js"
import { runOrbitKeepingGmat, toGmatNativePath, type OrbitKeepingExecutionResult } from "./orbitKeepingRunner.js"
import { defaultOrbitKeepingTemplatePath } from "./orbitKeepingTemplate.js"
import { applyOrbitKeepingValueChanges, parseOrbitKeepingValues, renderOrbitKeepingValues, type OrbitKeepingValueChange } from "./orbitKeepingValues.js"

export type OrbitKeepingRunStatus = "generated" | OrbitKeepingExecutionResult["status"]

/** A real pipeline state emitted while a GMAT run is being prepared/executed. */
export type OrbitKeepingProgress = {
  key: "load_template" | "llm_patch" | "render_script" | "run_gmat" | "save_results"
  percent: number
  status: "running" | "completed"
}

export type OrbitKeepingRunResult = {
  error?: string
  executionDurationMs?: number
  finalAltitudeKm?: number
  finalEpochA1ModJulian?: number
  finalFuelMassKg?: number
  fuelUsedBetweenReportsKg?: number
  maximumReportedAltitudeKm?: number
  minimumReportedAltitudeKm?: number
  reportSampleCount: number
  status: OrbitKeepingRunStatus
  timeSeriesSampleCount: number
}

export type GenerateOrbitKeepingMissionResult = Pick<OrbitKeepingLlmEditResult, "changes" | "latencyMs"> & {
  manifestPath: string
  result: OrbitKeepingRunResult
  resultPath: string
  runDir: string
  runId: string
  scriptPath: string
  timeSeriesPath: string
  valuesPath: string
}

export function defaultOrbitKeepingValuesPath(projectRoot = process.cwd()) {
  return path.join(
    projectRoot,
    "workflow_agents",
    "gmat_skills",
    "orbit-keeping-template",
    "references",
    "orbit_keeping.values.yaml",
  )
}

function formatRunDirectoryName(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getFullYear() % 100)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`
}

async function createRunOutputDir(rootDir: string, requestedName: string) {
  for (let index = 1; index <= 99; index += 1) {
    const suffix = index === 1 ? "" : `_${String(index).padStart(2, "0")}`
    const outputDir = path.join(rootDir, `${requestedName}${suffix}`)
    try {
      await fs.mkdir(outputDir, { recursive: false })
      return outputDir
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err
    }
  }
  throw new Error("too many GMAT generations in the same minute")
}

function summarizeExecution(execution?: OrbitKeepingExecutionResult): OrbitKeepingRunResult {
  if (!execution) return { reportSampleCount: 0, status: "generated", timeSeriesSampleCount: 0 }
  const first = execution.samples[0]
  const final = execution.samples.at(-1)
  const altitudes = execution.samples.map(sample => sample.altitudeKm)
  return {
    ...(execution.error ? { error: execution.error } : {}),
    executionDurationMs: execution.durationMs,
    ...(final ? {
      finalAltitudeKm: final.altitudeKm,
      finalEpochA1ModJulian: final.epochA1ModJulian,
      finalFuelMassKg: final.fuelMassKg,
    } : {}),
    ...(first && final ? { fuelUsedBetweenReportsKg: first.fuelMassKg - final.fuelMassKg } : {}),
    ...(altitudes.length ? {
      maximumReportedAltitudeKm: Math.max(...altitudes),
      minimumReportedAltitudeKm: Math.min(...altitudes),
    } : {}),
    reportSampleCount: execution.samples.length,
    status: execution.status,
    timeSeriesSampleCount: execution.timeSeriesSamples.length,
  }
}

/**
 * Generates GMAT artefacts from the immutable Keplerian template.
 *
 * The only non-deterministic operation is the single LLM request.  Files are
 * materialised only after that request and all deterministic validation pass.
 */
export async function generateOrbitKeepingMission({
  connection,
  request,
  workspaceDir,
  fetchImpl,
  templatePath = defaultOrbitKeepingTemplatePath(),
  valuesPath = defaultOrbitKeepingValuesPath(),
  artifactId = formatRunDirectoryName(new Date()),
  execution,
  onProgress,
  changes,
}: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">
  request: string
  workspaceDir: string
  fetchImpl?: typeof fetch
  templatePath?: string
  valuesPath?: string
  artifactId?: string
  execution?: {
    bin: string
    timeoutMs: number
  }
  onProgress?: (progress: OrbitKeepingProgress) => void
  /** Validated semantic draft changes can bypass the LLM at execution time. */
  changes?: OrbitKeepingValueChange[]
}): Promise<GenerateOrbitKeepingMissionResult> {
  if (!workspaceDir.trim()) throw new Error("workspace directory must not be empty")
  if (!/^[A-Za-z0-9_-]+$/u.test(artifactId)) throw new Error("artifact id contains unsupported characters")

  onProgress?.({ key: "load_template", percent: 5, status: "running" })
  const [template, valuesSource] = await Promise.all([
    fs.readFile(templatePath, "utf8"),
    fs.readFile(valuesPath, "utf8"),
  ])
  const sourceValues = parseOrbitKeepingValues(valuesSource)
  onProgress?.({ key: "load_template", percent: 15, status: "completed" })
  onProgress?.({ key: "llm_patch", percent: 20, status: "running" })
  const edit = changes
    ? { changes, latencyMs: 0, values: applyOrbitKeepingValueChanges(sourceValues, changes) }
    : await editOrbitKeepingValuesWithLlm({ connection, request, values: sourceValues, fetchImpl })
  onProgress?.({ key: "llm_patch", percent: 45, status: "completed" })

  assertOrbitKeepingSimulationSafety(edit.values)

  onProgress?.({ key: "render_script", percent: 50, status: "running" })
  const outputRoot = path.join(path.resolve(workspaceDir), "gmat", "orbit-keeping")
  await fs.mkdir(outputRoot, { recursive: true })
  const outputDir = await createRunOutputDir(outputRoot, artifactId)
  const outputValuesPath = path.join(outputDir, "orbit_keeping.values.yaml")
  const outputScriptPath = path.join(outputDir, "orbit_keeping.script")
  const outputResultPath = path.join(outputDir, "gmat_result.json")
  const outputTimeSeriesPath = path.join(outputDir, "orbit_timeseries.json")
  const outputManifestPath = path.join(outputDir, "run_manifest.json")
  const reportSlot = edit.values.slots.find(slot => slot.context.includes("ReboostReport.Filename"))
  if (!reportSlot) throw new Error("orbit-keeping template does not expose ReboostReport.Filename")
  const timeSeriesSlot = edit.values.slots.find(slot => slot.context.includes("OrbitAnalysisReport.Filename"))
  if (!timeSeriesSlot) throw new Error("orbit-keeping template does not expose OrbitAnalysisReport.Filename")
  const ephemerisSlot = edit.values.slots.find(slot => slot.context.includes("EphemerisFile1.Filename"))
  if (!ephemerisSlot) throw new Error("orbit-keeping template does not expose EphemerisFile1.Filename")
  const reportPath = toGmatNativePath(path.join(outputDir, "ReboostReport.txt")).replace(/\\/gu, "/")
  const timeSeriesReportPath = toGmatNativePath(path.join(outputDir, "OrbitAnalysisReport.txt")).replace(/\\/gu, "/")
  const ephemerisPath = toGmatNativePath(path.join(outputDir, "EphemerisFile1.oem")).replace(/\\/gu, "/")
  const renderedValues = applyOrbitKeepingValueChanges(edit.values, [{
    id: reportSlot.id,
    value: `'${reportPath}'`,
  }, {
    id: timeSeriesSlot.id,
    value: `'${timeSeriesReportPath}'`,
  }, {
    id: ephemerisSlot.id,
    value: `'${ephemerisPath}'`,
  }])
  const renderedScript = renderOrbitKeepingValues(template, renderedValues)
  await Promise.all([
    fs.writeFile(outputValuesPath, stringify(renderedValues), "utf8"),
    fs.writeFile(outputScriptPath, renderedScript, "utf8"),
  ])
  onProgress?.({ key: "render_script", percent: 60, status: "completed" })

  const startedAt = new Date().toISOString()
  if (execution) onProgress?.({ key: "run_gmat", percent: 65, status: "running" })
  const executionResult = execution
    ? await runOrbitKeepingGmat({ ...execution, scriptPath: outputScriptPath })
    : undefined
  if (execution) onProgress?.({ key: "run_gmat", percent: 90, status: "completed" })
  const result = summarizeExecution(executionResult)
  const runId = path.basename(outputDir)
  const manifest = {
    schemaVersion: 1,
    runId,
    tool: "GMAT",
    templateId: "orbit-keeping",
    status: result.status,
    request,
    createdAt: startedAt,
    completedAt: executionResult?.completedAt ?? null,
    changes: edit.changes,
    inputs: {
      script: path.basename(outputScriptPath),
      values: path.basename(outputValuesPath),
    },
    outputs: {
      result: path.basename(outputResultPath),
      report: executionResult ? path.basename(executionResult.reportPath) : null,
      timeSeries: executionResult ? path.basename(outputTimeSeriesPath) : null,
      log: executionResult ? path.basename(executionResult.logPath) : null,
    },
  }
  onProgress?.({ key: "save_results", percent: 92, status: "running" })
  await Promise.all([
    fs.writeFile(outputResultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    fs.writeFile(outputTimeSeriesPath, `${JSON.stringify(executionResult?.timeSeriesSamples ?? [], null, 2)}\n`, "utf8"),
    fs.writeFile(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  ])
  onProgress?.({ key: "save_results", percent: 100, status: "completed" })

  return {
    changes: edit.changes,
    latencyMs: edit.latencyMs,
    manifestPath: outputManifestPath,
    result,
    resultPath: outputResultPath,
    runDir: outputDir,
    runId,
    scriptPath: outputScriptPath,
    timeSeriesPath: outputTimeSeriesPath,
    valuesPath: outputValuesPath,
  }
}
