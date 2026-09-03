import fs from "node:fs/promises"
import path from "node:path"
import { parseDocument, stringify } from "yaml"

import { initializeDraftDigitalThread, isMissionRunWorkspace } from "../digitalThread/digitalThreadStore.js"
import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { EARTH_EQUATORIAL_RADIUS_KM, cartesianToKeplerian, keplerianToCartesian, semiMajorAxisFromPeriapsisAltitude, type CartesianState, type KeplerianElements } from "./orbitCoordinates.js"
import { requestGmatModel } from "./modelRequest.js"
import type { ElectricPropulsionValueChange, ElectricPropulsionValues } from "./electricPropulsionValues.js"
import { writeDraftRunComparisonIndex } from "./draftRunComparison.js"
import { resolveMissionRun } from "../runs/runWorkspace.js"

type DraftValue = string | number | null
type DraftValues = Record<string, DraftValue>
type SafetySeverity = "error" | "warning"
type FieldDefinition = { context: string; label: string; max?: number; min?: number; path: string; required: boolean; unit?: string }

export type ElectricPropulsionSafetyCheck = { code: string; message: string; severity: SafetySeverity }
export type ElectricPropulsionSafetyReview = {
  assumptions: Array<{ label: string; value: string }>
  checks: ElectricPropulsionSafetyCheck[]
}
export type ElectricPropulsionDraftRun = {
  changes: ElectricPropulsionValueChange[]
  completedAt: string
  result: { error?: string; finalFuelMassKg?: number; finalRadiusKm?: number; reportSampleCount: number; status: "generated" | "completed" | "failed" | "timeout" }
  runId: string
  runPath: string
  /** Exact draft inputs used to make this immutable run comparable later. */
  missionValues?: DraftValues
}
export type ElectricPropulsionDraft = {
  assistantMessage?: string
  confirmed: boolean
  conversation: Array<{ assistant: string; user: string }>
  conversationStartedAt: string | null
  createdAt: string
  draftId: string
  digitalThreadRequiredPaths?: string[]
  missing: string[]
  runs: ElectricPropulsionDraftRun[]
  safety: ElectricPropulsionSafetyReview
  status: "blocked" | "collecting" | "ready" | "confirmed"
  templateId: "electric-propulsion-transfer"
  updatedAt: string
  values: DraftValues
}

const MINIMUM_SAFE_ALTITUDE_KM = 120
const THRUST_POLYNOMIAL_MIN_POWER_KW = 0.638
const THRUST_POLYNOMIAL_MAX_POWER_KW = 7.266
const DEFAULT_POWER_SYSTEM_BUS_LOAD_KW = 0.3
const DEFAULT_POWER_SYSTEM_MARGIN_PERCENT = 5
const DEFAULT_INITIAL_SOLAR_POWER_KW = 1.2
const DEFAULT_INITIAL_ANGLE_DEG = 0
const JULIAN_DATE_AT_UNIX_EPOCH = 2440587.5
const GMAT_MODIFIED_JULIAN_OFFSET = 2430000
const TAI_UTC_LEAP_SECONDS: ReadonlyArray<readonly [string, number]> = [
  ["1972-01-01T00:00:00Z", 10], ["1972-07-01T00:00:00Z", 11], ["1973-01-01T00:00:00Z", 12], ["1974-01-01T00:00:00Z", 13],
  ["1975-01-01T00:00:00Z", 14], ["1976-01-01T00:00:00Z", 15], ["1977-01-01T00:00:00Z", 16], ["1978-01-01T00:00:00Z", 17],
  ["1979-01-01T00:00:00Z", 18], ["1980-01-01T00:00:00Z", 19], ["1981-07-01T00:00:00Z", 20], ["1982-07-01T00:00:00Z", 21],
  ["1983-01-01T00:00:00Z", 22], ["1985-07-01T00:00:00Z", 23], ["1988-01-01T00:00:00Z", 24], ["1990-01-01T00:00:00Z", 25],
  ["1991-01-01T00:00:00Z", 26], ["1992-07-01T00:00:00Z", 27], ["1993-01-01T00:00:00Z", 28], ["1994-01-01T00:00:00Z", 29],
  ["1996-01-01T00:00:00Z", 30], ["1997-07-01T00:00:00Z", 31], ["1999-01-01T00:00:00Z", 32], ["2006-01-01T00:00:00Z", 33],
  ["2009-01-01T00:00:00Z", 34], ["2012-07-01T00:00:00Z", 35], ["2015-07-01T00:00:00Z", 36], ["2017-01-01T00:00:00Z", 37],
]

