import fs from "node:fs/promises"
import path from "node:path"
import { stringify } from "yaml"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { editOrbitKeepingValuesWithLlm, type OrbitKeepingLlmEditResult } from "./orbitKeepingLlmEdit.js"
import { runOrbitKeepingGmat, toGmatNativePath, type OrbitKeepingExecutionResult } from "./orbitKeepingRunner.js"
import { defaultOrbitKeepingTemplatePath } from "./orbitKeepingTemplate.js"
import { applyOrbitKeepingValueChanges, parseOrbitKeepingValues, renderOrbitKeepingValues } from "./orbitKeepingValues.js"

export type OrbitKeepingRunStatus = "generated" | OrbitKeepingExecutionResult["status"]

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
}

export type GenerateOrbitKeepingMissionResult = Pick<OrbitKeepingLlmEditResult, "changes" | "latencyMs"> & {
  manifestPath: string
  result: OrbitKeepingRunResult
  resultPath: string
  runDir: string
  runId: string
  scriptPath: string
  valuesPath: string
}

function defaultOrbitKeepingValuesPath(projectRoot = process.cwd()) {
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
  if (!execution) return { reportSampleCount: 0, status: "generated" }
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
}): Promise<GenerateOrbitKeepingMissionResult> {
  if (!workspaceDir.trim()) throw new Error("workspace directory must not be empty")
  if (!/^[A-Za-z0-9_-]+$/u.test(artifactId)) throw new Error("artifact id contains unsupported characters")

  const [template, valuesSource] = await Promise.all([
    fs.readFile(templatePath, "utf8"),
    fs.readFile(valuesPath, "utf8"),
  ])
  const sourceValues = parseOrbitKeepingValues(valuesSource)
  const edit = await editOrbitKeepingValuesWithLlm({ connection, request, values: sourceValues, fetchImpl })

  const outputRoot = path.join(path.resolve(workspaceDir), "gmat", "orbit-keeping")
  await fs.mkdir(outputRoot, { recursive: true })
  const outputDir = await createRunOutputDir(outputRoot, artifactId)
  const outputValuesPath = path.join(outputDir, "orbit_keeping.values.yaml")
  const outputScriptPath = path.join(outputDir, "orbit_keeping.script")
  const outputResultPath = path.join(outputDir, "gmat_result.json")
  const outputManifestPath = path.join(outputDir, "run_manifest.json")
  const reportSlot = edit.values.slots.find(slot => slot.context.includes("ReboostReport.Filename"))
  if (!reportSlot) throw new Error("orbit-keeping template does not expose ReboostReport.Filename")
  const reportPath = toGmatNativePath(path.join(outputDir, "ReboostReport.txt")).replace(/\\/gu, "/")
  const renderedValues = applyOrbitKeepingValueChanges(edit.values, [{
    id: reportSlot.id,
    value: `'${reportPath}'`,
  }])
  const renderedScript = renderOrbitKeepingValues(template, renderedValues)
  await Promise.all([
    fs.writeFile(outputValuesPath, stringify(renderedValues), "utf8"),
    fs.writeFile(outputScriptPath, renderedScript, "utf8"),
  ])

  const startedAt = new Date().toISOString()
  const executionResult = execution
    ? await runOrbitKeepingGmat({ ...execution, scriptPath: outputScriptPath })
    : undefined
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
      log: executionResult ? path.basename(executionResult.logPath) : null,
    },
  }
  await Promise.all([
    fs.writeFile(outputResultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    fs.writeFile(outputManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  ])

  return {
    changes: edit.changes,
    latencyMs: edit.latencyMs,
    manifestPath: outputManifestPath,
    result,
    resultPath: outputResultPath,
    runDir: outputDir,
    runId,
    scriptPath: outputScriptPath,
    valuesPath: outputValuesPath,
  }
}
