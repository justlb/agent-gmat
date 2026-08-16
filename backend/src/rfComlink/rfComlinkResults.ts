import fs from "node:fs/promises"
import path from "node:path"

export type RFComlinkResultSummary = {
  link_files: string[]
  reports: Array<{ path: string; text: string }>
  scenario: string
  schema_version: number
  sha256: string
}

export async function loadRFComlinkResultSummary(runDir: string): Promise<RFComlinkResultSummary | null> {
  const source = await fs.readFile(path.join(runDir, "rf-comlink", "03-results", "rf-comlink-results.json"), "utf8").catch(() => null)
  if (!source) return null
  const parsed = JSON.parse(source) as Partial<RFComlinkResultSummary>
  if (!Array.isArray(parsed.reports) || !Array.isArray(parsed.link_files) || typeof parsed.scenario !== "string" || typeof parsed.sha256 !== "string") return null
  return {
    link_files: parsed.link_files.filter((value): value is string => typeof value === "string"),
    reports: parsed.reports.filter((value): value is { path: string; text: string } => Boolean(value && typeof value.path === "string" && typeof value.text === "string")),
    scenario: parsed.scenario,
    schema_version: typeof parsed.schema_version === "number" ? parsed.schema_version : 1,
    sha256: parsed.sha256,
  }
}