/** Contract for the fixed electric-propulsion template, terminated at its target altitude. */
export const ELECTRIC_PROPULSION_TRANSFER_CONTRACT = {
  id: "electric-propulsion-transfer",
  fixedAssumptions: {
    centralBody: "Earth",
    coordinateSystem: "EarthMJ2000Eq",
    gravity: "JGM2 degree/order 4",
    thrustFrame: "Local VNB, along velocity",
  },
  fields: [
    { context: "DefaultSC.Epoch", label: "Initial epoch", path: "initialOrbit.epoch", required: true },
    { context: "DefaultSC.SMA", label: "Initial semi-major axis", min: 0.001, path: "initialOrbit.smaKm", required: true, unit: "km" },
    { context: "DefaultSC.ECC", label: "Initial eccentricity", max: 0.999999, min: 0, path: "initialOrbit.eccentricity", required: true },
    { context: "DefaultSC.INC", label: "Initial inclination", max: 180, min: 0, path: "initialOrbit.inclinationDeg", required: true, unit: "deg" },
    { context: "DefaultSC.RAAN", label: "Initial right ascension of the ascending node", max: 360, min: 0, path: "initialOrbit.raanDeg", required: false, unit: "deg" },
    { context: "DefaultSC.AOP", label: "Initial argument of periapsis", max: 360, min: 0, path: "initialOrbit.argPeriapsisDeg", required: false, unit: "deg" },
    { context: "DefaultSC.TA", label: "Initial true anomaly", max: 360, min: 0, path: "initialOrbit.trueAnomalyDeg", required: false, unit: "deg" },
    { context: "DefaultSC.DryMass", label: "Dry mass", min: 0.001, path: "spacecraft.dryMassKg", required: false, unit: "kg" },
    { context: "ElectricTank1.FuelMass", label: "Initial electric propellant mass", min: 0.001, path: "spacecraft.initialFuelMassKg", required: false, unit: "kg" },
    { context: "targetFinalAltitudeKm", label: "Target final altitude", max: 50_000, min: MINIMUM_SAFE_ALTITUDE_KM, path: "transfer.finalAltitudeKm", required: true, unit: "km" },
    // The fixed thrust and mass-flow polynomials are accepted only over their
    // documented calibration range; chat edits cannot extrapolate them.
    { context: "ElectricThruster1.MaximumUsablePower", label: "Maximum usable thruster power", max: THRUST_POLYNOMIAL_MAX_POWER_KW, min: 0.001, path: "propulsion.maximumUsablePowerKw", required: false, unit: "kW" },
    { context: "ElectricThruster1.MinimumUsablePower", label: "Minimum usable thruster power", max: THRUST_POLYNOMIAL_MAX_POWER_KW, min: 0.001, path: "propulsion.minimumUsablePowerKw", required: false, unit: "kW" },
    { context: "SolarPowerSystem1.InitialMaxPower", label: "Initial solar-array maximum power", max: 50, min: 0.001, path: "power.initialMaxPowerKw", required: false, unit: "kW" },
    { context: "SolarPowerSystem1.BusCoeff1", label: "Spacecraft bus load", max: 50, min: 0, path: "power.busLoadKw", required: false, unit: "kW" },
    { context: "SolarPowerSystem1.Margin", label: "Power-system margin", max: 99, min: 0, path: "power.systemMarginPercent", required: false, unit: "%" },
  ] satisfies FieldDefinition[],
} as const

const fields = ELECTRIC_PROPULSION_TRANSFER_CONTRACT.fields as readonly FieldDefinition[]
const MISSION_FIELD_PATHS = new Set([
  "initialOrbit.epoch", "initialOrbit.smaKm", "initialOrbit.eccentricity", "initialOrbit.inclinationDeg",
  "initialOrbit.raanDeg", "initialOrbit.argPeriapsisDeg", "initialOrbit.trueAnomalyDeg", "transfer.finalAltitudeKm",
])
const GMAT_TAI_MOD_JULIAN_MIN = 10_000
const GMAT_TAI_MOD_JULIAN_MAX = 100_000
const CARTESIAN_STATE_PATHS = ["initialState.xKm", "initialState.yKm", "initialState.zKm", "initialState.vxKmPerSec", "initialState.vyKmPerSec", "initialState.vzKmPerSec"] as const
const KEPLERIAN_ORBIT_PATHS = ["initialOrbit.smaKm", "initialOrbit.eccentricity", "initialOrbit.inclinationDeg", "initialOrbit.raanDeg", "initialOrbit.argPeriapsisDeg", "initialOrbit.trueAnomalyDeg"] as const
const DERIVED_INPUT_PATHS = ["initialOrbit.altitudeKm", "initialOrbit.periapsisAltitudeKm", "initialOrbit.utcGregorian", "coordinateConversion.request", ...CARTESIAN_STATE_PATHS] as const

