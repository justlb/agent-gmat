import fs from "node:fs/promises"
import path from "node:path"

type MissionValues = Record<string, string | number | null>
type ComparableRun = {
  completedAt: string
  missionValues?: MissionValues
  result: Record<string, unknown>
  runId: string
  runPath: string
}

export type RunComparisonEntry = {
  changed_from_previous: Array<{ from: string | number | null; path: string; to: string | number | null }>
  completed_at: string
  mission_values: MissionValues
  result: Record<string, unknown>
  run_id: string
  run_path: string
}

function changedValues(current: MissionValues | undefined, previous: MissionValues | undefined) {
  if (!current || !previous) return []
  return Array.from(new Set([...Object.keys(current), ...Object.keys(previous)])).sort()
    .filter(key => current[key] !== previous[key])
    .map(path => ({ from: previous[path] ?? null, path, to: current[path] ?? null }))
}

/** Returns the concise comparison payload used both on disk and in LLM context. */
export function buildDraftRunComparisonEntries(runs: ComparableRun[]): RunComparisonEntry[] {
  const ordered = [...runs].sort((left, right) => left.completedAt.localeCompare(right.completedAt))
  return ordered.map((run, index) => ({
    changed_from_previous: changedValues(run.missionValues, ordered[index - 1]?.missionValues),
    completed_at: run.completedAt,
    mission_values: run.missionValues ?? {},
    result: run.result,
    run_id: run.runId,
    run_path: run.runPath,
  }))
}

/** Compact, immutable-run index for one mission discussion. The large source
 * artifacts remain in their dated run directories; this file is the stable
 * comparison context for the UI and LLM. */
export async function writeDraftRunComparisonIndex({ draftDirectory, runs, templateId }: {
  draftDirectory: string
  runs: ComparableRun[]
  templateId: string
}) {
  const entries = buildDraftRunComparisonEntries(runs)
  const output = path.join(draftDirectory, "run-comparison.json")
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify({ entries, generated_at: new Date().toISOString(), schema_version: 1, template_id: templateId }, null, 2)}\n`, "utf8")
  return { entries, output }
}
