import fs from "node:fs/promises"
import { createHash } from "node:crypto"
import path from "node:path"
import { stringify } from "yaml"

import { applyElectricPropulsionValueChanges, extractElectricPropulsionValues, renderElectricPropulsionValues, type ElectricPropulsionValueChange } from "./electricPropulsionValues.js"
import { runElectricPropulsionGmat, type ElectricPropulsionExecutionResult } from "./electricPropulsionRunner.js"
import { defaultElectricPropulsionTemplatePath } from "./electricPropulsionTemplate.js"
import { isMissionRunWorkspace } from "../digitalThread/digitalThreadStore.js"
import { beginRunStage, invalidateDownstreamFromGmat } from "../runs/runLifecycle.js"
import { updateRunManifest } from "../runs/runManifest.js"
import { toGmatNativePath } from "./orbitKeepingRunner.js"

export type ElectricPropulsionProgress = { key: "load_template" | "llm_patch" | "render_script" | "run_gmat" | "save_results"; percent: number; status: "running" | "completed" }
export type ElectricPropulsionRunResult = {
  error?: string
  executionDurationMs?: number
  finalFuelMassKg?: number
  finalRadiusKm?: number
  fuelUsedBetweenReportsKg?: number
  maximumReportedThrustPowerKw?: number
  minimumUsablePowerKw?: number
  powerEligibleSampleCount?: number
  reportSampleCount: number
  status: "generated" | ElectricPropulsionExecutionResult["status"]
  timeSeriesSampleCount: number
  warnings?: string[]
}
export type GenerateElectricPropulsionMissionResult = {
  calibrationPath?: string
  changes: ElectricPropulsionValueChange[]
  ephemerisPath: string
  latencyMs: number
  manifestPath: string
  result: ElectricPropulsionRunResult
  resultPath: string
  runDir: string
  runId: string
  scriptPath: string
  timeSeriesPath: string
  valuesPath: string
}

/**
 * The source template remains a validated GMAT reference.  This describes the
 * per-run translation of the selected satellite's electric propulsion model
 * into the generated GMAT script, rather than editing that reference file.
 */
type SatelliteElectricPropulsionCalibration = {
  dutyCycle: number
  fixedEfficiency: number
  ispSeconds: number
  nominalPowerKw: number
  nominalThrustNewtons: number
  source: {
    isp: string
    dutyCycle: string
    power: string
    thrust: string
  }
}

function positiveNumberAt(value: unknown, path: string) {
  const result = path.split(".").reduce<unknown>((current, key) => current && typeof current === "object" ? (current as Record<string, unknown>)[key] : undefined, value)
  return typeof result === "number" && Number.isFinite(result) && result > 0 ? result : null
}

function firstPositiveNumberAt(value: unknown, paths: string[]) {
  for (const path of paths) {
    const number = positiveNumberAt(value, path)
    if (number !== null) return { path, value: number }
  }
  return null
}

async function loadSatelliteElectricPropulsionCalibration(workspaceDir: string): Promise<SatelliteElectricPropulsionCalibration | null> {
  const satellitePath = path.join(path.resolve(workspaceDir), "satellite.json")
  const document = await fs.readFile(satellitePath, "utf8").then(source => JSON.parse(source) as unknown).catch(() => null)
  if (!document) return null
  const thrustPath = "satellite.bus.propulsion_subsystem.nominal_thrust_newtons"
  const ispPath = "satellite.bus.propulsion_subsystem.specific_impulse_seconds"
  const powerPath = "satellite.bus.propulsion_subsystem.electric_thruster.nominal_thruster_power_kw"
  const dutyCyclePath = "satellite.bus.propulsion_subsystem.nominal_duty_cycle"
  const nominalThrust = firstPositiveNumberAt(document, [thrustPath, "satellite.bus.propulsion_subsystem.main_engine_thrust_n"])
  const isp = firstPositiveNumberAt(document, [ispPath])
  // Older run snapshots stored only the maximum usable power. It is a valid
  // nominal operating point for the existing proxy satellites and lets their
  // immutable satellite.json snapshots calibrate GMAT too.
  const nominalPower = firstPositiveNumberAt(document, [powerPath, "satellite.bus.propulsion_subsystem.electric_thruster.maximum_usable_power_kw"])
  const dutyCycle = positiveNumberAt(document, dutyCyclePath) ?? 1
  if (!nominalThrust || !isp || !nominalPower || dutyCycle > 1) return null
  const nominalThrustNewtons = nominalThrust.value
  const ispSeconds = isp.value
  const nominalPowerKw = nominalPower.value
  return {
    // FixedEfficiency keeps SolarPowerSystem1 in the propulsion calculation.
    // F = 2 * efficiency * P / (Isp * g0); calibrate it at the satellite's
    // declared nominal thrust/power operating point.
    fixedEfficiency: nominalThrustNewtons * ispSeconds * 9.80665 / (2 * nominalPowerKw * 1000 * dutyCycle),
    dutyCycle,
    nominalPowerKw,
    nominalThrustNewtons,
    ispSeconds,
    source: { isp: isp.path, thrust: nominalThrust.path, power: nominalPower.path, dutyCycle: dutyCyclePath },
  }
}