function newDraftId() { return `electric_draft_${crypto.randomUUID()}` }
function draftPath(workspaceDir: string, draftId: string) {
  if (!/^electric_draft_[a-f0-9-]+$/u.test(draftId)) throw new Error("invalid electric-propulsion GMAT draft id")
  return path.join(path.resolve(workspaceDir), "gmat", "electric-propulsion-transfer", "drafts", draftId, "draft.json")
}
function utcGregorianToTaiModJulian(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(value)) throw new Error("calendar epoch must use an unambiguous UTC ISO format")
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds) || milliseconds < Date.parse(TAI_UTC_LEAP_SECONDS[0][0])) throw new Error("calendar epoch is invalid or predates deterministic TAI conversion")
  const taiMinusUtcSeconds = TAI_UTC_LEAP_SECONDS.reduce((offset, [effectiveAt, candidate]) => milliseconds >= Date.parse(effectiveAt) ? candidate : offset, 0)
  return Number((milliseconds / 86_400_000 + JULIAN_DATE_AT_UNIX_EPOCH + taiMinusUtcSeconds / 86_400 - GMAT_MODIFIED_JULIAN_OFFSET).toFixed(12)).toString()
}
function taiModJulianToUtcGregorian(value: string) {
  const taiModJulian = Number(value)
  if (!Number.isFinite(taiModJulian)) throw new Error("initialOrbit.epoch must be a numeric TAIModJulian value")
  const taiMilliseconds = (taiModJulian + GMAT_MODIFIED_JULIAN_OFFSET - JULIAN_DATE_AT_UNIX_EPOCH) * 86_400_000
  let utcMilliseconds = taiMilliseconds - 37_000
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const taiMinusUtcSeconds = TAI_UTC_LEAP_SECONDS.reduce((offset, [effectiveAt, candidate]) => utcMilliseconds >= Date.parse(effectiveAt) ? candidate : offset, 0)
    utcMilliseconds = taiMilliseconds - taiMinusUtcSeconds * 1000
  }
  const date = new Date(utcMilliseconds)
  if (!Number.isFinite(date.getTime())) throw new Error("initialOrbit.epoch cannot be converted to UTC")
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()]
  const pad = (number: number, width = 2) => String(number).padStart(width, "0")
  return `''${pad(date.getUTCDate())} ${month} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}.${pad(date.getUTCMilliseconds(), 3)}''`
}
function validateValues(values: DraftValues, additionalRequiredPaths: string[] = []) {
  const missing: string[] = []
  for (const field of fields) {
    const value = values[field.path]
    if (field.required && (value === null || value === undefined || value === "")) { missing.push(field.path); continue }
    if (value === null || value === undefined || value === "") continue
    if (field.path === "initialOrbit.epoch") {
      if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value.trim())) throw new Error("initialOrbit.epoch must be a numeric TAIModJulian value")
      const epoch = Number(value)
      if (epoch < GMAT_TAI_MOD_JULIAN_MIN || epoch > GMAT_TAI_MOD_JULIAN_MAX) throw new Error(`initialOrbit.epoch must be between ${GMAT_TAI_MOD_JULIAN_MIN} and ${GMAT_TAI_MOD_JULIAN_MAX} TAIModJulian for this mission model`)
      continue
    }
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field.path} must be a finite number`)
    if (field.min !== undefined && value < field.min) throw new Error(`${field.path} must be at least ${field.min}`)
    if (field.max !== undefined && value > field.max) throw new Error(`${field.path} must be at most ${field.max}`)
  }
  for (const fieldPath of additionalRequiredPaths) {
    const value = values[fieldPath]
    if ((value === null || value === undefined || value === "") && !missing.includes(fieldPath)) missing.push(fieldPath)
  }
  return missing
}
function valueOrDefault(values: DraftValues, key: string, fallback: number) { return String(values[key] ?? fallback) }

function numberAt(values: DraftValues, path: string) {
  const value = values[path]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
function numberOrDefault(values: DraftValues, path: string, fallback: number) { return numberAt(values, path) ?? fallback }
function cartesianStateFromValues(values: DraftValues): CartesianState | null {
  const numbers = CARTESIAN_STATE_PATHS.map(path => numberAt(values, path))
  if (numbers.some(value => value === null)) return null
  const [xKm, yKm, zKm, vxKmPerSec, vyKmPerSec, vzKmPerSec] = numbers as number[]
  return { xKm, yKm, zKm, vxKmPerSec, vyKmPerSec, vzKmPerSec }
}
function keplerianElementsFromValues(values: DraftValues): KeplerianElements | null {
  const [semiMajorAxisKm, eccentricity, inclinationDeg] = KEPLERIAN_ORBIT_PATHS.slice(0, 3).map(path => numberAt(values, path))
  if (semiMajorAxisKm === null || eccentricity === null || inclinationDeg === null) return null
  const raanDeg = numberOrDefault(values, "initialOrbit.raanDeg", DEFAULT_INITIAL_ANGLE_DEG)
  const argPeriapsisDeg = numberOrDefault(values, "initialOrbit.argPeriapsisDeg", DEFAULT_INITIAL_ANGLE_DEG)
  const trueAnomalyDeg = numberOrDefault(values, "initialOrbit.trueAnomalyDeg", DEFAULT_INITIAL_ANGLE_DEG)
  return { semiMajorAxisKm, eccentricity, inclinationDeg, raanDeg, argPeriapsisDeg, trueAnomalyDeg }
}
function applyKeplerianElements(values: DraftValues, elements: KeplerianElements) {
  values["initialOrbit.smaKm"] = elements.semiMajorAxisKm
  values["initialOrbit.eccentricity"] = elements.eccentricity
  values["initialOrbit.inclinationDeg"] = elements.inclinationDeg
  values["initialOrbit.raanDeg"] = elements.raanDeg
  values["initialOrbit.argPeriapsisDeg"] = elements.argPeriapsisDeg
  values["initialOrbit.trueAnomalyDeg"] = elements.trueAnomalyDeg
}
function formatCoordinateConversion(title: string, entries: Array<[string, number, string]>) {
  return `${title}: ${entries.map(([label, value, unit]) => `${label}=${value.toFixed(6)}${unit ? ` ${unit}` : ""}`).join(", ")}.`
}
function deriveSemiMajorAxisFromPeriapsisAltitude(values: DraftValues) {
  const periapsisAltitudeKm = numberAt(values, "initialOrbit.periapsisAltitudeKm") ?? numberAt(values, "initialOrbit.altitudeKm")
  const eccentricity = numberAt(values, "initialOrbit.eccentricity")
  if (periapsisAltitudeKm === null || eccentricity === null) return false
  values["initialOrbit.smaKm"] = semiMajorAxisFromPeriapsisAltitude(periapsisAltitudeKm, eccentricity)
  return true
}
function coordinateConversionSummary(values: DraftValues, { cartesianWasUpdated, keplerianWasUpdated, request }: { cartesianWasUpdated: boolean; keplerianWasUpdated: boolean; request?: DraftValue }) {
  if (cartesianWasUpdated) {
    const cartesianState = cartesianStateFromValues(values)
    if (!cartesianState) return ""
    const elements = cartesianToKeplerian(cartesianState)
    applyKeplerianElements(values, elements)
    return formatCoordinateConversion("Cartesian state converted to Keplerian elements", [["SMA", elements.semiMajorAxisKm, "km"], ["ECC", elements.eccentricity, ""], ["INC", elements.inclinationDeg, "deg"], ["RAAN", elements.raanDeg, "deg"], ["AOP", elements.argPeriapsisDeg, "deg"], ["TA", elements.trueAnomalyDeg, "deg"]])
  }
  if (!keplerianWasUpdated && request !== "keplerian_to_cartesian") return ""
  const elements = keplerianElementsFromValues(values)
  if (!elements) return ""
  const state = keplerianToCartesian(elements)
  return formatCoordinateConversion("Keplerian elements converted to Cartesian state", [["X", state.xKm, "km"], ["Y", state.yKm, "km"], ["Z", state.zKm, "km"], ["VX", state.vxKmPerSec, "km/s"], ["VY", state.vyKmPerSec, "km/s"], ["VZ", state.vzKmPerSec, "km/s"]])
}
function buildSafetyReview(values: DraftValues): ElectricPropulsionSafetyReview {
  const checks: ElectricPropulsionSafetyCheck[] = []
  const semiMajorAxis = values["initialOrbit.smaKm"]
  const eccentricity = values["initialOrbit.eccentricity"]
  if (typeof semiMajorAxis === "number" && typeof eccentricity === "number") {
    const periapsisAltitude = semiMajorAxis * (1 - eccentricity) - EARTH_EQUATORIAL_RADIUS_KM
    if (periapsisAltitude < MINIMUM_SAFE_ALTITUDE_KM) checks.push({ code: "initial_periapsis", message: `Initial Keplerian elements give a periapsis altitude of ${periapsisAltitude.toFixed(1)} km; it must be at least ${MINIMUM_SAFE_ALTITUDE_KM} km.`, severity: "error" })
    const targetAltitude = values["transfer.finalAltitudeKm"]
    if (typeof targetAltitude === "number" && targetAltitude <= periapsisAltitude) checks.push({ code: "target_altitude_order", message: `Target final altitude (${targetAltitude} km) must be greater than the initial periapsis altitude (${periapsisAltitude.toFixed(1)} km).`, severity: "error" })
  }
  const dryMass = values["spacecraft.dryMassKg"]
  const fuelMass = values["spacecraft.initialFuelMassKg"]
  const maxPower = numberOrDefault(values, "propulsion.maximumUsablePowerKw", THRUST_POLYNOMIAL_MAX_POWER_KW)
  const minPower = numberOrDefault(values, "propulsion.minimumUsablePowerKw", THRUST_POLYNOMIAL_MIN_POWER_KW)
  const initialSolarPower = numberOrDefault(values, "power.initialMaxPowerKw", DEFAULT_INITIAL_SOLAR_POWER_KW)
  // The solar InitialEpoch is derived from the mission Epoch at render time, so
  // InitialMaxPower represents a new array at the start of every mission.
  // Eclipse, Earth-Sun distance, and penumbra can still reduce this estimate.
  const busLoadKw = numberOrDefault(values, "power.busLoadKw", DEFAULT_POWER_SYSTEM_BUS_LOAD_KW)
  const systemMarginPercent = numberOrDefault(values, "power.systemMarginPercent", DEFAULT_POWER_SYSTEM_MARGIN_PERCENT)
  const nominalThrustPower = Math.max(0, (initialSolarPower - busLoadKw) * (1 - systemMarginPercent / 100))
  if (typeof dryMass === "number" && dryMass <= 0) checks.push({ code: "dry_mass", message: "Dry mass must be strictly positive.", severity: "error" })
  if (typeof fuelMass === "number" && fuelMass <= 0) checks.push({ code: "propellant_mass", message: "Electric propellant mass must be strictly positive.", severity: "error" })
  if (minPower >= maxPower) checks.push({ code: "power_range", message: "Minimum usable thruster power must be strictly lower than maximum usable power.", severity: "error" })
  if (nominalThrustPower < minPower) checks.push({ code: "initial_power_below_minimum", message: `The optimistic initial thrust-power estimate is ${nominalThrustPower.toFixed(3)} kW, below the ${minPower.toFixed(3)} kW minimum usable power. GMAT would start with the electric thruster off. Increase solar-array power or lower the threshold.`, severity: "error" })
  else if (nominalThrustPower < minPower * 1.2) checks.push({ code: "small_power_margin", message: `The optimistic initial thrust-power estimate is only ${nominalThrustPower.toFixed(3)} kW for a ${minPower.toFixed(3)} kW minimum. Solar degradation, distance, or penumbra can turn the thruster off.`, severity: "warning" })
  if (nominalThrustPower < maxPower) checks.push({ code: "power_limited", message: `The nominal thrust-power estimate is ${nominalThrustPower.toFixed(3)} kW, below the configured ${maxPower.toFixed(3)} kW maximum. The thruster will not reach its maximum-power operating point under nominal initial conditions.`, severity: "warning" })
  checks.push({ code: "eclipse_interruptions", message: "The fixed SolarPowerSystem uses the Earth DualCone shadow model. Thrust power can fall to zero in eclipse, so the finite burn is not guaranteed to be continuous.", severity: "warning" })
  return {
    assumptions: [
      { label: "Central body", value: "Earth" }, { label: "Coordinate system", value: "EarthMJ2000Eq" },
      { label: "Initial-state representation", value: "Keplerian (SMA, ECC, INC, RAAN, AOP, TA)" },
      { label: "Initial RAAN", value: `${valueOrDefault(values, "initialOrbit.raanDeg", DEFAULT_INITIAL_ANGLE_DEG)} deg` },
      { label: "Initial argument of periapsis", value: `${valueOrDefault(values, "initialOrbit.argPeriapsisDeg", DEFAULT_INITIAL_ANGLE_DEG)} deg` },
      { label: "Initial true anomaly", value: `${valueOrDefault(values, "initialOrbit.trueAnomalyDeg", DEFAULT_INITIAL_ANGLE_DEG)} deg` },
      { label: "Gravity model", value: "JGM2, degree/order 4" }, { label: "Thrust direction", value: "VNB +V (prograde)" },
      { label: "Maximum usable power", value: `${valueOrDefault(values, "propulsion.maximumUsablePowerKw", 7.266)} kW` },
      { label: "Minimum usable power", value: `${valueOrDefault(values, "propulsion.minimumUsablePowerKw", 0.638)} kW` },
      { label: "Thrust model", value: "FixedEfficiency, calibrated from the selected satellite's nominal thrust, Isp, and nominal thruster power" },
      { label: "Initial solar-array maximum power", value: `${valueOrDefault(values, "power.initialMaxPowerKw", DEFAULT_INITIAL_SOLAR_POWER_KW)} kW` },
      { label: "Spacecraft bus load", value: `${valueOrDefault(values, "power.busLoadKw", DEFAULT_POWER_SYSTEM_BUS_LOAD_KW)} kW` },
      { label: "Power-system margin", value: `${valueOrDefault(values, "power.systemMarginPercent", DEFAULT_POWER_SYSTEM_MARGIN_PERCENT)} %` },
      { label: "Solar-array reference epoch", value: "Automatically synchronized to the mission epoch" },
      { label: "Optimistic initial thrust power", value: `${nominalThrustPower.toFixed(3)} kW (after the digital-thread bus load and power margin)` },
    ], checks,
  }
}
function refreshDraft(draft: Omit<ElectricPropulsionDraft, "missing" | "safety" | "status" | "updatedAt">): ElectricPropulsionDraft {
  const missing = validateValues(draft.values, draft.digitalThreadRequiredPaths)
  const safety = buildSafetyReview(draft.values)
  return { ...draft, missing, safety, status: safety.checks.some(check => check.severity === "error") ? "blocked" : draft.confirmed ? "confirmed" : missing.length ? "collecting" : "ready", updatedAt: new Date().toISOString() }
}
async function saveDraft(workspaceDir: string, draft: ElectricPropulsionDraft) {
  const output = draftPath(workspaceDir, draft.draftId)
  await fs.mkdir(path.dirname(output), { recursive: true })
  // This live draft YAML changes with every assistant turn. It is not the
  // immutable values file that is emitted later inside a completed GMAT run.
  const valuesPath = path.join(path.dirname(output), "electric_propulsion_transfer.values.yaml")
  const valuesSource = stringify({ draft_id: draft.draftId, template_id: draft.templateId, updated_at: draft.updatedAt, values: draft.values })
  await Promise.all([
    fs.writeFile(output, `${JSON.stringify(draft, null, 2)}\n`, "utf8"),
    fs.writeFile(valuesPath, valuesSource, "utf8"),
    ...(isMissionRunWorkspace(workspaceDir) ? [
      fs.writeFile(path.join(path.resolve(workspaceDir), "electric_propulsion_transfer.values.yaml"), valuesSource, "utf8"),
    ] : []),
  ])
  return draft
}

export async function createElectricPropulsionDraft(workspaceDir: string, initialValues: Record<string, DraftValue> = {}, digitalThreadRequiredPaths: string[] = []) {
  const now = new Date().toISOString()
  const values: Record<string, DraftValue> = {
    ...Object.fromEntries(fields.map(field => [field.path, initialValues[field.path] ?? null])),
    "initialOrbit.epoch": initialValues["initialOrbit.epoch"] ?? "31262.66709490726",
    "initialOrbit.raanDeg": initialValues["initialOrbit.raanDeg"] ?? 0,
    "initialOrbit.argPeriapsisDeg": initialValues["initialOrbit.argPeriapsisDeg"] ?? 0,
    "initialOrbit.trueAnomalyDeg": initialValues["initialOrbit.trueAnomalyDeg"] ?? 0,
  }
  const draft = await saveDraft(workspaceDir, refreshDraft({ confirmed: false, conversation: [], conversationStartedAt: null, createdAt: now, digitalThreadRequiredPaths, draftId: newDraftId(), runs: [], templateId: "electric-propulsion-transfer", values }))
  await initializeDraftDigitalThread(workspaceDir, "electric-propulsion-transfer", draft.draftId)
  return draft
}
export async function loadElectricPropulsionDraft(workspaceDir: string, draftId: string) {
  const parsed = JSON.parse(await fs.readFile(draftPath(workspaceDir, draftId), "utf8")) as ElectricPropulsionDraft
  if (parsed.templateId !== "electric-propulsion-transfer" || !parsed.values) throw new Error("unsupported electric-propulsion GMAT draft")
  const values = { ...parsed.values }
  // Drafts saved before the Keplerian template accepted Cartesian input can be
  // reopened safely: translate their complete state instead of asking again.
  if (!keplerianElementsFromValues(values) && cartesianStateFromValues(values)) {
    applyKeplerianElements(values, cartesianToKeplerian(cartesianStateFromValues(values)!))
  }
  return refreshDraft({ ...parsed, confirmed: parsed.confirmed === true, conversation: Array.isArray(parsed.conversation) ? parsed.conversation : [], conversationStartedAt: typeof parsed.conversationStartedAt === "string" ? parsed.conversationStartedAt : null, runs: Array.isArray(parsed.runs) ? parsed.runs : [], values })
}

/** Deterministic form update. No LLM is used for mission values entered in
 * the Mission Studio controls. */
export async function setElectricPropulsionDraftValue(workspaceDir: string, draft: ElectricPropulsionDraft, requestedPath: string, rawValue: string) {
  const raw = rawValue.trim()
  if (!raw) throw new Error("a value is required")
  const values = { ...draft.values }
  if (requestedPath === "initialOrbit.altitudeKm") {
    const altitudeKm = Number(raw)
    if (!Number.isFinite(altitudeKm) || altitudeKm < 0) throw new Error("initial altitude must be a non-negative number in km")
    values["initialOrbit.altitudeKm"] = altitudeKm
    values["initialOrbit.smaKm"] = Number((altitudeKm + EARTH_EQUATORIAL_RADIUS_KM).toFixed(9))
  } else if (requestedPath === "initialOrbit.epoch") {
    values[requestedPath] = /^\d{4}-\d{2}-\d{2}T/u.test(raw) ? utcGregorianToTaiModJulian(raw) : raw
  } else {
    const field = fields.find(candidate => candidate.path === requestedPath)
    if (!field) throw new Error("unsupported electric-propulsion mission field")
    const value = Number(raw)
    if (!Number.isFinite(value)) throw new Error(`${field.label} must be a finite number`)
    if (field.min !== undefined && value < field.min) throw new Error(`${field.label} must be at least ${field.min}`)
    if (field.max !== undefined && value > field.max) throw new Error(`${field.label} must be at most ${field.max}`)
    values[requestedPath] = value
  }
  return saveDraft(workspaceDir, refreshDraft({ ...draft, confirmed: false, values }))
}

/** Records a non-GMAT configuration exchange in this draft only. */
export async function appendElectricPropulsionDraftConversation(workspaceDir: string, draftId: string, turn: { assistant: string; user: string }) {
  const draft = await loadElectricPropulsionDraft(workspaceDir, draftId)
  return saveDraft(workspaceDir, refreshDraft({ ...draft, conversation: [...draft.conversation, turn] }))
}
function extractResponseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") return (payload as { output_text: string }).output_text.trim()
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const texts: string[] = []
  for (const item of Array.isArray(output) ? output : []) for (const part of Array.isArray(item && typeof item === "object" ? (item as { content?: unknown }).content : undefined) ? (item as { content: unknown[] }).content : []) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") texts.push((part as { text: string }).text.trim())
  return texts.filter(Boolean).join("\n")
}
function parseAssistantPatch(source: string) {
  const document = parseDocument(source)
  if (document.errors.length) throw new Error("LLM electric-propulsion draft response is not valid YAML")
  const parsed = document.toJS() as { message?: unknown; updates?: unknown }
  if (!parsed || !Array.isArray(parsed.updates)) throw new Error("LLM electric-propulsion draft response must contain updates")
  const updates: Array<{ path: string; value: DraftValue }> = []
  for (const item of parsed.updates) {
    const candidate = item && typeof item === "object" ? item as { path?: unknown; value?: unknown } : null
    if (!candidate || typeof candidate.path !== "string" || (!fields.some(field => field.path === candidate.path) && !DERIVED_INPUT_PATHS.includes(candidate.path as typeof DERIVED_INPUT_PATHS[number]))) throw new Error("LLM electric-propulsion draft update references an unknown field")
    if (typeof candidate.value !== "string" && typeof candidate.value !== "number") throw new Error("LLM electric-propulsion draft update has an invalid value")
    if (["initialOrbit.altitudeKm", "initialOrbit.periapsisAltitudeKm", ...CARTESIAN_STATE_PATHS].includes(candidate.path as typeof DERIVED_INPUT_PATHS[number]) && (typeof candidate.value !== "number" || !Number.isFinite(candidate.value))) throw new Error(`${candidate.path} must be a finite number`)
    if (["initialOrbit.altitudeKm", "initialOrbit.periapsisAltitudeKm"].includes(candidate.path as typeof DERIVED_INPUT_PATHS[number]) && Number(candidate.value) < 0) throw new Error(`${candidate.path} must be a non-negative number`)
    if (candidate.path === "initialOrbit.utcGregorian" && typeof candidate.value !== "string") throw new Error("calendar epoch must be a UTC ISO string")
    updates.push({ path: candidate.path, value: candidate.path === "initialOrbit.epoch" ? String(candidate.value) : candidate.value })
  }
  return { message: typeof parsed.message === "string" ? parsed.message.trim() : "", updates }
}
export async function discussElectricPropulsionDraft({ connection, draft, message, workspaceDir, fetchImpl = fetch }: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">; draft: ElectricPropulsionDraft; message: string; workspaceDir: string; fetchImpl?: typeof fetch
}) {
  const prompt = [
    "You are a conversational spacecraft mission-definition assistant for a fixed GMAT electric-propulsion transfer template.",
    "This template performs a finite prograde VNB burn until GMAT reaches the requested final altitude. Do not claim that it reaches a specific inclination, RAAN, or eccentricity unless the GMAT results demonstrate it.",
    "Collect only explicit engineering values, never silently invent them. On the first turn, briefly guide the engineer: confirm the selected electric-propulsion satellite, then collect epoch, initial altitude or SMA, eccentricity, inclination, and target final altitude one at a time. Ask one useful next question when a mandatory input is absent.",
    "Return YAML only: message: string; updates: [{ path: known path, value: string|number }]. Include updates: [] when no value is recorded. Never expose internal paths in the message.",
    "The GMAT epoch is TAIModJulian. For a calendar time with a timezone, emit initialOrbit.utcGregorian as a UTC ISO time; if timezone is absent, ask for it.",
    `Known fields: ${fields.map(field => `${field.path} (${field.label}${field.unit ? `, ${field.unit}` : ""}${field.required ? ", mandatory" : ", optional"})`).join("; ")}`,
    draft.digitalThreadRequiredPaths?.length ? `For this digital-thread-managed run, these fields are mandatory even if the legacy template marks them optional: ${draft.digitalThreadRequiredPaths.join(", ")}.` : "",
    "The selected satellite is the starting point. Dry mass, electric propellant, usable-power limits, solar-array power, bus load, and system margin may be changed for this discussion as run-specific what-if overrides. They update only this run's satellite.json, never the satellite library.",
    "Deterministic coordinate conversions are available. For an initial perigee altitude and eccentricity, emit initialOrbit.periapsisAltitudeKm and initialOrbit.eccentricity; the backend computes SMA = (Earth equatorial radius + periapsis altitude) / (1 - ECC). If a Cartesian initial state is supplied, emit initialState.xKm, initialState.yKm, initialState.zKm (km) and initialState.vxKmPerSec, initialState.vyKmPerSec, initialState.vzKmPerSec (km/s); the backend converts it to the six Keplerian inputs. To display the Cartesian equivalent of complete Keplerian inputs, emit coordinateConversion.request with value keplerian_to_cartesian. Never calculate these conversions yourself.",
    `RAAN, argument of periapsis, and true anomaly are optional assumptions of 0 degrees; do not ask for them unless the engineer explicitly supplies an orientation. GMAT uses the current satellite.json values to calibrate a FixedEfficiency thruster in the generated script. Minimum usable power must be strictly below Maximum usable power. The fixed DualCone Earth shadow model can interrupt thrust in eclipse.`,
    `Current values: ${JSON.stringify(draft.values)}`,
    draft.conversation.length ? `Recent conversation: ${JSON.stringify(draft.conversation.slice(-8))}` : "Recent conversation: none.",
    `Engineer message: ${message}`,
  ].join("\n\n")
  const response = await requestGmatModel(fetchImpl, `${connection.baseUrl.replace(/\/+$/u, "")}/responses`, { method: "POST", headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: connection.model, input: prompt, max_output_tokens: 900 }) })
  const body = await response.text()
  if (!response.ok) throw new Error(`LLM electric-propulsion draft request failed: HTTP ${response.status}`)
  let payload: unknown
  try { payload = JSON.parse(body) } catch { throw new Error("LLM electric-propulsion draft response is invalid JSON") }
  const responseText = extractResponseText(payload)
  if (!responseText) throw new Error("LLM electric-propulsion draft response contains no text")
  const patch = parseAssistantPatch(responseText)
  const values = { ...draft.values }
  for (const update of patch.updates) values[update.path === "initialOrbit.utcGregorian" ? "initialOrbit.epoch" : update.path] = update.path === "initialOrbit.utcGregorian" ? utcGregorianToTaiModJulian(String(update.value)) : update.value
  const altitudeWasUpdated = patch.updates.some(update => update.path === "initialOrbit.altitudeKm" || update.path === "initialOrbit.periapsisAltitudeKm")
  const keplerianWasUpdated = altitudeWasUpdated || patch.updates.some(update => KEPLERIAN_ORBIT_PATHS.includes(update.path as typeof KEPLERIAN_ORBIT_PATHS[number]))
  if (altitudeWasUpdated || patch.updates.some(update => update.path === "initialOrbit.eccentricity")) deriveSemiMajorAxisFromPeriapsisAltitude(values)
  const conversion = coordinateConversionSummary(values, {
    cartesianWasUpdated: patch.updates.some(update => CARTESIAN_STATE_PATHS.includes(update.path as typeof CARTESIAN_STATE_PATHS[number])),
    keplerianWasUpdated,
    request: patch.updates.find(update => update.path === "coordinateConversion.request")?.value,
  })
  const assistantMessage = [patch.message || "I have updated the electric-propulsion mission draft.", conversion].filter(Boolean).join("\n\n")
  return saveDraft(workspaceDir, refreshDraft({ ...draft, assistantMessage, confirmed: false, conversationStartedAt: draft.conversationStartedAt ?? new Date().toISOString(), conversation: [...draft.conversation, { assistant: assistantMessage, user: message }], values }))
}
export async function confirmElectricPropulsionDraft(workspaceDir: string, draftId: string, authoritativeValues?: Record<string, DraftValue>) {
  let draft = await loadElectricPropulsionDraft(workspaceDir, draftId)
  if (authoritativeValues) {
    const values = { ...draft.values }
    for (const field of fields) if (authoritativeValues[field.path] !== undefined) values[field.path] = authoritativeValues[field.path]
    draft = await saveDraft(workspaceDir, refreshDraft({ ...draft, confirmed: false, values }))
  }
  if (draft.missing.length) throw new Error(`GMAT draft is incomplete: ${draft.missing.join(", ")}`)
  const errors = draft.safety.checks.filter(check => check.severity === "error")
  if (errors.length) throw new Error(`GMAT physical sanity checks failed: ${errors.map(check => check.message).join(" ")}`)
  return saveDraft(workspaceDir, refreshDraft({ ...draft, confirmed: true }))
}
export async function recordElectricPropulsionDraftRun(workspaceDir: string, draftId: string, run: ElectricPropulsionDraftRun) {
  const draft = await loadElectricPropulsionDraft(workspaceDir, draftId)
  if (draft.status !== "confirmed") throw new Error("GMAT draft must be confirmed before recording a run")
  const resolvedRun = resolveMissionRun(workspaceDir, run.runPath)
  if (!resolvedRun || resolvedRun.runId !== run.runId) throw new Error("invalid GMAT electric-propulsion run reference")
  const runs = [...draft.runs.filter(existing => existing.runId !== run.runId), { ...run, missionValues: { ...draft.values } }]
  const saved = await saveDraft(workspaceDir, refreshDraft({ ...draft, runs }))
  await writeDraftRunComparisonIndex({ draftDirectory: path.dirname(draftPath(workspaceDir, draftId)), runs: saved.runs, templateId: saved.templateId })
  return saved
}
export function draftToElectricPropulsionChanges(draft: ElectricPropulsionDraft, values: ElectricPropulsionValues): ElectricPropulsionValueChange[] {
  if (draft.status !== "confirmed" || draft.safety.checks.some(check => check.severity === "error")) throw new Error("GMAT electric-propulsion draft is not ready for execution")
  const changes = fields.flatMap(field => {
    const value = draft.values[field.path]
    if (value === null) return field.required ? (() => { throw new Error(`missing required field ${field.path}`) })() : []
    const slot = values.slots.find(candidate => candidate.context.startsWith(`${field.context} =`))
    if (!slot) throw new Error(`template does not expose draft field ${field.path}`)
    return [{ id: slot.id, value: typeof value === "number" ? String(value) : `'${value.replace(/'/gu, "")}'` }]
  })
  const solarEpochSlot = values.slots.find(slot => slot.context.startsWith("SolarPowerSystem1.InitialEpoch ="))
  const missionEpoch = draft.values["initialOrbit.epoch"]
  if (!solarEpochSlot || typeof missionEpoch !== "string") throw new Error("template does not expose SolarPowerSystem1.InitialEpoch")
  return [...changes, { id: solarEpochSlot.id, value: taiModJulianToUtcGregorian(missionEpoch) }]
}
