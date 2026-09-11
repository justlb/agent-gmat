import fs from "node:fs/promises"
import path from "node:path"
import { stringify } from "yaml"

import { isMissionRunWorkspace } from "../digitalThread/digitalThreadStore.js"
import { beginRunStage, invalidateDownstreamFromGmat } from "../runs/runLifecycle.js"
import { updateRunManifest } from "../runs/runManifest.js"
import { runManagedProcess } from "./externalProcess.js"
import { snapshotRunArtifacts } from "./artifactHistory.js"
import type { ChemicalHohmannDraft } from "./chemicalHohmannDraft.js"
import { defaultChemicalHohmannTemplatePath } from "./chemicalHohmannTemplate.js"
import { toGmatNativePath } from "./orbitKeepingRunner.js"
import { assertGmatMissionGuardrails } from "./missionGuardrails.js"

export type ChemicalHohmannRenderValues = {
  "initialOrbit.argPeriapsisDeg"?: number | null
  "initialOrbit.eccentricity": number | null
  "initialOrbit.epoch": string | number | null
  "initialOrbit.inclinationDeg": number | null
  "initialOrbit.raanDeg"?: number | null
  "initialOrbit.smaKm": number | null
  "initialOrbit.trueAnomalyDeg"?: number | null
  "propulsion.ispSeconds": number | null
  "spacecraft.dragAreaM2": number | null
  "spacecraft.dragCoefficient": number | null
  "spacecraft.dryMassKg": number | null
  "spacecraft.initialFuelMassKg"?: number | null
  "transfer.finalPropagationSeconds": number | null
  "transfer.targetEccentricity": number | null
  "transfer.targetRadiusKm": number | null
}

export type ChemicalHohmannGenerationResult = {
  manifestPath: string
  result: { error?: string; executionDurationMs?: number; status: "generated" | "completed" | "failed" | "timeout" }
  resultPath: string
  runDir: string
  runId: string
  scriptPath: string
  valuesPath: string
}

const CHEMICAL_HOHMANN_MUTABLE_ARTIFACTS = [
  "EphemerisFile1.oem", "ReportFile1.txt", "chemical_hohmann_timeseries.json", "chemical_hohmann_transfer.script", "chemical_hohmann_transfer.values.yaml", "gmat.log", "gmat_result.json", "run_manifest.json", "satellite.json",
]

/** Freezes the active Hohmann workspace after every execution. */
export function snapshotChemicalHohmannExecution(runDir: string) {
  return snapshotRunArtifacts(runDir, "gmat", CHEMICAL_HOHMANN_MUTABLE_ARTIFACTS)
}

function finiteNumber(values: ChemicalHohmannRenderValues, field: keyof ChemicalHohmannRenderValues) {
  const value = values[field]
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`chemical Hohmann template requires ${field}`)
  return value
}
function numericEpoch(values: ChemicalHohmannRenderValues) {
  const value = values["initialOrbit.epoch"]
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+(?:\.\d+)?$/u.test(String(value).trim())) throw new Error("chemical Hohmann template requires a numeric initial epoch")
  return String(value).trim()
}
function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") }
function replaceSingleAssignment(script: string, property: string, value: string) {
  const matcher = new RegExp(`^(${escapeRegExp(property)}\\s*=\\s*)[^;]+;$`, "mu")
  if (!matcher.test(script)) throw new Error(`chemical Hohmann template does not expose ${property}`)
  return script.replace(matcher, `$1${value};`)
}
function replaceSingle(script: string, matcher: RegExp, replacement: string, label: string) {
  const matches = script.match(matcher)
  if (!matches || matches.length !== 1) throw new Error(`chemical Hohmann template does not expose exactly one ${label} slot`)
  return script.replace(matcher, replacement)
}

/**
 * Deterministically renders only the documented values from satellite.json
 * and the mission draft. Line endings are normalized so templates edited in
 * any editor keep matching the line-anchored slot expressions below.
 */
