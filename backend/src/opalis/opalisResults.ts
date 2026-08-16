import fs from "node:fs/promises"
import path from "node:path"

export type OpalisResultSummary = {
  alerts: Array<{ level: "info" | "warning"; message: string }>
  computedDurationSeconds: number | null
  finalSocPercent: number | null
  initialSocPercent: number | null
  maxDepthOfDischargePercent: number | null
  resultRows: number | null
  simulationExecuted: boolean
  solarArrayEnergy: number | null
  solarSections: number | null
  stopCondition: string | null
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
    computedDurationSeconds: finiteNumber(result.computed_duration),
    finalSocPercent,
    initialSocPercent,
    maxDepthOfDischargePercent,
    resultRows: finiteNumber(result.result_rows),
    simulationExecuted: result.simulation_executed === true,
    solarArrayEnergy: finiteNumber(result.solar_array_energy),
    solarSections: finiteNumber(result.solar_sections),
    stopCondition,
  }
}
