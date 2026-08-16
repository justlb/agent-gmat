import fs from "node:fs/promises"
import { spawn } from "node:child_process"
import path from "node:path"
import { stringify } from "yaml"

import { isMissionRunWorkspace } from "../digitalThread/digitalThreadStore.js"
import { updateRunWorkflowLog } from "../opalis/workflowRunLog.js"
import { registerActiveCalculation, unregisterActiveCalculation } from "./activeCalculationRegistry.js"
import { keplerianToCartesian } from "./orbitCoordinates.js"
import type { ChemicalHohmannDraft } from "./chemicalHohmannDraft.js"
import { defaultChemicalHohmannTemplatePath } from "./chemicalHohmannTemplate.js"
import { toGmatNativePath } from "./orbitKeepingRunner.js"

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
 * and the mission draft. The tutorial source remains immutable.
 */
export function renderChemicalHohmannScript(template: string, values: ChemicalHohmannRenderValues) {
  const cartesian = keplerianToCartesian({
    semiMajorAxisKm: finiteNumber(values, "initialOrbit.smaKm"),
    eccentricity: finiteNumber(values, "initialOrbit.eccentricity"),
    inclinationDeg: finiteNumber(values, "initialOrbit.inclinationDeg"),
    raanDeg: values["initialOrbit.raanDeg"] ?? 0,
    argPeriapsisDeg: values["initialOrbit.argPeriapsisDeg"] ?? 0,
    trueAnomalyDeg: values["initialOrbit.trueAnomalyDeg"] ?? 0,
  })
  let rendered = template
  for (const [property, value] of Object.entries({
    "DefaultSC.Epoch": `'${numericEpoch(values)}'`,
    "DefaultSC.X": String(cartesian.xKm), "DefaultSC.Y": String(cartesian.yKm), "DefaultSC.Z": String(cartesian.zKm),
    "DefaultSC.VX": String(cartesian.vxKmPerSec), "DefaultSC.VY": String(cartesian.vyKmPerSec), "DefaultSC.VZ": String(cartesian.vzKmPerSec),
    "DefaultSC.DryMass": String(finiteNumber(values, "spacecraft.dryMassKg")),
    "DefaultSC.Cd": String(finiteNumber(values, "spacecraft.dragCoefficient")),
    "DefaultSC.DragArea": String(finiteNumber(values, "spacecraft.dragAreaM2")),
    "TOI.Isp": String(finiteNumber(values, "propulsion.ispSeconds")),
    "GOI.Isp": String(finiteNumber(values, "propulsion.ispSeconds")),
  })) rendered = replaceSingleAssignment(rendered, property, value)
  rendered = replaceSingle(rendered, /DefaultSC\.Earth\.RMAG\s*=\s*[-+0-9.eE]+/gu, `DefaultSC.Earth.RMAG = ${finiteNumber(values, "transfer.targetRadiusKm")}`, "target radius")
  rendered = replaceSingle(rendered, /DefaultSC\.Earth\.ECC\s*=\s*[-+0-9.eE]+/gu, `DefaultSC.Earth.ECC = ${finiteNumber(values, "transfer.targetEccentricity")}`, "target eccentricity")
  rendered = replaceSingle(rendered, /DefaultSC\.ElapsedSecs\s*=\s*[-+0-9.eE]+/gu, `DefaultSC.ElapsedSecs = ${finiteNumber(values, "transfer.finalPropagationSeconds")}`, "final propagation duration")
  return rendered
}

/** The tutorial itself stays byte-for-byte intact in references/. This run
 * extension is inserted only in the generated script so downstream Simu-CIC
 * receives the OEM trajectory required by the digital thread. */
function addHohmannEphemerisWriter(script: string, outputPath: string) {
  const nativeOutput = toGmatNativePath(outputPath).replace(/\\/gu, "/")
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
  if (!/^BeginMissionSequence;$/mu.test(script)) throw new Error("chemical Hohmann template does not expose BeginMissionSequence")
  return script.replace(/^BeginMissionSequence;$/mu, `${block}BeginMissionSequence;`)
}