export function renderChemicalHohmannScript(template: string, values: ChemicalHohmannRenderValues) {
  let rendered = template.replace(/\r\n?/gu, "\n")
  for (const [property, value] of Object.entries({
    "DefaultSC.Epoch": `'${numericEpoch(values)}'`,
    "DefaultSC.SMA": String(finiteNumber(values, "initialOrbit.smaKm")),
    "DefaultSC.ECC": String(finiteNumber(values, "initialOrbit.eccentricity")),
    "DefaultSC.INC": String(finiteNumber(values, "initialOrbit.inclinationDeg")),
    "DefaultSC.RAAN": String(values["initialOrbit.raanDeg"] ?? 0),
    "DefaultSC.AOP": String(values["initialOrbit.argPeriapsisDeg"] ?? 0),
    "DefaultSC.TA": String(values["initialOrbit.trueAnomalyDeg"] ?? 0),
    "DefaultSC.DryMass": String(finiteNumber(values, "spacecraft.dryMassKg")),
    "DefaultSC.Cd": String(finiteNumber(values, "spacecraft.dragCoefficient")),
    "DefaultSC.DragArea": String(finiteNumber(values, "spacecraft.dragAreaM2")),
    "ChemicalTank1.FuelMass": String(finiteNumber(values, "spacecraft.initialFuelMassKg")),
    "TOI.Isp": String(finiteNumber(values, "propulsion.ispSeconds")),
    "GOI.Isp": String(finiteNumber(values, "propulsion.ispSeconds")),
  })) rendered = replaceSingleAssignment(rendered, property, value)
  rendered = replaceSingle(rendered, /DefaultSC\.Earth\.RMAG\s*=\s*[-+0-9.eE]+/gu, `DefaultSC.Earth.RMAG = ${finiteNumber(values, "transfer.targetRadiusKm")}`, "target radius")
  rendered = replaceSingle(rendered, /DefaultSC\.Earth\.ECC\s*=\s*[-+0-9.eE]+/gu, `DefaultSC.Earth.ECC = ${finiteNumber(values, "transfer.targetEccentricity")}`, "target eccentricity")
  rendered = replaceSingle(rendered, /DefaultSC\.ElapsedSecs\s*=\s*[-+0-9.eE]+/gu, `DefaultSC.ElapsedSecs = ${finiteNumber(values, "transfer.finalPropagationSeconds")}`, "final propagation duration")
  return rendered
}

/** The reference script stays byte-for-byte intact in references/. When the
 * template does not declare the OEM subscriber (tutorial-style source), the
 * run extension is inserted here so downstream Simu-CIC receives the OEM
 * trajectory required by the digital thread. Templates that already declare
 * EphemerisFile1 only get their output redirected into the run directory. */
