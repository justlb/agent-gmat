import fs from "node:fs/promises"
import path from "node:path"

export type RFComlinkResultSummary = {
  indicators: Array<{ metric: string; source_report: string; unit: string | null; value: number }>
  link_budgets: RFComlinkLinkBudget[]
  link_files: string[]
  reports: Array<{ path: string; text: string }>
  scenario: string
  schema_version: number
  sha256: string
}

export type RFComlinkBudgetCases = { nominal: number; three_sigma?: number; worst_case_rss?: number }
export type RFComlinkLinkBudget = {
  achieved_ebn0_db: RFComlinkBudgetCases | null
  binary_rate_bps: number | null
  data_recovery_margin_db: RFComlinkBudgetCases | null
  elevation_deg: number | null
  frequency_mhz: number | null
  link_name: string
  link_type: string | null
  range_km: number | null
  received_cn0_dbhz: RFComlinkBudgetCases | null
  required_ebn0_db: number | null
  source_report: string
  status: "pass" | "fail" | "unavailable"
  system_temperature_k: number | null
}

const INDICATOR_PATTERN = /\b(link\s+margin|availability|data\s*rate|bit\s*rate|received\s+power|eirp|c\s*\/\s*n(?:0)?|eb\s*\/\s*n0)\b\s*(?:[:=]|is)?\s*([-+]?\d+(?:[.,]\d+)?)\s*([A-Za-z%/]+)?/giu

/** Extract only labelled scalar values from RF-COMLINK's human-readable
 * reports. Unrecognised prose stays in the raw report artifact rather than
 * being guessed into an engineering metric. */
function extractIndicators(reports: Array<{ path: string; text: string }>) {
  const indicators: RFComlinkResultSummary["indicators"] = []
  for (const report of reports) {
    for (const match of report.text.matchAll(INDICATOR_PATTERN)) {
      const value = Number(match[2].replace(",", "."))
      if (!Number.isFinite(value)) continue
      indicators.push({
        metric: match[1].replace(/\s+/gu, " ").trim().toLowerCase(),
        source_report: report.path,
        unit: match[3]?.trim() || null,
        value,
      })
    }
  }
  return indicators
}

function finiteNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null }

function budgetCases(value: unknown): RFComlinkBudgetCases | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const nominal = finiteNumber((value as Record<string, unknown>).nominal)
  if (nominal === null) return null
  const threeSigma = finiteNumber((value as Record<string, unknown>).three_sigma)
  const worstCase = finiteNumber((value as Record<string, unknown>).worst_case_rss)
  return { nominal, ...(threeSigma === null ? {} : { three_sigma: threeSigma }), ...(worstCase === null ? {} : { worst_case_rss: worstCase }) }
}

function parseLinkBudgets(value: unknown): RFComlinkLinkBudget[] {
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const raw = item as Record<string, unknown>
    if (typeof raw.link_name !== "string" || typeof raw.source_report !== "string") return []
    const status = raw.status === "pass" || raw.status === "fail" || raw.status === "unavailable" ? raw.status : "unavailable"
    return [{
      achieved_ebn0_db: budgetCases(raw.achieved_ebn0_db), binary_rate_bps: finiteNumber(raw.binary_rate_bps),
      data_recovery_margin_db: budgetCases(raw.data_recovery_margin_db), elevation_deg: finiteNumber(raw.elevation_deg),
      frequency_mhz: finiteNumber(raw.frequency_mhz), link_name: raw.link_name, link_type: typeof raw.link_type === "string" ? raw.link_type : null,
      range_km: finiteNumber(raw.range_km), received_cn0_dbhz: budgetCases(raw.received_cn0_dbhz), required_ebn0_db: finiteNumber(raw.required_ebn0_db),
      source_report: raw.source_report, status, system_temperature_k: finiteNumber(raw.system_temperature_k),
    }]
  })
}

export async function loadRFComlinkResultSummary(runDir: string): Promise<RFComlinkResultSummary | null> {
  const source = await fs.readFile(path.join(runDir, "rf-comlink", "03-results", "rf-comlink-results.json"), "utf8").catch(() => null)
  if (!source) return null
  const parsed = JSON.parse(source) as Partial<RFComlinkResultSummary>
  if (!Array.isArray(parsed.reports) || !Array.isArray(parsed.link_files) || typeof parsed.scenario !== "string" || typeof parsed.sha256 !== "string") return null
  const reports = parsed.reports.filter((value): value is { path: string; text: string } => Boolean(value && typeof value.path === "string" && typeof value.text === "string"))
  return {
    indicators: extractIndicators(reports),
    link_budgets: parseLinkBudgets(parsed.link_budgets),
    link_files: parsed.link_files.filter((value): value is string => typeof value === "string"),
    reports,
    scenario: parsed.scenario,
    schema_version: typeof parsed.schema_version === "number" ? parsed.schema_version : 1,
    sha256: parsed.sha256,
  }
}
