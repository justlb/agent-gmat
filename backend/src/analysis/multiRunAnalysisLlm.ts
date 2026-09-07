import fs from "node:fs/promises"
import path from "node:path"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import {
  analysisContextForPrompt,
  loadRunAnalysisContext,
  writeRunAnalysisContext,
  type RunAnalysisContext,
} from "./runAnalysisContext.js"

const MAX_RUNS = 5

type JsonRecord = Record<string, unknown>

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

type ComparisonRow = {
  runId: string | null
  template: string | null
  satelliteName: string | null
  gmatStatus: string
  finalAltitudeKm: number | null
  finalFuelMassKg: number | null
  fuelUsedKg: number | null
  blockerCount: number
  warningCount: number
  infoCount: number
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  return null
}

function verdictCounts(context: RunAnalysisContext) {
  let blockers = 0
  let warnings = 0
  let infos = 0
  for (const verdict of context.verdicts) {
    if (verdict.level === "blocker") blockers++
    else if (verdict.level === "warning") warnings++
    else infos++
  }
  return { blockers, warnings, infos }
}

function buildComparisonRow(context: RunAnalysisContext): ComparisonRow {
  const counts = verdictCounts(context)
  const gmat = isRecord(context.results?.gmat) ? context.results.gmat : {}
  const gmatMetrics = isRecord(gmat.metrics) ? gmat.metrics : {}
  const satellite = isRecord(context.configuration?.satellite) ? context.configuration.satellite : {}
  const name = satellite.name
  return {
    runId: context.run.id,
    template: context.run.template,
    satelliteName: typeof name === "string" ? name : null,
    gmatStatus: typeof gmat.status === "string" ? gmat.status : "unknown",
    finalAltitudeKm: finiteNumber(gmatMetrics.finalAltitudeKm),
    finalFuelMassKg: finiteNumber(gmatMetrics.finalFuelMassKg),
    fuelUsedKg: finiteNumber(gmatMetrics.fuelUsedBetweenReportsKg),
    blockerCount: counts.blockers,
    warningCount: counts.warnings,
    infoCount: counts.infos,
  }
}

function comparisonTable(rows: ComparisonRow[]): string {
  const header = ["runId", "template", "satellite", "gmatStatus", "finalAltKm", "finalFuelKg", "fuelUsedKg", "blockers", "warnings", "infos"]
  const lines = [header.join(" | ")]
  for (const row of rows) {
    lines.push([
      row.runId ?? "?",
      row.template ?? "?",
      row.satelliteName ?? "?",
      row.gmatStatus,
      row.finalAltitudeKm?.toFixed(2) ?? "n/a",
      row.finalFuelMassKg?.toFixed(3) ?? "n/a",
      row.fuelUsedKg?.toFixed(3) ?? "n/a",
      String(row.blockerCount),
      String(row.warningCount),
      String(row.infoCount),
    ].join(" | "))
  }
  return lines.join("\n")
}

function responseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") return (payload as { output_text: string }).output_text.trim()
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const texts: string[] = []
  for (const item of Array.isArray(output) ? output : []) {
    for (const part of Array.isArray(item && typeof item === "object" ? (item as { content?: unknown }).content : undefined) ? (item as { content: unknown[] }).content : []) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") texts.push((part as { text: string }).text.trim())
    }
  }
  return texts.filter(Boolean).join("\n")
}

export async function analyzeMultipleRuns({
  connection,
  question,
  runDirs,
  timeoutMs = 90_000,
}: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">
  question: string
  runDirs: string[]
  timeoutMs?: number
}) {
  if (runDirs.length < 2) throw new Error("multi-run analysis requires at least 2 runs")
  if (runDirs.length > MAX_RUNS) throw new Error(`multi-run analysis supports at most ${MAX_RUNS} runs`)

  // Load or refresh the analysis context for every run in parallel.
  const contexts = await Promise.all(
    runDirs.map(async (runDir) => {
      const cached = await loadRunAnalysisContext(runDir)
      if (cached) return cached
      const result = await writeRunAnalysisContext(runDir)
      return result.context
    }),
  )

  // Read manifests for runId identification and conversation continuity.
  const manifests = await Promise.all(
    runDirs.map(async (runDir) => {
      const raw = await fs.readFile(path.join(runDir, "run_manifest.json"), "utf8").catch(() => "{}")
      return JSON.parse(raw) as { runId?: string }
    }),
  )

  const rows = contexts.map(buildComparisonRow)
  const table = comparisonTable(rows)

  const promptSections = [
    "You are a spacecraft engineering assistant comparing multiple immutable mission runs.",
    "Use only the supplied run-analysis contexts. Do not claim any tool was rerun.",
    "Cite the runId and source file for every factual conclusion.",
    "Distinguish facts reported by tools from engineering interpretation.",
    "When comparing runs, rank them by how well they meet mission objectives.",
    "If runs belong to different template families (e.g. chemical vs electric), note that some metrics are not directly comparable.",
    "State missing evidence explicitly — say what file or metric is needed.",
    "All four workflow stages must have completed before describing a run's pipeline as fully successful.",
    `Engineer question: ${question}`,
    `\nComparison table (deterministic, computed by the backend):\n${table}`,
    ...contexts.map((context, index) =>
      `\n--- Run ${index + 1}: ${context.run.id ?? "unknown"} ---\n${analysisContextForPrompt(context)}`,
    ),
  ]

  const response = await fetch(`${connection.baseUrl.replace(/\/+$/u, "")}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: connection.model,
      input: promptSections.join("\n\n"),
      max_output_tokens: 2400,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const source = await response.text()
  if (!response.ok) throw new Error(`multi-run analysis failed: HTTP ${response.status}`)
  const answer = responseText(JSON.parse(source))
  if (!answer) throw new Error("multi-run analysis returned no text")

  return {
    answer,
    runIds: manifests.map((m) => m.runId ?? null),
    comparison: rows,
  }
}
