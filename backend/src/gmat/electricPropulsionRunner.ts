import fs from "node:fs/promises"
import path from "node:path"

import { toGmatNativePath } from "./orbitKeepingRunner.js"
import { runManagedProcess } from "./externalProcess.js"

export type ElectricPropulsionReportSample = {
  argPeriapsisDeg: number
  eccentricity: number
  elapsedDays: number
  fuelMassKg: number
  inclinationDeg: number
  massFlowRateKgPerSec?: number
  powerAvailableKw: number
  raanDeg: number
  semiMajorAxisKm: number
  totalMassKg: number
  trueAnomalyDeg: number
}
export type ElectricPropulsionExecutionResult = {
  completedAt: string
  durationMs: number
  error?: string
  exitCode: number | null
  logPath: string
  reportPath: string
  samples: ElectricPropulsionReportSample[]
  status: "completed" | "failed" | "timeout"
}

export function parseElectricPropulsionReport(source: string): ElectricPropulsionReportSample[] {
  const samples: ElectricPropulsionReportSample[] = []
  for (const line of source.split(/\r?\n/u)) {
    const values = line.trim().split(/\s+/u).map(Number)
    // Electrical LEO station keeping reports elapsed seconds, altitude and
    // xenon mass only. Convert it to the common result shape so the shared
    // pipeline can consume both electric mission report formats.
    if (values.length >= 3 && values.slice(0, 3).every(Number.isFinite) && values.length < 10) {
      samples.push({ elapsedDays: values[0] / 86_400, semiMajorAxisKm: values[1] + 6378.1363, eccentricity: 0, inclinationDeg: 0, raanDeg: 0, argPeriapsisDeg: 0, trueAnomalyDeg: 0, fuelMassKg: values[2], totalMassKg: values[2], powerAvailableKw: 0 })
      continue
    }
    if (values.length < 10 || values.slice(0, 10).some(value => !Number.isFinite(value))) continue
    samples.push({ elapsedDays: values[0], semiMajorAxisKm: values[1], eccentricity: values[2], inclinationDeg: values[3], raanDeg: values[4], argPeriapsisDeg: values[5], trueAnomalyDeg: values[6], fuelMassKg: values[7], totalMassKg: values[8], powerAvailableKw: values[9], ...(Number.isFinite(values[10]) ? { massFlowRateKgPerSec: values[10] } : {}) })
  }
  return samples
}

export async function runElectricPropulsionGmat({ bin, scriptPath, timeoutMs }: { bin: string; scriptPath: string; timeoutMs: number }): Promise<ElectricPropulsionExecutionResult> {
  const runDir = path.dirname(scriptPath)
  const reportPath = path.join(runDir, "ElectricTransferReport.txt")
  const logPath = path.join(runDir, "gmat.log")
  const startedAt = Date.now()
  const { exitCode, output: log, timedOut } = await runManagedProcess({ args: ["--run", toGmatNativePath(scriptPath)], command: bin, cwd: runDir, timeoutMs })
  await fs.writeFile(logPath, log)
  const samples = parseElectricPropulsionReport(await fs.readFile(reportPath, "utf8").catch(() => ""))
  const status = timedOut ? "timeout" : exitCode === 0 && samples.length ? "completed" : "failed"
  const error = status === "completed" ? undefined : timedOut ? `GMAT timed out after ${timeoutMs} ms` : exitCode === null ? "GMAT could not be started" : samples.length === 0 ? "GMAT produced no parseable ElectricTransferReport.txt" : `GMAT exited with code ${exitCode}`
  return { completedAt: new Date().toISOString(), durationMs: Date.now() - startedAt, ...(error ? { error } : {}), exitCode, logPath, reportPath, samples, status }
}