function applySatelliteElectricPropulsionCalibration(script: string, calibration: SatelliteElectricPropulsionCalibration | null) {
  if (!calibration) return script
  const replacements: Array<[RegExp, string, string]> = [
    [/^ElectricThruster1\.ThrustModel = ConstantThrustAndIsp;$/mu, "ElectricThruster1.ThrustModel = ConstantThrustAndIsp;", "ElectricThruster1.ThrustModel"],
    [/^ElectricThruster1\.Isp = [^;]+;$/mu, `ElectricThruster1.Isp = ${calibration.ispSeconds};`, "ElectricThruster1.Isp"],
    [/^ElectricThruster1\.FixedEfficiency = [^;]+;$/mu, `ElectricThruster1.FixedEfficiency = ${calibration.fixedEfficiency};`, "ElectricThruster1.FixedEfficiency"],
    [/^ElectricThruster1\.DutyCycle = [^;]+;$/mu, `ElectricThruster1.DutyCycle = ${calibration.dutyCycle};`, "ElectricThruster1.DutyCycle"],
  ]
  return replacements.reduce((rendered, [pattern, replacement, label]) => {
    if (!pattern.test(rendered)) throw new Error(`electric-propulsion template does not expose ${label} for satellite calibration`)
    return rendered.replace(pattern, replacement)
  }, script)
}

function enableEphemerisOutput(script: string) {
  if (!script.includes("Create EphemerisFile EphemerisFile1;")) {
    throw new Error("electric-propulsion template does not expose EphemerisFile1")
  }
  const marker = "BeginMissionSequence;"
  if (!script.includes(marker)) throw new Error("electric-propulsion template does not expose its mission sequence")
  const legacyPropagation = script.includes("While 'Raise to target altitude' DefaultSC.Earth.Altitude < targetFinalAltitudeKm")
    && script.includes("Propagate 'Propagate one output step' DefaultProp(DefaultSC);")
  const continuousPropagation = script.includes("Propagate 'Spiral ' DefaultProp(DefaultSC) {DefaultSC.Earth.SMA = targetFinalAltitudeKm};")
  const stationKeepingPropagation = script.includes("While 'Continuous circular LEO electric orbit keeping' DefaultSC.ElapsedDays < MissionDays")
  if (!legacyPropagation && !continuousPropagation && !stationKeepingPropagation) throw new Error("electric-propulsion template does not expose its supported propagation sequence")
  const withSubscriber = script.includes("Toggle EphemerisFile1 On;") || script.includes("Toggle ElectricTransferReport EphemerisFile1 On;")
    ? script
    : script.replace(marker, `${marker}\n\n% Application instrumentation: activate downstream report and OEM subscribers.\n${stationKeepingPropagation ? "Toggle ElectricTransferReport EphemerisFile1 On;" : "Toggle EphemerisFile1 On;"}`)
  return withSubscriber
}

