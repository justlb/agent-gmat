import fs from "node:fs/promises"
import path from "node:path"
import { runManagedProcess } from "./externalProcess.js"

export type OrbitKeepingReportSample = {
  altitudeKm: number
  epochA1ModJulian: number
  fuelMassKg: number
}

export type OrbitKeepingTimeSeriesSample = OrbitKeepingReportSample & {
  eccentricity: number
  inclinationDeg: number
  semiMajorAxisKm: number
  totalMassKg: number
}

export type OrbitKeepingExecutionResult = {
  completedAt: string
  durationMs: number
  error?: string
  exitCode: number | null
  logPath: string
  reportPath: string
  samples: OrbitKeepingReportSample[]
  status: "completed" | "failed" | "timeout"
  timeSeriesPath: string
  timeSeriesSamples: OrbitKeepingTimeSeriesSample[]
}

export function toGmatNativePath(filePath: string) {
  const normalizedInput = filePath.replace(/\\/gu, "/")
  const wslMatch = /^\/mnt\/([a-zA-Z])\/(.*)$/u.exec(normalizedInput)
  if (wslMatch) return `${wslMatch[1].toUpperCase()}:\\${wslMatch[2].replace(/\//gu, "\\")}`
  return path.resolve(filePath)
}

export function parseOrbitKeepingReport(source: string): OrbitKeepingReportSample[] {
  const samples: OrbitKeepingReportSample[] = []
  for (const line of source.split(/\r?\n/u)) {
    const values = line.trim().split(/\s+/u).map(Number)
    if (values.length < 3 || values.slice(0, 3).some(value => !Number.isFinite(value))) continue
    samples.push({
      epochA1ModJulian: values[0],
      fuelMassKg: values[1],
      altitudeKm: values[2],
    })
  }
  return samples
}

/** Parses the fixed OrbitAnalysisReport schema defined by the Keplerian template. */
export function parseOrbitKeepingTimeSeriesReport(source: string): OrbitKeepingTimeSeriesSample[] {
  const samples: OrbitKeepingTimeSeriesSample[] = []
  for (const line of source.split(/\r?\n/u)) {
    const values = line.trim().split(/\s+/u).map(Number)
    if (values.length < 7 || values.slice(0, 7).some(value => !Number.isFinite(value))) continue
    samples.push({
      epochA1ModJulian: values[0],
      altitudeKm: values[1],
      fuelMassKg: values[2],
      totalMassKg: values[3],
      semiMajorAxisKm: values[4],
      eccentricity: values[5],
      inclinationDeg: values[6],
    })
  }
  return samples
}

export async function runOrbitKeepingGmat({
  bin,
  scriptPath,
  timeoutMs,
}: {
  bin: string
  scriptPath: string
  timeoutMs: number
}): Promise<OrbitKeepingExecutionResult> {
  const runDir = path.dirname(scriptPath)
  const reportPath = path.join(runDir, "ReboostReport.txt")
  const timeSeriesPath = path.join(runDir, "OrbitAnalysisReport.txt")
  const logPath = path.join(runDir, "gmat.log")
  const startedAt = Date.now()
  const execution = await runManagedProcess({ args: ["--run", toGmatNativePath(scriptPath)], command: bin, cwd: runDir, timeoutMs })
  const { exitCode, output, timedOut } = execution
  await fs.writeFile(logPath, output)
  const reportSource = await fs.readFile(reportPath, "utf8").catch(() => "")
  const timeSeriesSource = await fs.readFile(timeSeriesPath, "utf8").catch(() => "")
  const samples = parseOrbitKeepingReport(reportSource)
  const timeSeriesSamples = parseOrbitKeepingTimeSeriesReport(timeSeriesSource)
  const status = timedOut ? "timeout" : exitCode === 0 && samples.length > 0 ? "completed" : "failed"
  const solverIterations = (output.toString("utf8").match(/DefaultDC Iteration \d+/gu) ?? []).length
  const error = status === "completed"
    ? undefined
    : timedOut
      ? `GMAT timed out after ${timeoutMs} ms${solverIterations ? `. The DefaultDC reboost solver was still iterating (${solverIterations} iterations recorded); inspect gmat.log and review maneuver bounds or target convergence.` : ""}`
      : exitCode === null
        ? "GMAT could not be started"
        : exitCode !== 0
          ? "GMAT rejected the generated script before producing reports; inspect gmat.log for the GMAT error."
          : samples.length === 0
            ? "GMAT completed but did not produce a parseable ReboostReport.txt required for Orbit Keeping analysis."
            : `GMAT exited with code ${exitCode}`

  return {
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    ...(error ? { error } : {}),
    exitCode,
    logPath,
    reportPath,
    samples,
    status,
    timeSeriesPath,
    timeSeriesSamples,
  }
}