export function addHohmannEphemerisWriter(script: string, outputPath: string, reportPath?: string) {
  const nativeOutput = toGmatNativePath(outputPath).replace(/\\/gu, "/")
  if (!/^BeginMissionSequence;$/mu.test(script)) throw new Error("chemical Hohmann template does not expose BeginMissionSequence")
  let withSubscriber = script
  // Redirect the report file into the run directory so downstream parsing can
  // find it. GMAT writes relative paths to its own working directory otherwise.
  if (reportPath && /^ReportFile1\.Filename\s*=\s*[^;]+;$/mu.test(withSubscriber)) {
    const nativeReport = toGmatNativePath(reportPath).replace(/\\/gu, "/")
    withSubscriber = replaceSingle(withSubscriber, /^ReportFile1\.Filename\s*=\s*[^;]+;$/mu, `ReportFile1.Filename = '${nativeReport}';`, "ReportFile1 filename")
  }
  // The differential corrector also writes an iteration report. GMAT resolves
  // a relative path against its installation directory, which can be read-only.
  // Keep that solver artifact with the run so the Hohmann targeter can execute.
  if (/^DC1\.ReportFile\s*=\s*[^;]+;$/mu.test(withSubscriber)) {
    const solverReport = toGmatNativePath(path.join(path.dirname(outputPath), "DifferentialCorrectorDC1.data")).replace(/\\/gu, "/")
    withSubscriber = replaceSingle(withSubscriber, /^DC1\.ReportFile\s*=\s*[^;]+;$/mu, `DC1.ReportFile = '${solverReport}';`, "DC1 solver report filename")
  }
  if (/^Create EphemerisFile EphemerisFile1;$/mu.test(withSubscriber)) {
    withSubscriber = replaceSingle(withSubscriber, /^EphemerisFile1\.Filename\s*=\s*[^;]+;$/mu, `EphemerisFile1.Filename = '${nativeOutput}';`, "EphemerisFile1 filename")
  } else {
    const block = [
      "Create EphemerisFile EphemerisFile1;",
      "EphemerisFile1.Spacecraft = DefaultSC;",
      `EphemerisFile1.Filename = '${nativeOutput}';`,
      "EphemerisFile1.FileFormat = CCSDS-OEM;",
      "EphemerisFile1.EpochFormat = UTCGregorian;",
      "EphemerisFile1.InitialEpoch = InitialSpacecraftEpoch;",
      "EphemerisFile1.FinalEpoch = FinalSpacecraftEpoch;",
      "EphemerisFile1.StepSize = IntegratorSteps;",
      "EphemerisFile1.Interpolator = Lagrange;",
      "EphemerisFile1.InterpolationOrder = 7;",
      "EphemerisFile1.CoordinateSystem = EarthMJ2000Eq;",
      "EphemerisFile1.OutputFormat = LittleEndian;",
      "EphemerisFile1.IncludeCovariance = None;",
      "EphemerisFile1.WriteEphemeris = true;",
      "",
    ].join("\n")
    // Creating an EphemerisFile object only declares the subscriber. GMAT does
    // not write samples until it is explicitly enabled in the mission sequence.
    // This mirrors the proven orbit-keeping and electric-transfer pipelines.
    withSubscriber = withSubscriber.replace(
      /^BeginMissionSequence;$/mu,
      `${block}BeginMissionSequence;\n\n% Application instrumentation: activate the downstream OEM subscriber.\nToggle EphemerisFile1 On;`,
    )
  }
  // A declared subscriber that is never toggled on would silently produce an
  // empty OEM, so the mission sequence must enable it exactly once.
  if (!/^Toggle[^\n]*EphemerisFile1[^\n]*On;$/mu.test(withSubscriber)) {
    withSubscriber = withSubscriber.replace(
      /^BeginMissionSequence;$/mu,
      "BeginMissionSequence;\n\n% Application instrumentation: activate the downstream OEM subscriber.\nToggle EphemerisFile1 On;",
    )
  }
  const reportCommand = "Report ReportFile1 DefaultSC.ElapsedSecs DefaultSC.Earth.Altitude DefaultSC.ChemicalTank1.FuelMass;"
  const hasReportFile = /^Create ReportFile ReportFile1;$/mu.test(withSubscriber)
  // GMAT's ReportFile subscriber does not emit rows reliably from a solved
  // Target block. Explicit Report commands create the chart data product at
  // the initial state, the converged transfer state, and every output step.
  if (hasReportFile && !/^Report ReportFile1 DefaultSC\.ElapsedSecs DefaultSC\.Earth\.Altitude DefaultSC\.ChemicalTank1\.FuelMass;$/mu.test(withSubscriber)) {
    withSubscriber = replaceSingle(
      withSubscriber,
      /^Toggle(?=[^\n]*\bReportFile1\b)[^\n]*\bOn;$/mu,
      `$&\n${reportCommand}`,
      "ReportFile1 activation",
    )
    withSubscriber = replaceSingle(
      withSubscriber,
      /^EndTarget;[^\n]*$/mu,
      `$&\n${reportCommand}`,
      "Hohmann target completion",
    )
  }
  // The tutorial's last propagation is a single "propagate to epoch" command.
  // GMAT's console can complete that command without emitting subscriber
  // samples, leaving a zero-byte OEM. Use the same one-integrator-step loop
  // already proven in the electric-transfer pipeline. The loop has the exact
  // same final elapsed-seconds target as the tutorial command.
  const finalPropagation = /Propagate 'Prop One Day' DefaultProp\(DefaultSC\) \{DefaultSC\.ElapsedSecs = ([-+0-9.eE]+)\};/u
  const match = withSubscriber.match(finalPropagation)
  if (!match) throw new Error("chemical Hohmann template does not expose its final propagation command")
  return withSubscriber.replace(finalPropagation, [
    `While 'Sample post-transfer trajectory for OEM output' DefaultSC.ElapsedSecs < ${match[1]}`,
    "   Propagate 'Propagate one output step' DefaultProp(DefaultSC);",
    ...(hasReportFile ? [`   ${reportCommand}`] : []),
    "EndWhile;",
  ].join("\n"))
}

/** Parses the 3-column GMAT ReportFile1 (ElapsedSecs, Altitude, FuelMass) into
 * the unified time-series format consumed by the results frontend. */
export function parseChemicalHohmannReport(source: string) {
  const samples: Array<{ elapsedDays: number; altitudeKm: number; fuelMassKg: number }> = []
  for (const line of source.split(/\r?\n/u)) {
    const values = line.trim().split(/\s+/u).map(Number)
    // GMAT can emit scientific notation, so validate parsed values rather than
    // filtering characters before Number has a chance to interpret them.
    if (values.length !== 3 || values.some(value => !Number.isFinite(value))) continue
    samples.push({ elapsedDays: values[0] / 86_400, altitudeKm: values[1], fuelMassKg: values[2] })
  }
  return samples
}