function runDirectoryName(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getFullYear() % 100)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}`
}
async function createRunOutputDir(rootDir: string, requestedName: string) {
  for (let index = 1; index <= 99; index += 1) {
    const outputDir = path.join(rootDir, `${requestedName}${index === 1 ? "" : `_${String(index).padStart(2, "0")}`}`)
    try { await fs.mkdir(outputDir, { recursive: false }); return outputDir } catch (error: unknown) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
  }
  throw new Error("too many GMAT generations in the same minute")
}
function numericSlotValue(values: ReturnType<typeof extractElectricPropulsionValues>, context: string) {
  const value = values.slots.find(slot => slot.context.startsWith(`${context} =`))?.value
  const parsed = value === undefined ? Number.NaN : Number(value.replace(/'/gu, "").trim())
  return Number.isFinite(parsed) ? parsed : undefined
}
const ASSUMED_INITIAL_ANGLE_CONTEXTS = ["DefaultSC.RAAN", "DefaultSC.AOP", "DefaultSC.TA"] as const

function applyAssumedInitialAngles(values: ReturnType<typeof extractElectricPropulsionValues>, changes: ElectricPropulsionValueChange[]) {
  const explicitlyChanged = new Set(changes.map(change => change.id))
  const defaults = values.slots
    .filter(slot => ASSUMED_INITIAL_ANGLE_CONTEXTS.some(context => slot.context.startsWith(`${context} =`)) && !explicitlyChanged.has(slot.id))
    .map(slot => ({ id: slot.id, value: "0" }))
  return applyElectricPropulsionValueChanges(values, [...changes, ...defaults])
}

export function summarizeElectricPropulsionExecution(execution?: ElectricPropulsionExecutionResult, minimumUsablePowerKw?: number): ElectricPropulsionRunResult {
  if (!execution) return { reportSampleCount: 0, status: "generated", timeSeriesSampleCount: 0 }
  const first = execution.samples[0]
  const final = execution.samples.at(-1)
  const finalRadiusKm = final
    ? final.semiMajorAxisKm * (1 - final.eccentricity ** 2) / (1 + final.eccentricity * Math.cos(final.trueAnomalyDeg * Math.PI / 180))
    : undefined
  const hasValidFinalRadius = typeof finalRadiusKm === "number" && Number.isFinite(finalRadiusKm) && finalRadiusKm > 0
  const fuelUsedBetweenReportsKg = first && final ? first.fuelMassKg - final.fuelMassKg : undefined
  // Do not spread a large report into Math.max: a target altitude that is not
  // reached can produce many samples, and spreading them overflows Node's call
  // stack while we are trying to report the real GMAT status.
  const maximumReportedThrustPowerKw = execution.samples.length
    ? execution.samples.reduce((maximum, sample) => Math.max(maximum, sample.powerAvailableKw), Number.NEGATIVE_INFINITY)
    : undefined
  const powerEligibleSampleCount = minimumUsablePowerKw === undefined ? undefined : execution.samples.filter(sample => sample.powerAvailableKw >= minimumUsablePowerKw).length
  const warnings: string[] = []
  if (minimumUsablePowerKw !== undefined && maximumReportedThrustPowerKw !== undefined && maximumReportedThrustPowerKw < minimumUsablePowerKw) {
    warnings.push(`No report sample reached the ${minimumUsablePowerKw.toFixed(3)} kW minimum usable power; electric thrust was unavailable throughout the reported propagation.`)
  } else if (minimumUsablePowerKw !== undefined && powerEligibleSampleCount !== undefined && powerEligibleSampleCount < execution.samples.length) {
    warnings.push(`${execution.samples.length - powerEligibleSampleCount} of ${execution.samples.length} report samples were below the ${minimumUsablePowerKw.toFixed(3)} kW minimum usable power; thrust was interrupted or unavailable at those samples.`)
  }
  if (fuelUsedBetweenReportsKg !== undefined && Math.abs(fuelUsedBetweenReportsKg) <= 1e-9) warnings.push("Fuel mass did not change between the first and final report samples; verify the power threshold and finite-burn execution before using this transfer result.")
  return {
    ...(execution.error ? { error: execution.error } : {}), executionDurationMs: execution.durationMs,
    ...(final ? { finalFuelMassKg: final.fuelMassKg, ...(hasValidFinalRadius ? { finalRadiusKm } : {}) } : {}),
    ...(fuelUsedBetweenReportsKg === undefined ? {} : { fuelUsedBetweenReportsKg }),
    ...(maximumReportedThrustPowerKw === undefined ? {} : { maximumReportedThrustPowerKw }),
    ...(minimumUsablePowerKw === undefined ? {} : { minimumUsablePowerKw }),
    ...(powerEligibleSampleCount === undefined ? {} : { powerEligibleSampleCount }),
    reportSampleCount: execution.samples.length, status: execution.status, timeSeriesSampleCount: execution.samples.length,
    ...(warnings.length ? { warnings } : {}),
  }
}

/** Renders and executes a validated finite-burn electric-propulsion mission. */
export async function generateElectricPropulsionMission({ changes, workspaceDir, execution, onProgress, artifactId = runDirectoryName(new Date()), request, templatePath = defaultElectricPropulsionTemplatePath() }: {
  changes: ElectricPropulsionValueChange[]
  workspaceDir: string
  execution?: { bin: string; timeoutMs: number }
  onProgress?: (progress: ElectricPropulsionProgress) => void
  artifactId?: string
  request: string
  templatePath?: string
}): Promise<GenerateElectricPropulsionMissionResult> {
  if (!workspaceDir.trim() || !/^[A-Za-z0-9_-]+$/u.test(artifactId)) throw new Error("invalid GMAT electric-propulsion output path")
  onProgress?.({ key: "load_template", percent: 5, status: "running" })
  const template = await fs.readFile(templatePath, "utf8")
  const templateSha256 = createHash("sha256").update(template).digest("hex")
  const sourceValues = extractElectricPropulsionValues(template)
  onProgress?.({ key: "load_template", percent: 20, status: "completed" })
  onProgress?.({ key: "llm_patch", percent: 25, status: "running" })
  const editedValues = applyAssumedInitialAngles(sourceValues, changes)
  onProgress?.({ key: "llm_patch", percent: 45, status: "completed" })
  onProgress?.({ key: "render_script", percent: 50, status: "running" })
  const runDir = isMissionRunWorkspace(workspaceDir)
    ? path.resolve(workspaceDir)
    : await (async () => {
      const outputRoot = path.join(path.resolve(workspaceDir), "gmat", "electric-propulsion-transfer")
      await fs.mkdir(outputRoot, { recursive: true })
      return createRunOutputDir(outputRoot, artifactId)
    })()
  const reportSlot = editedValues.slots.find(slot => slot.context.includes("ElectricTransferReport.Filename"))
  if (!reportSlot) throw new Error("electric-propulsion template does not expose ElectricTransferReport.Filename")
  const ephemerisSlot = editedValues.slots.find(slot => slot.context.includes("EphemerisFile1.Filename"))
  if (!ephemerisSlot) throw new Error("electric-propulsion template does not expose EphemerisFile1.Filename")
  const reportPath = toGmatNativePath(path.join(runDir, "ElectricTransferReport.txt")).replace(/\\/gu, "/")
  const ephemerisPath = path.join(runDir, "EphemerisFile1.oem")
  const ephemerisOutputPath = toGmatNativePath(ephemerisPath).replace(/\\/gu, "/")
  const renderedValues = applyElectricPropulsionValueChanges(editedValues, [
    { id: reportSlot.id, value: `'${reportPath}'` },
    { id: ephemerisSlot.id, value: `'${ephemerisOutputPath}'` },
  ])
  const scriptPath = path.join(runDir, "electric_propulsion_transfer.script")
  const valuesPath = path.join(runDir, "electric_propulsion_transfer.values.yaml")
  const calibrationPath = path.join(runDir, "electric_propulsion_calibration.json")
  const resultPath = path.join(runDir, "gmat_result.json")
  const timeSeriesPath = path.join(runDir, "electric_transfer_timeseries.json")
  const manifestPath = path.join(runDir, "run_manifest.json")
  const calibration = await loadSatelliteElectricPropulsionCalibration(workspaceDir)
  const renderedScript = applySatelliteElectricPropulsionCalibration(
    enableEphemerisOutput(renderElectricPropulsionValues(template, renderedValues)),
    calibration,
  )
  await Promise.all([
    fs.writeFile(scriptPath, renderedScript, "utf8"),
    fs.writeFile(valuesPath, stringify(renderedValues), "utf8"),
    ...(calibration ? [fs.writeFile(calibrationPath, `${JSON.stringify({ schemaVersion: 1, model: "fixed-efficiency", ...calibration }, null, 2)}\n`, "utf8")] : []),
  ])
  onProgress?.({ key: "render_script", percent: 60, status: "completed" })
  if (execution) await beginRunStage(runDir, "gmat", "GMAT simulation is running.")
  if (execution) onProgress?.({ key: "run_gmat", percent: 65, status: "running" })
  const executionResult = execution ? await runElectricPropulsionGmat({ ...execution, scriptPath }) : undefined
  if (execution) onProgress?.({ key: "run_gmat", percent: 90, status: "completed" })
  const minimumUsablePowerKw = numericSlotValue(renderedValues, "ElectricThruster1.MinimumUsablePower")
  const result = summarizeElectricPropulsionExecution(executionResult, minimumUsablePowerKw)
  const ephemerisWritten = execution
    ? await fs.stat(ephemerisPath).then(stat => stat.isFile() && stat.size > 0).catch(() => false)
    : false
  const runId = path.basename(runDir)
  const manifest = { schemaVersion: 1, runId, tool: "GMAT", templateId: "electric-propulsion-transfer", templateSha256, status: result.status, request, createdAt: new Date().toISOString(), completedAt: executionResult?.completedAt ?? null, changes, inputs: { script: path.basename(scriptPath), values: path.basename(valuesPath), calibration: calibration ? path.basename(calibrationPath) : null }, outputs: { result: path.basename(resultPath), report: executionResult ? path.basename(executionResult.reportPath) : null, ephemeris: ephemerisWritten ? path.basename(ephemerisPath) : null, log: executionResult ? path.basename(executionResult.logPath) : null } }
  onProgress?.({ key: "save_results", percent: 92, status: "running" })
  await Promise.all([
    fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8"),
    fs.writeFile(timeSeriesPath, `${JSON.stringify(executionResult?.samples ?? [], null, 2)}\n`, "utf8"),
    updateRunManifest(runDir, manifest),
  ])
  await invalidateDownstreamFromGmat(runDir)
  onProgress?.({ key: "save_results", percent: 100, status: "completed" })
  return { changes, ...(calibration ? { calibrationPath } : {}), ephemerisPath, latencyMs: 0, manifestPath, result, resultPath, runDir, runId, scriptPath, timeSeriesPath, valuesPath }
}
