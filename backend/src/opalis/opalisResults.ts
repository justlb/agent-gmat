import fs from "node:fs/promises"
import path from "node:path"

export type OpalisResultSummary = {
  alerts: Array<{ level: "info" | "warning"; message: string }>
  completionPercent: number | null
  computedDurationSeconds: number | null
  finalSocPercent: number | null
  initialBatteryVoltageV: number | null
  initialSocPercent: number | null
  lowVoltageLimitV: number | null
  maxDepthOfDischargePercent: number | null
  orbitCount: number | null
  resultRows: number | null
  satelliteName: string | null
  simulationExecuted: boolean
  solarArrayEnergy: number | null
  solarSections: number | null
  stopCondition: string | null
  timeStepSeconds: number | null
  voltageControlMode: string | null
}

export type OpalisTimeSeriesSample = {
  battery_voltage_v?: number
  depth_of_discharge_percent?: number
  index: number
  soc_percent?: number
  solar_energy_wh?: number
  time_seconds?: number
}

export type OpalisTimeSeries = {
  availableRowProperties: string[]
  sampleIntervalRows: number | null
  samples: OpalisTimeSeriesSample[]
  sourceRowCount: number
}

function finiteNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value.replace(",", "."))
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function percent(value: unknown) {
  const numeric = finiteNumber(value)
  return numeric === null ? null : numeric * 100
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function appliedParameter(result: Record<string, unknown>, targetPath: string) {
  const parameters = result.applied_parameters
  if (!Array.isArray(parameters)) return null
  const match = parameters.find(entry => {
    if (!entry || typeof entry !== "object") return false
    return (entry as { path?: unknown }).path === targetPath
  }) as { value?: unknown } | undefined
  return match?.value ?? null
}

export async function loadOpalisResultSummary(runDir: string): Promise<OpalisResultSummary | null> {
  const source = await fs.readFile(path.join(runDir, "opalis", "03-opalis", "02-resultats", "calculated-opalis.json"), "utf8").catch(() => null)
  if (!source) return null
  const result = JSON.parse(source) as Record<string, unknown>
  const stopCondition = typeof result.stop_condition === "string" && result.stop_condition.trim() ? result.stop_condition.trim() : null
  const finalSocPercent = percent(result.final_soc)
  const initialSocPercent = percent(result.initial_soc)
  const maxDepthOfDischargePercent = finiteNumber(result.max_depth_of_discharge)
  const alerts: OpalisResultSummary["alerts"] = []
  if (stopCondition === "eBattMin reached") alerts.push({ level: "warning", message: "OPALIS stopped because the battery minimum threshold was reached." })
  else if (stopCondition) alerts.push({ level: "info", message: `OPALIS stop condition: ${stopCondition}.` })
  if (finalSocPercent !== null && finalSocPercent < 20) alerts.push({ level: "warning", message: `Final battery state of charge is low (${finalSocPercent.toFixed(1)}%).` })
  return {
    alerts,
    completionPercent: finiteNumber(result.completion_percent),
    computedDurationSeconds: finiteNumber(result.computed_duration),
    finalSocPercent,
    initialBatteryVoltageV: finiteNumber(appliedParameter(result, "SimulationModel.SimulationInitialisation.VBatt")),
    initialSocPercent,
    lowVoltageLimitV: finiteNumber(appliedParameter(result, "SimulationModel.Battery.Vl")),
    maxDepthOfDischargePercent,
    orbitCount: finiteNumber(result.orbits),
    resultRows: finiteNumber(result.result_rows),
    satelliteName: stringValue(result.satellite),
    simulationExecuted: result.simulation_executed === true,
    solarArrayEnergy: finiteNumber(result.solar_array_energy),
    solarSections: finiteNumber(result.solar_sections),
    stopCondition,
    timeStepSeconds: finiteNumber(result.time_step),
    voltageControlMode: stringValue(appliedParameter(result, "SimulationModel.PowerProfil.VoltageLimitMode")),
  }
}

export async function loadOpalisTimeSeries(runDir: string): Promise<OpalisTimeSeries | null> {
  const source = await fs.readFile(path.join(runDir, "opalis", "03-opalis", "02-resultats", "calculated-opalis-timeseries.json"), "utf8").catch(() => null)
  if (!source) return null
  const result = JSON.parse(source) as Record<string, unknown>
  const rawSamples = Array.isArray(result.samples) ? result.samples : []
  const samples = rawSamples.flatMap((sample, index) => {
    if (!sample || typeof sample !== "object") return []
    const row = sample as Record<string, unknown>
    const output: OpalisTimeSeriesSample = { index: finiteNumber(row.index) ?? index }
    for (const key of ["battery_voltage_v", "depth_of_discharge_percent", "soc_percent", "solar_energy_wh", "time_seconds"] as const) {
      const value = finiteNumber(row[key])
      if (value !== null) output[key] = value
    }
    return [output]
  })
  return {
    availableRowProperties: Array.isArray(result.available_row_properties) ? result.available_row_properties.filter((value): value is string => typeof value === "string") : [],
    sampleIntervalRows: finiteNumber(result.sample_interval_rows),
    samples,
    sourceRowCount: finiteNumber(result.source_row_count) ?? samples.length,
  }
}