export async function generateChemicalHohmannMission({ draft, workspaceDir, templatePath = defaultChemicalHohmannTemplatePath(), execution }: { draft: ChemicalHohmannDraft; workspaceDir: string; templatePath?: string; execution?: { bin: string; timeoutMs: number } }): Promise<ChemicalHohmannGenerationResult> {
  if (!draft.confirmed) throw new Error("chemical Hohmann GMAT draft must be confirmed before generation")
  assertGmatMissionGuardrails("chemical-hohmann-transfer", draft.values)
  const runDir = path.resolve(workspaceDir)
  if (!isMissionRunWorkspace(runDir)) throw new Error("chemical Hohmann generation requires a dated mission run workspace")
  const [template] = await Promise.all([fs.readFile(templatePath, "utf8"), fs.mkdir(runDir, { recursive: true })])
  const values = draft.values as ChemicalHohmannRenderValues
  const ephemerisPath = path.join(runDir, "EphemerisFile1.oem")
  const reportPath = path.join(runDir, "ReportFile1.txt")
  const timeSeriesPath = path.join(runDir, "chemical_hohmann_timeseries.json")
  const script = addHohmannEphemerisWriter(renderChemicalHohmannScript(template, values), ephemerisPath, reportPath)
  const scriptPath = path.join(runDir, "chemical_hohmann_transfer.script")
  const valuesPath = path.join(runDir, "chemical_hohmann_transfer.values.yaml")
  const resultPath = path.join(runDir, "gmat_result.json")
  const manifestPath = path.join(runDir, "run_manifest.json")
  const runId = path.basename(runDir)
  const createdAt = new Date().toISOString()
  const logPath = path.join(runDir, "gmat.log")
  await Promise.all([
    fs.writeFile(scriptPath, script, "utf8"),
    fs.writeFile(valuesPath, stringify({ draft_id: draft.draftId, template_id: draft.templateId, values: draft.values }), "utf8"),
  ])
  let executionResult: { durationMs: number; error?: string; exitCode: number | null; status: "completed" | "failed" | "timeout" } | undefined
  if (execution) {
    await beginRunStage(runDir, "gmat", "GMAT simulation is running.")
    const started = Date.now()
    const { exitCode, output, timedOut } = await runManagedProcess({ args: ["--run", toGmatNativePath(scriptPath)], command: execution.bin, cwd: runDir, timeoutMs: execution.timeoutMs })
    await fs.writeFile(logPath, output)
    const oemWasWritten = exitCode === 0 && await fs.stat(ephemerisPath).then(stat => stat.size > 0).catch(() => false)
    const status = timedOut ? "timeout" : exitCode === 0 && oemWasWritten ? "completed" : "failed"
    executionResult = { durationMs: Date.now() - started, exitCode, status, ...(status === "completed" ? {} : { error: timedOut ? `GMAT timed out after ${execution.timeoutMs} ms` : exitCode === null ? "GMAT could not be started" : exitCode === 0 ? "GMAT completed but did not produce EphemerisFile1.oem" : `GMAT exited with code ${exitCode}` }) }
  }
  // Parse the GMAT report into a time-series JSON so the results frontend can
  // display altitude/fuel graphs without coupling to the GMAT report format.
  const reportSamples = executionResult?.status === "completed"
    ? parseChemicalHohmannReport(await fs.readFile(reportPath, "utf8").catch(() => ""))
    : []
  const missingReportError = executionResult?.status === "completed" && reportSamples.length === 0
    ? "GMAT completed but did not produce a parseable ReportFile1.txt time series."
    : undefined
  const result: ChemicalHohmannGenerationResult["result"] & { reportSampleCount: number; timeSeriesSampleCount: number } = { status: missingReportError ? "failed" : executionResult?.status ?? "generated", reportSampleCount: reportSamples.length, timeSeriesSampleCount: reportSamples.length, ...(missingReportError ? { error: missingReportError } : executionResult?.error ? { error: executionResult.error } : {}), ...(executionResult ? { executionDurationMs: executionResult.durationMs } : {}) }
  const manifest = { schemaVersion: 1, runId, tool: "GMAT", templateId: "chemical-hohmann-transfer", status: result.status, request: "Deterministic chemical Hohmann transfer", createdAt, completedAt: executionResult ? new Date().toISOString() : null, inputs: { script: path.basename(scriptPath), values: path.basename(valuesPath) }, outputs: { result: path.basename(resultPath), report: reportSamples.length ? path.basename(reportPath) : null, ephemeris: result.status === "completed" ? path.basename(ephemerisPath) : null, log: executionResult ? path.basename(logPath) : null } }
  await Promise.all([
    fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    fs.writeFile(timeSeriesPath, `${JSON.stringify(reportSamples, null, 2)}\n`, "utf8"),
    updateRunManifest(runDir, manifest),
  ])
  await invalidateDownstreamFromGmat(runDir)
  return { manifestPath, result, resultPath, runDir, runId, scriptPath, valuesPath }
}
