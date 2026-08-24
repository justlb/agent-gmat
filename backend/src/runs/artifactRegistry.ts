/**
 * Role: Canonical inventory of artifacts emitted inside one dated mission run.
 * Exports: artifact lookup, content-type and tool grouping helpers.
 * Dependencies: none.
 * Invariant: paths are relative to the run directory; no HTTP route maintains
 * its own artifact whitelist for downstream tool outputs.
 */
export type RunArtifactCategory = "primary" | "result" | "technical"
export type RunArtifactTool = "gmat" | "simu-cic" | "opalis" | "rf-comlink"

export type RunArtifactDefinition = {
  category: RunArtifactCategory
  contentType: string
  id: string
  kind: string
  primary?: boolean
  relativePath: string
  tool: RunArtifactTool
}

export const RUN_ARTIFACTS = [
  { id: "satellite", tool: "gmat", category: "primary", kind: "digital-thread", contentType: "application/json; charset=utf-8", relativePath: "satellite.json", primary: true },
  { id: "gmat-ephemeris", tool: "gmat", category: "primary", kind: "ephemeris", contentType: "text/plain; charset=utf-8", relativePath: "EphemerisFile1.oem", primary: true },
  { id: "gmat-workflow", tool: "gmat", category: "result", kind: "result", contentType: "application/json; charset=utf-8", relativePath: "workflow-status.json" },
  { id: "consolidated-report", tool: "gmat", category: "result", kind: "result", contentType: "application/json; charset=utf-8", relativePath: "consolidated-run-report.json" },
  { id: "run-analysis-context", tool: "gmat", category: "technical", kind: "result", contentType: "application/json; charset=utf-8", relativePath: "run-analysis-context.json" },
  { id: "simucic-definition", tool: "simu-cic", category: "technical", kind: "opalis", contentType: "application/json; charset=utf-8", relativePath: "opalis/02-simu-cic/simucic.definition.json" },
  { id: "simucic-input", tool: "simu-cic", category: "technical", kind: "opalis", contentType: "text/plain; charset=utf-8", relativePath: "opalis/02-simu-cic/00-scenario-input/simucic-input.scd" },
  { id: "opalis-parameters", tool: "opalis", category: "technical", kind: "opalis", contentType: "application/json; charset=utf-8", relativePath: "opalis/02-opalis-input/opalis-parameters.json" },
  { id: "opalis-prepared", tool: "opalis", category: "technical", kind: "opalis", contentType: "application/octet-stream", relativePath: "opalis/03-opalis/02-resultats/prepared-opalis.opalis" },
  { id: "opalis-prepared-data", tool: "opalis", category: "technical", kind: "opalis", contentType: "application/json; charset=utf-8", relativePath: "opalis/03-opalis/02-resultats/prepared-opalis.json" },
  { id: "opalis-calculated", tool: "opalis", category: "technical", kind: "opalis", contentType: "application/octet-stream", relativePath: "opalis/03-opalis/02-resultats/calculated-opalis.opalis" },
  { id: "opalis-result", tool: "opalis", category: "result", kind: "opalis", contentType: "application/json; charset=utf-8", relativePath: "opalis/03-opalis/02-resultats/calculated-opalis.json" },
  { id: "rf-inputs", tool: "rf-comlink", category: "technical", kind: "rf-comlink", contentType: "application/json; charset=utf-8", relativePath: "rf-comlink/01-input/rf-comlink-inputs.json" },
  { id: "rf-prepared", tool: "rf-comlink", category: "technical", kind: "rf-comlink", contentType: "application/octet-stream", relativePath: "rf-comlink/02-scenario/prepared-rf-comlink.rfcl" },
  { id: "rf-calculated", tool: "rf-comlink", category: "technical", kind: "rf-comlink", contentType: "application/octet-stream", relativePath: "rf-comlink/03-results/calculated-rf-comlink.rfcl" },
  { id: "rf-results", tool: "rf-comlink", category: "result", kind: "rf-comlink", contentType: "application/json; charset=utf-8", relativePath: "rf-comlink/03-results/rf-comlink-results.json" },
  { id: "rf-log", tool: "rf-comlink", category: "technical", kind: "rf-comlink", contentType: "text/plain; charset=utf-8", relativePath: "rf-comlink/03-results/rf-comlink-calculation.log" },
] as const satisfies readonly RunArtifactDefinition[]

function normalized(relativePath: string) { return relativePath.replace(/\\/gu, "/") }

/** Finds fixed artifacts and generated Simu-CIC scenarios using one registry. */
export function artifactDefinitionForPath(relativePath: string): RunArtifactDefinition | null {
  const candidate = normalized(relativePath)
  const fixed = RUN_ARTIFACTS.find(artifact => artifact.relativePath === candidate)
  if (fixed) return fixed
  if (/^opalis\/02-simu-cic\/01-execution-complete\/[^/]+\.scd$/u.test(candidate)) {
    return { id: "simucic-executed-scenario", tool: "simu-cic", category: "technical", kind: "opalis", contentType: "text/plain; charset=utf-8", relativePath: candidate }
  }
  const rootArtifacts: Array<[RegExp, string, string]> = [
    [/^conversation\.json$/u, "conversation", "application/json; charset=utf-8"],
    [/^run_manifest\.json$/u, "manifest", "application/json; charset=utf-8"],
    [/^gmat_result\.json$/u, "result", "application/json; charset=utf-8"],
    [/^(?:orbit|electric_transfer)_timeseries\.json$/u, "timeseries", "application/json; charset=utf-8"],
    [/^electric_propulsion_calibration\.json$/u, "calibration", "application/json; charset=utf-8"],
    [/^[A-Za-z0-9_-]+\.script$/u, "script", "text/plain; charset=utf-8"],
    [/^[A-Za-z0-9_-]+\.values\.yaml$/u, "values", "application/x-yaml; charset=utf-8"],
    [/^(?:ReboostReport|OrbitAnalysisReport|ElectricTransferReport)\.txt$/u, "report", "text/plain; charset=utf-8"],
    [/^gmat\.log$/u, "log", "text/plain; charset=utf-8"],
    [/^vts\/(?:gmat-orbit\.vts|Data\/GMAT_OEM_POSITION\.TXT)$/u, "vts", "text/plain; charset=utf-8"],
  ]
  const dynamic = rootArtifacts.find(([pattern]) => pattern.test(candidate))
  return dynamic
    ? { id: `gmat-${dynamic[1]}`, tool: "gmat", category: "technical", kind: dynamic[1], contentType: dynamic[2], relativePath: candidate }
    : null
}

export function artifactsForTool(tool: RunArtifactTool) {
  return RUN_ARTIFACTS.filter(artifact => artifact.tool === tool)
}

export function contentTypeForArtifact(kind: string) {
  if (["digital-thread", "manifest", "result", "timeseries", "calibration"].includes(kind)) return "application/json; charset=utf-8"
  if (kind === "values") return "application/x-yaml; charset=utf-8"
  return "text/plain; charset=utf-8"
}