export async function generateChemicalHohmannMission({ draft, workspaceDir, templatePath = defaultChemicalHohmannTemplatePath(), execution }: { draft: ChemicalHohmannDraft; workspaceDir: string; templatePath?: string; execution?: { bin: string; timeoutMs: number } }): Promise<ChemicalHohmannGenerationResult> {
  if (!draft.confirmed) throw new Error("chemical Hohmann GMAT draft must be confirmed before generation")
  const runDir = path.resolve(workspaceDir)
  if (!isMissionRunWorkspace(runDir)) throw new Error("chemical Hohmann generation requires a dated mission run workspace")
  const [template] = await Promise.all([fs.readFile(templatePath, "utf8"), fs.mkdir(runDir, { recursive: true })])
  const values = draft.values as ChemicalHohmannRenderValues
  const ephemerisPath = path.join(runDir, "EphemerisFile1.oem")
  const script = addHohmannEphemerisWriter(renderChemicalHohmannScript(template, values), ephemerisPath)
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
    const started = Date.now()
    const chunks: Buffer[] = []
    let timedOut = false
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(execution.bin, ["--run", toGmatNativePath(scriptPath)], { cwd: runDir, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
      registerActiveCalculation(runDir, child)
      child.stdout.on("data", chunk => chunks.push(Buffer.from(chunk)))
      child.stderr.on("data", chunk => chunks.push(Buffer.from(chunk)))
      child.once("error", error => { unregisterActiveCalculation(runDir, child); reject(error) })
      child.once("close", code => { unregisterActiveCalculation(runDir, child); resolve(code) })
      const timeout = setTimeout(() => { timedOut = true; child.kill("SIGKILL") }, execution.timeoutMs)
      child.once("close", () => clearTimeout(timeout))
    }).catch(error => { chunks.push(Buffer.from(error instanceof Error ? error.message : String(error))); return null })
    await fs.writeFile(logPath, Buffer.concat(chunks))
    const oemWasWritten = exitCode === 0 && await fs.stat(ephemerisPath).then(stat => stat.size > 0).catch(() => false)
    const status = timedOut ? "timeout" : exitCode === 0 && oemWasWritten ? "completed" : "failed"
    executionResult = { durationMs: Date.now() - started, exitCode, status, ...(status === "completed" ? {} : { error: timedOut ? `GMAT timed out after ${execution.timeoutMs} ms` : exitCode === null ? "GMAT could not be started" : exitCode === 0 ? "GMAT completed but did not produce EphemerisFile1.oem" : `GMAT exited with code ${exitCode}` }) }
  }
  const result: ChemicalHohmannGenerationResult["result"] & { reportSampleCount: number; timeSeriesSampleCount: number } = { status: executionResult?.status ?? "generated", reportSampleCount: 0, timeSeriesSampleCount: 0, ...(executionResult?.error ? { error: executionResult.error } : {}), ...(executionResult ? { executionDurationMs: executionResult.durationMs } : {}) }
  const manifest = { schemaVersion: 1, runId, tool: "GMAT", templateId: "chemical-hohmann-transfer", status: result.status, request: "Deterministic chemical Hohmann transfer", createdAt, completedAt: executionResult ? new Date().toISOString() : null, inputs: { script: path.basename(scriptPath), values: path.basename(valuesPath) }, outputs: { result: path.basename(resultPath), report: null, ephemeris: executionResult?.status === "completed" ? path.basename(ephemerisPath) : null, log: executionResult ? path.basename(logPath) : null } }
  await Promise.all([
    fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  ])
  await updateRunWorkflowLog(runDir, "simu_cic", "not_started", null)
  return { manifestPath, result, resultPath, runDir, runId, scriptPath, valuesPath }
}
