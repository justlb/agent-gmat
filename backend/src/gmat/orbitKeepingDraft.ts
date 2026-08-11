import fs from "node:fs/promises"
import path from "node:path"
import { parseDocument } from "yaml"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { EARTH_EQUATORIAL_RADIUS_KM, cartesianToKeplerian, keplerianToCartesian, semiMajorAxisFromPeriapsisAltitude, type CartesianState, type KeplerianElements } from "./orbitCoordinates.js"
import { requestGmatModel } from "./modelRequest.js"
import type { OrbitKeepingValueChange, OrbitKeepingValues } from "./orbitKeepingValues.js"

type DraftValue = string | number | null
type DraftValues = Record<string, DraftValue>
type DraftConversationTurn = { assistant: string; user: string }
type SafetySeverity = "error" | "warning"

export type OrbitKeepingSafetyCheck = {
  code: string
  message: string
  severity: SafetySeverity
}

export type OrbitKeepingAssumption = {
  label: string
  value: string
}

export type OrbitKeepingSafetyReview = {
  assumptions: OrbitKeepingAssumption[]
  checks: OrbitKeepingSafetyCheck[]
}

const MINIMUM_SAFE_PERIGEE_ALTITUDE_KM = 120
const JULIAN_DATE_AT_UNIX_EPOCH = 2440587.5
const GMAT_MODIFIED_JULIAN_OFFSET = 2430000
const TAI_UTC_LEAP_SECONDS: ReadonlyArray<readonly [string, number]> = [
  ["1972-01-01T00:00:00Z", 10], ["1972-07-01T00:00:00Z", 11], ["1973-01-01T00:00:00Z", 12], ["1974-01-01T00:00:00Z", 13],
  ["1975-01-01T00:00:00Z", 14], ["1976-01-01T00:00:00Z", 15], ["1977-01-01T00:00:00Z", 16], ["1978-01-01T00:00:00Z", 17],
  ["1979-01-01T00:00:00Z", 18], ["1980-01-01T00:00:00Z", 19], ["1981-07-01T00:00:00Z", 20], ["1982-07-01T00:00:00Z", 21],
  ["1983-07-01T00:00:00Z", 22], ["1985-07-01T00:00:00Z", 23], ["1988-01-01T00:00:00Z", 24], ["1990-01-01T00:00:00Z", 25],
  ["1991-01-01T00:00:00Z", 26], ["1992-07-01T00:00:00Z", 27], ["1993-07-01T00:00:00Z", 28], ["1994-07-01T00:00:00Z", 29],
  ["1996-01-01T00:00:00Z", 30], ["1997-07-01T00:00:00Z", 31], ["1999-01-01T00:00:00Z", 32], ["2006-01-01T00:00:00Z", 33],
  ["2009-01-01T00:00:00Z", 34], ["2012-07-01T00:00:00Z", 35], ["2015-07-01T00:00:00Z", 36], ["2017-01-01T00:00:00Z", 37],
]

export type OrbitKeepingDraft = {
  assistantMessage?: string
  conversation: DraftConversationTurn[]
  confirmed: boolean
  conversationStartedAt: string | null
  createdAt: string
  draftId: string
  digitalThreadRequiredPaths?: string[]
  missing: string[]
  runs: OrbitKeepingDraftRun[]
  safety: OrbitKeepingSafetyReview
  status: "blocked" | "collecting" | "ready" | "confirmed"
  templateId: "orbit-keeping-earth-keplerian"
  targetSmaFollowsInitial: boolean
  updatedAt: string
  values: DraftValues
}

/** Immutable result references belonging to one iterative mission discussion. */
export type OrbitKeepingDraftRun = {
  changes: Array<{ id: string; value: string }>
  completedAt: string
  result: {
    error?: string
    finalAltitudeKm?: number
    finalFuelMassKg?: number
    maximumReportedAltitudeKm?: number
    minimumReportedAltitudeKm?: number
    status: "generated" | "completed" | "failed" | "timeout"
  }
  runId: string
  runPath: string
}

type FieldDefinition = {
  context: string
  label: string
  max?: number
  min?: number
  path: string
  required: boolean
  unit?: string
}

/** Contract for the current immutable Earth/Keplerian station-keeping template. */
export const ORBIT_KEEPING_EARTH_KEPLERIAN_CONTRACT = {
  id: "orbit-keeping-earth-keplerian",
  fixedAssumptions: {
    atmosphere: "MSISE90",
    centralBody: "Earth",
    coordinateSystem: "EarthMJ2000Eq",
    gravity: "JGM2 degree/order 4",
    stateRepresentation: "Keplerian",
  },
  fields: [
    { context: "DefaultSC.Epoch", label: "Epoch", path: "initialOrbit.epoch", required: true },
    { context: "DefaultSC.SMA", label: "Semi-major axis", min: 6378.2, path: "initialOrbit.smaKm", required: true, unit: "km" },
    { context: "DefaultSC.ECC", label: "Eccentricity", max: 0.999999, min: 0, path: "initialOrbit.eccentricity", required: true },
    { context: "DefaultSC.INC", label: "Inclination", max: 180, min: 0, path: "initialOrbit.inclinationDeg", required: true, unit: "deg" },
    { context: "DefaultSC.RAAN", label: "RAAN", max: 360, min: 0, path: "initialOrbit.raanDeg", required: false, unit: "deg" },
    { context: "DefaultSC.AOP", label: "Argument of periapsis", max: 360, min: 0, path: "initialOrbit.argPeriapsisDeg", required: false, unit: "deg" },
    { context: "DefaultSC.TA", label: "True anomaly", max: 360, min: 0, path: "initialOrbit.trueAnomalyDeg", required: false, unit: "deg" },
    { context: "DefaultSC.DryMass", label: "Dry mass", min: 0.001, path: "spacecraft.dryMassKg", required: false, unit: "kg" },
    { context: "ChemicalTank1.FuelMass", label: "Initial fuel mass", max: 100, min: 0, path: "spacecraft.initialFuelMassKg", required: true, unit: "kg" },
    { context: "DefaultSC.DragArea", label: "Drag area", min: 0.0001, path: "spacecraft.dragAreaM2", required: false, unit: "m2" },
    { context: "DefaultSC.Cd", label: "Drag coefficient", min: 0.0001, path: "spacecraft.dragCoefficient", required: false },
    { context: "TOI.Isp", label: "Specific impulse", min: 0.1, path: "propulsion.ispSeconds", required: false, unit: "s" },
    { context: "minAltitude", label: "Minimum reboost altitude", min: MINIMUM_SAFE_PERIGEE_ALTITUDE_KM, path: "stationKeeping.minimumAltitudeKm", required: true, unit: "km" },
    { context: "targetSMA", label: "Target semi-major axis", min: 6378.2, path: "stationKeeping.targetSmaKm", required: false, unit: "km" },
    { context: "fuelReserve", label: "Fuel reserve", min: 0, path: "stationKeeping.fuelReserveKg", required: false, unit: "kg" },
    { context: "finalAltitude", label: "Final altitude", min: 150, path: "endOfLife.finalAltitudeKm", required: false, unit: "km" },
  ] satisfies FieldDefinition[],
} as const

const fields = ORBIT_KEEPING_EARTH_KEPLERIAN_CONTRACT.fields as readonly FieldDefinition[]
const SATELLITE_OWNED_FIELDS = new Set([
  "spacecraft.dryMassKg", "spacecraft.dragAreaM2", "spacecraft.dragCoefficient", "propulsion.ispSeconds",
])
// These values describe one mission. They must always be collected for a new
// run instead of inheriting a previous orbit or a template example.
const MISSION_FIELD_PATHS = new Set([
  "initialOrbit.epoch", "initialOrbit.smaKm", "initialOrbit.eccentricity", "initialOrbit.inclinationDeg",
  "initialOrbit.raanDeg", "initialOrbit.argPeriapsisDeg", "initialOrbit.trueAnomalyDeg",
  "stationKeeping.minimumAltitudeKm", "stationKeeping.targetSmaKm", "stationKeeping.fuelReserveKg", "endOfLife.finalAltitudeKm", "spacecraft.initialFuelMassKg",
])
// These mission policies are explicit, reviewable defaults rather than data
// the assistant must collect before every GMAT run.
const ASSUMED_MISSION_FIELD_PATHS = new Set(["stationKeeping.fuelReserveKg", "endOfLife.finalAltitudeKm"])
/** Values embedded in the immutable reference script. A new draft starts here. */
const TEMPLATE_DEFAULT_VALUES: DraftValues = {
  "endOfLife.finalAltitudeKm": 150,
  "initialOrbit.argPeriapsisDeg": 0,
  "initialOrbit.eccentricity": 0,
  "initialOrbit.epoch": "31258.66709490726",
  "initialOrbit.inclinationDeg": 15.00000000000002,
  "initialOrbit.raanDeg": 0,
  "initialOrbit.smaKm": 6631.1363,
  "initialOrbit.trueAnomalyDeg": 0,
  "propulsion.ispSeconds": 300,
  "spacecraft.dragAreaM2": 15,
  "spacecraft.dragCoefficient": 2.5,
  "spacecraft.dryMassKg": 300,
  "spacecraft.initialFuelMassKg": 10,
  "stationKeeping.fuelReserveKg": 1,
  "stationKeeping.minimumAltitudeKm": 250,
  "stationKeeping.targetSmaKm": 6631.1363,
}
const CARTESIAN_STATE_PATHS = ["initialState.xKm", "initialState.yKm", "initialState.zKm", "initialState.vxKmPerSec", "initialState.vyKmPerSec", "initialState.vzKmPerSec"] as const
const KEPLERIAN_ORBIT_PATHS = ["initialOrbit.smaKm", "initialOrbit.eccentricity", "initialOrbit.inclinationDeg", "initialOrbit.raanDeg", "initialOrbit.argPeriapsisDeg", "initialOrbit.trueAnomalyDeg"] as const
const DERIVED_INPUT_PATHS = ["initialOrbit.altitudeKm", "initialOrbit.periapsisAltitudeKm", "initialOrbit.utcGregorian", "coordinateConversion.request", ...CARTESIAN_STATE_PATHS] as const

function newDraftId() {
  return `draft_${crypto.randomUUID()}`
}

function draftPath(workspaceDir: string, draftId: string) {
  if (!/^draft_[a-f0-9-]+$/u.test(draftId)) throw new Error("invalid GMAT draft id")
  return path.join(path.resolve(workspaceDir), "gmat", "drafts", draftId, "draft.json")
}

function utcGregorianToTaiModJulian(utcGregorian: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(utcGregorian)) {
    throw new Error("calendar epoch must use an unambiguous UTC ISO format, for example 2026-07-30T12:00:00Z")
  }
  const milliseconds = Date.parse(utcGregorian)
  if (!Number.isFinite(milliseconds)) throw new Error("calendar epoch is invalid")
  if (milliseconds < Date.parse(TAI_UTC_LEAP_SECONDS[0][0])) throw new Error("calendar epoch before 1972 is not supported by the deterministic TAI conversion")
  const taiMinusUtcSeconds = TAI_UTC_LEAP_SECONDS.reduce((offset, [effectiveAt, candidateOffset]) => (
    milliseconds >= Date.parse(effectiveAt) ? candidateOffset : offset
  ), 0)
  const taiModJulian = milliseconds / 86_400_000 + JULIAN_DATE_AT_UNIX_EPOCH + taiMinusUtcSeconds / 86_400 - GMAT_MODIFIED_JULIAN_OFFSET
  return Number(taiModJulian.toFixed(12)).toString()
}

function validateValues(values: DraftValues, additionalRequiredPaths: string[] = []) {
  const missing: string[] = []
  for (const field of fields) {
    const value = values[field.path]
    if (field.required && (value === null || value === undefined || value === "")) {
      missing.push(field.path)
      continue
    }
    if (value === null || value === undefined || value === "") continue
    if (field.path === "initialOrbit.epoch") {
      if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value.trim())) {
        throw new Error("initialOrbit.epoch must be a numeric TAIModJulian value, for example 21545 or 31251.50043")
      }
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

function valueOrDefault(values: DraftValues, path: string, fallback: string | number) {
  const value = values[path]
  return value === null || value === undefined ? String(fallback) : String(value)
}

function numberAt(values: DraftValues, path: string) {
  const value = values[path]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}
function cartesianStateFromValues(values: DraftValues): CartesianState | null {
  const numbers = CARTESIAN_STATE_PATHS.map(path => numberAt(values, path))
  if (numbers.some(value => value === null)) return null
  const [xKm, yKm, zKm, vxKmPerSec, vyKmPerSec, vzKmPerSec] = numbers as number[]
  return { xKm, yKm, zKm, vxKmPerSec, vyKmPerSec, vzKmPerSec }
}
function keplerianElementsFromValues(values: DraftValues): KeplerianElements | null {
  const numbers = KEPLERIAN_ORBIT_PATHS.map(path => numberAt(values, path))
  if (numbers.some(value => value === null)) return null
  const [semiMajorAxisKm, eccentricity, inclinationDeg, raanDeg, argPeriapsisDeg, trueAnomalyDeg] = numbers as number[]
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

function buildSafetyReview(values: DraftValues, targetSmaFollowsInitial: boolean): OrbitKeepingSafetyReview {
  const checks: OrbitKeepingSafetyCheck[] = []
  const initialSma = values["initialOrbit.smaKm"]
  const targetSma = values["stationKeeping.targetSmaKm"]
  const eccentricity = values["initialOrbit.eccentricity"]
  const minimumAltitude = values["stationKeeping.minimumAltitudeKm"]
  const finalAltitude = values["endOfLife.finalAltitudeKm"]
  const dryMass = values["spacecraft.dryMassKg"]
  const dragArea = values["spacecraft.dragAreaM2"]
  const dragCoefficient = values["spacecraft.dragCoefficient"]
  const specificImpulse = values["propulsion.ispSeconds"]
  const initialFuelMass = values["spacecraft.initialFuelMassKg"]
  const fuelReserve = values["stationKeeping.fuelReserveKg"]

  if (typeof eccentricity === "number" && (eccentricity < 0 || eccentricity >= 1)) {
    checks.push({ code: "eccentricity_bounds", message: "Eccentricity must be within [0, 1) for a bound Earth orbit.", severity: "error" })
  }
  if (typeof dryMass === "number" && dryMass <= 0) {
    checks.push({ code: "dry_mass", message: "Dry mass must be strictly positive.", severity: "error" })
  }
  if (typeof dragArea === "number" && dragArea <= 0) {
    checks.push({ code: "drag_area", message: "Drag area must be strictly positive.", severity: "error" })
  }
  if (typeof dragCoefficient === "number" && dragCoefficient <= 0) {
    checks.push({ code: "drag_coefficient", message: "Drag coefficient must be strictly positive.", severity: "error" })
  }
  if (typeof specificImpulse === "number" && specificImpulse <= 0) {
    checks.push({ code: "specific_impulse", message: "Specific impulse must be strictly positive.", severity: "error" })
  }
  if (typeof initialSma === "number" && typeof eccentricity === "number") {
    const perigeeAltitude = initialSma * (1 - eccentricity) - EARTH_EQUATORIAL_RADIUS_KM
    if (perigeeAltitude < MINIMUM_SAFE_PERIGEE_ALTITUDE_KM) {
      checks.push({ code: "initial_perigee", message: `Initial perigee altitude is ${perigeeAltitude.toFixed(1)} km; it must be at least ${MINIMUM_SAFE_PERIGEE_ALTITUDE_KM} km.`, severity: "error" })
    }
    if (typeof minimumAltitude === "number" && minimumAltitude > perigeeAltitude) {
      checks.push({ code: "reboost_above_initial_orbit", message: `Minimum reboost altitude (${minimumAltitude} km) cannot exceed the initial perigee altitude (${perigeeAltitude.toFixed(1)} km).`, severity: "error" })
    }
  }
  if (typeof targetSma === "number" && typeof eccentricity === "number") {
    const perigeeAltitude = targetSma * (1 - eccentricity) - EARTH_EQUATORIAL_RADIUS_KM
    if (perigeeAltitude < MINIMUM_SAFE_PERIGEE_ALTITUDE_KM) {
      checks.push({ code: "target_perigee", message: `Target-orbit perigee altitude is ${perigeeAltitude.toFixed(1)} km; it must be at least ${MINIMUM_SAFE_PERIGEE_ALTITUDE_KM} km.`, severity: "error" })
    }
  }
  if (typeof minimumAltitude === "number" && minimumAltitude < MINIMUM_SAFE_PERIGEE_ALTITUDE_KM) {
    checks.push({ code: "reboost_altitude", message: `Minimum reboost altitude is ${minimumAltitude} km; it must be at least ${MINIMUM_SAFE_PERIGEE_ALTITUDE_KM} km.`, severity: "error" })
  }
  if (typeof initialFuelMass === "number" && initialFuelMass > 0 && typeof fuelReserve === "number" && fuelReserve >= initialFuelMass) {
    checks.push({ code: "fuel_reserve", message: "Fuel reserve must be lower than the initial fuel mass so that a reboost can begin.", severity: "error" })
  }
  if (typeof finalAltitude === "number" && finalAltitude < 150) {
    checks.push({ code: "final_altitude", message: `Final altitude is ${finalAltitude} km; it must be at least 150 km.`, severity: "error" })
  }

  const assumptions: OrbitKeepingAssumption[] = [
    { label: "Central body", value: "Earth" },
    { label: "Coordinate system", value: "EarthMJ2000Eq" },
    { label: "Gravity model", value: "JGM2, degree/order 4" },
    { label: "Atmosphere model", value: "MSISE90" },
    { label: "RAAN", value: valueOrDefault(values, "initialOrbit.raanDeg", 0) + " deg" },
    { label: "Argument of periapsis", value: valueOrDefault(values, "initialOrbit.argPeriapsisDeg", 0) + " deg" },
    { label: "True anomaly", value: valueOrDefault(values, "initialOrbit.trueAnomalyDeg", 0) + " deg" },
    { label: "Drag area", value: valueOrDefault(values, "spacecraft.dragAreaM2", 15) + " m²" },
    { label: "Drag coefficient", value: valueOrDefault(values, "spacecraft.dragCoefficient", 2.5) },
    { label: "Specific impulse", value: valueOrDefault(values, "propulsion.ispSeconds", 300) + " s" },
    { label: "Fuel reserve", value: valueOrDefault(values, "stationKeeping.fuelReserveKg", 1) + " kg" },
    { label: "Final altitude", value: valueOrDefault(values, "endOfLife.finalAltitudeKm", 150) + " km" },
    { label: "Target semi-major axis", value: targetSmaFollowsInitial ? "Not provided" : valueOrDefault(values, "stationKeeping.targetSmaKm", 6578.1363) + " km" },
  ]
  return { assumptions, checks }
}

function numberFromSlot(values: OrbitKeepingValues, context: string) {
  const slot = values.slots.find(candidate => candidate.context.includes(context))
  if (!slot) return null
  const value = Number(slot.value.trim().replace(/^'|'$/gu, ""))
  return Number.isFinite(value) ? value : null
}

/** Enforces the same physical gates for direct generation routes as for mission drafts. */
export function assertOrbitKeepingSimulationSafety(values: OrbitKeepingValues) {
  const epochSlot = values.slots.find(candidate => candidate.context.includes("DefaultSC.Epoch"))
  if (!epochSlot || !/^'?\d+(?:\.\d+)?'?$/u.test(epochSlot.value.trim())) {
    throw new Error("GMAT epoch must be a numeric TAIModJulian value")
  }
  const review = buildSafetyReview({
    "endOfLife.finalAltitudeKm": numberFromSlot(values, "finalAltitude"),
    "initialOrbit.eccentricity": numberFromSlot(values, "DefaultSC.ECC"),
    "initialOrbit.smaKm": numberFromSlot(values, "DefaultSC.SMA"),
    "propulsion.ispSeconds": numberFromSlot(values, "TOI.Isp"),
    "spacecraft.dragAreaM2": numberFromSlot(values, "DefaultSC.DragArea"),
    "spacecraft.dragCoefficient": numberFromSlot(values, "DefaultSC.Cd"),
    "spacecraft.dryMassKg": numberFromSlot(values, "DefaultSC.DryMass"),
    "spacecraft.initialFuelMassKg": numberFromSlot(values, "ChemicalTank1.FuelMass"),
    "stationKeeping.fuelReserveKg": numberFromSlot(values, "fuelReserve"),
    "stationKeeping.minimumAltitudeKm": numberFromSlot(values, "minAltitude"),
    "stationKeeping.targetSmaKm": numberFromSlot(values, "targetSMA"),
  }, false)
  const errors = review.checks.filter(check => check.severity === "error")
  if (errors.length) throw new Error(`GMAT physical sanity checks failed: ${errors.map(check => check.message).join(" ")}`)
  return review
}

function refreshDraft(draft: Omit<OrbitKeepingDraft, "missing" | "safety" | "status" | "updatedAt">): OrbitKeepingDraft {
  const missing = validateValues(draft.values, draft.digitalThreadRequiredPaths)
  const safety = buildSafetyReview(draft.values, draft.targetSmaFollowsInitial)
  const hasSafetyErrors = safety.checks.some(check => check.severity === "error")
  return {
    ...draft,
    missing,
    safety,
    status: hasSafetyErrors ? "blocked" : draft.confirmed ? "confirmed" : missing.length === 0 ? "ready" : "collecting",
    updatedAt: new Date().toISOString(),
  }
}

async function saveDraft(workspaceDir: string, draft: OrbitKeepingDraft) {
  const output = draftPath(workspaceDir, draft.draftId)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(draft, null, 2)}\n`, "utf8")
  return draft
}

export async function createOrbitKeepingDraft(workspaceDir: string, initialValues: Record<string, DraftValue> = {}, digitalThreadRequiredPaths: string[] = []) {
  const values = Object.fromEntries(fields.map(field => [
    field.path,
    MISSION_FIELD_PATHS.has(field.path) && !ASSUMED_MISSION_FIELD_PATHS.has(field.path)
      ? null
      : initialValues[field.path] ?? TEMPLATE_DEFAULT_VALUES[field.path] ?? null,
  ])) as DraftValues
  const now = new Date().toISOString()
  const draft = refreshDraft({ confirmed: false, conversation: [], conversationStartedAt: null, createdAt: now, digitalThreadRequiredPaths, draftId: newDraftId(), runs: [], targetSmaFollowsInitial: true, templateId: ORBIT_KEEPING_EARTH_KEPLERIAN_CONTRACT.id, values })
  return saveDraft(workspaceDir, draft)
}

export async function loadOrbitKeepingDraft(workspaceDir: string, draftId: string) {
  const source = await fs.readFile(draftPath(workspaceDir, draftId), "utf8")
  const parsed = JSON.parse(source) as OrbitKeepingDraft
  if (parsed.templateId !== ORBIT_KEEPING_EARTH_KEPLERIAN_CONTRACT.id || !parsed.values) throw new Error("unsupported GMAT draft")
  const targetSmaFollowsInitial = parsed.targetSmaFollowsInitial !== false
  const values = { ...parsed.values }
  // Migrate drafts created before target-SMA tracking was introduced.
  if (targetSmaFollowsInitial && values["stationKeeping.targetSmaKm"] === null && typeof values["initialOrbit.smaKm"] === "number") {
    values["stationKeeping.targetSmaKm"] = values["initialOrbit.smaKm"]
  }
  return refreshDraft({ ...parsed, confirmed: parsed.confirmed === true, conversation: Array.isArray(parsed.conversation) ? parsed.conversation : [], conversationStartedAt: typeof parsed.conversationStartedAt === "string" ? parsed.conversationStartedAt : null, createdAt: parsed.createdAt, draftId: parsed.draftId, runs: Array.isArray(parsed.runs) ? parsed.runs : [], targetSmaFollowsInitial, templateId: parsed.templateId, values })
}

function parseAssistantPatch(source: string, lockedFields: ReadonlySet<string> = new Set()) {
  const document = parseDocument(source)
  if (document.errors.length) throw new Error("LLM draft response is not valid YAML")
  const parsed = document.toJS() as { message?: unknown; updates?: unknown }
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.updates)) throw new Error("LLM draft response must contain updates")
  const updates: Array<{ path: string; value: DraftValue }> = []
  for (const item of parsed.updates) {
    if (!item || typeof item !== "object") throw new Error("LLM draft update is invalid")
    const candidate = item as { path?: unknown; value?: unknown }
    if (typeof candidate.path !== "string" || (!DERIVED_INPUT_PATHS.includes(candidate.path as typeof DERIVED_INPUT_PATHS[number]) && !fields.some(field => field.path === candidate.path))) throw new Error("LLM draft update references an unknown field")
    if (lockedFields.has(candidate.path)) throw new Error(`${candidate.path} belongs to the selected satellite and must be changed in Satellite Library, not in a mission discussion`)
    if (typeof candidate.value !== "string" && typeof candidate.value !== "number") throw new Error("LLM draft update has an invalid value")
    if (["initialOrbit.altitudeKm", "initialOrbit.periapsisAltitudeKm", ...CARTESIAN_STATE_PATHS].includes(candidate.path as typeof DERIVED_INPUT_PATHS[number]) && (typeof candidate.value !== "number" || !Number.isFinite(candidate.value))) {
      throw new Error(`${candidate.path} must be a finite number`)
    }
    if (["initialOrbit.altitudeKm", "initialOrbit.periapsisAltitudeKm"].includes(candidate.path as typeof DERIVED_INPUT_PATHS[number]) && Number(candidate.value) < 0) {
      throw new Error(`${candidate.path} must be a non-negative number`)
    }
    if (candidate.path === "initialOrbit.utcGregorian" && typeof candidate.value !== "string") throw new Error("calendar epoch must be a UTC ISO string")
    updates.push({ path: candidate.path, value: candidate.path === "initialOrbit.epoch" ? String(candidate.value) : candidate.value })
  }
  return { message: typeof parsed.message === "string" ? parsed.message.trim() : "", updates }
}

/**
 * The Responses API normally exposes a convenient `output_text` field, but
 * compatible gateways may return only the underlying output/content blocks.
 * Accept both representations so the draft flow has the same model contract
 * as script generation and run analysis.
 */
function extractResponseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") {
    return (payload as { output_text: string }).output_text.trim()
  }
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const texts: string[] = []
  for (const item of Array.isArray(output) ? output : []) {
    const content = item && typeof item === "object" ? (item as { content?: unknown }).content : undefined
    for (const part of Array.isArray(content) ? content : []) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        texts.push((part as { text: string }).text.trim())
      }
    }
  }
  return texts.filter(Boolean).join("\n")
}

export async function discussOrbitKeepingDraft({ connection, draft, message, workspaceDir, fetchImpl = fetch }: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">
  draft: OrbitKeepingDraft
  message: string
  workspaceDir: string
  fetchImpl?: typeof fetch
}) {
  const conversation = draft.conversation.slice(-8)
  const prompt = [
    "You are a conversational spacecraft mission-definition assistant for a fixed Earth Keplerian orbit-keeping template.",
    "Help the engineer progressively define the mission. Be concise, friendly, technically precise, and ask one useful next question when mandatory information is still missing.",
    "Never invent or silently assume engineering values. You may explain a parameter, accept explicit values, or ask the engineer to confirm a proposed value.",
    "The GMAT template uses TAIModJulian. When the engineer supplies a calendar date with a timezone or explicitly says UTC, emit { path: initialOrbit.utcGregorian, value: YYYY-MM-DDTHH:mm:ssZ }; the backend deterministically converts it to numeric TAIModJulian with the TAI-UTC leap-second table. If no timezone is supplied, ask the engineer to specify it; never assume a local timezone.",
    "Return YAML only, with exactly: message: string; updates: [{ path: known path, value: string|number }]. Always include updates: [], even when no value is recorded.",
    "Use human language in message; never expose internal field paths there.",
    `Known fields: ${fields.map(field => `${field.path} (${field.label}${field.unit ? `, ${field.unit}` : ""}${field.required ? ", mandatory" : ", optional"})`).join("; ")}`,
    draft.digitalThreadRequiredPaths?.length ? `For this digital-thread-managed run, these fields are mandatory even if the legacy template marks them optional: ${draft.digitalThreadRequiredPaths.join(", ")}.` : "",
    draft.digitalThreadRequiredPaths?.length ? `Satellite-owned values are locked for this mission: ${[...SATELLITE_OWNED_FIELDS].join(", ")}. Do not emit updates for them; explain that they come from the selected satellite.` : "",
    `Derived input: when the engineer gives a circular-orbit altitude in km, emit { path: initialOrbit.altitudeKm, value: number }. The backend deterministically converts it to initialOrbit.smaKm by adding Earth equatorial radius ${EARTH_EQUATORIAL_RADIUS_KM} km. For a perigee altitude and eccentricity, emit initialOrbit.periapsisAltitudeKm and initialOrbit.eccentricity; the backend computes SMA = (Earth equatorial radius + periapsis altitude) / (1 - ECC). Do not calculate either conversion yourself.`,
    "Deterministic coordinate conversions are available. If a Cartesian initial state is supplied, emit initialState.xKm, initialState.yKm, initialState.zKm (km) and initialState.vxKmPerSec, initialState.vyKmPerSec, initialState.vzKmPerSec (km/s); the backend converts it to the Keplerian orbit fields. To display the Cartesian equivalent of complete Keplerian inputs, emit coordinateConversion.request with value keplerian_to_cartesian. Never calculate those conversions yourself.",
    draft.digitalThreadRequiredPaths?.length ? "Only RAAN, argument of periapsis, and true anomaly may retain their explicit orientation defaults. Do not use legacy spacecraft defaults for a digital-thread-managed run." : "RAAN, argument of periapsis, true anomaly, drag area, drag coefficient, and specific impulse are optional. If omitted, the fixed template defaults are kept.",
    "Initial fuel mass is a required mission input. It may be any value from 0 to 100 kg. Fuel reserve and final altitude are optional assumptions; use 1 kg and 150 km unless the engineer changes them.",
    "Target semi-major axis follows the initial semi-major axis by default. Only emit stationKeeping.targetSmaKm when the engineer explicitly asks for a different target.",
    `Current values: ${JSON.stringify(draft.values)}`,
    conversation.length ? `Recent conversation: ${JSON.stringify(conversation)}` : "Recent conversation: none; begin by helping the engineer define the mission.",
    `Engineer message: ${message}`,
  ].join("\n\n")
  const response = await requestGmatModel(fetchImpl, `${connection.baseUrl.replace(/\/+$/u, "")}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: connection.model, input: prompt, max_output_tokens: 900 }),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`LLM draft request failed: HTTP ${response.status}`)
  let payload: unknown
  try { payload = JSON.parse(body) as { output_text?: unknown } } catch { throw new Error("LLM draft response is invalid JSON") }
  const responseText = extractResponseText(payload)
  if (!responseText) throw new Error("LLM draft response contains no text")
  const patch = parseAssistantPatch(responseText, draft.digitalThreadRequiredPaths?.length ? SATELLITE_OWNED_FIELDS : undefined)
  const updatedValues = { ...draft.values }
  const initialSmaUpdate = patch.updates.find(update => ["initialOrbit.smaKm", "initialOrbit.altitudeKm", "initialOrbit.periapsisAltitudeKm", ...CARTESIAN_STATE_PATHS].includes(update.path))
  const targetSmaUpdate = patch.updates.find(update => update.path === "stationKeeping.targetSmaKm")
  for (const update of patch.updates) {
    if (update.path === "initialOrbit.altitudeKm") {
      updatedValues["initialOrbit.smaKm"] = Number((Number(update.value) + EARTH_EQUATORIAL_RADIUS_KM).toFixed(9))
    } else if (update.path === "initialOrbit.utcGregorian") {
      updatedValues["initialOrbit.epoch"] = utcGregorianToTaiModJulian(String(update.value))
    } else {
      updatedValues[update.path] = update.value
    }
  }
  if (patch.updates.some(update => update.path === "initialOrbit.periapsisAltitudeKm" || update.path === "initialOrbit.eccentricity")) {
    const periapsisAltitudeKm = numberAt(updatedValues, "initialOrbit.periapsisAltitudeKm")
    const eccentricity = numberAt(updatedValues, "initialOrbit.eccentricity")
    if (periapsisAltitudeKm !== null && eccentricity !== null) updatedValues["initialOrbit.smaKm"] = semiMajorAxisFromPeriapsisAltitude(periapsisAltitudeKm, eccentricity)
  }
  const conversion = coordinateConversionSummary(updatedValues, {
    cartesianWasUpdated: patch.updates.some(update => CARTESIAN_STATE_PATHS.includes(update.path as typeof CARTESIAN_STATE_PATHS[number])),
    keplerianWasUpdated: patch.updates.some(update => KEPLERIAN_ORBIT_PATHS.includes(update.path as typeof KEPLERIAN_ORBIT_PATHS[number])) || patch.updates.some(update => update.path === "initialOrbit.altitudeKm" || update.path === "initialOrbit.periapsisAltitudeKm"),
    request: patch.updates.find(update => update.path === "coordinateConversion.request")?.value,
  })
  const targetSmaFollowsInitial = targetSmaUpdate ? false : draft.targetSmaFollowsInitial
  if (initialSmaUpdate && targetSmaFollowsInitial) {
    updatedValues["stationKeeping.targetSmaKm"] = updatedValues["initialOrbit.smaKm"]
  }
  const next = refreshDraft({
    ...draft,
    assistantMessage: [patch.message || "I have updated the mission draft. What would you like to define next?", conversion].filter(Boolean).join("\n\n"),
    confirmed: false,
    conversationStartedAt: draft.conversationStartedAt ?? new Date().toISOString(),
    conversation: [...draft.conversation, { assistant: [patch.message || "Mission draft updated.", conversion].filter(Boolean).join("\n\n"), user: message }].slice(-20),
    targetSmaFollowsInitial,
    values: updatedValues,
  })
  return saveDraft(workspaceDir, next)
}

export async function confirmOrbitKeepingDraft(workspaceDir: string, draftId: string, authoritativeValues?: Record<string, DraftValue>) {
  let draft = await loadOrbitKeepingDraft(workspaceDir, draftId)
  if (authoritativeValues) {
    const values = { ...draft.values }
    for (const field of fields) if (authoritativeValues[field.path] !== undefined) values[field.path] = authoritativeValues[field.path]
    draft = await saveDraft(workspaceDir, refreshDraft({ ...draft, confirmed: false, values }))
  }
  if (draft.missing.length) throw new Error(`GMAT draft is incomplete: ${draft.missing.join(", ")}`)
  const blockingChecks = draft.safety.checks.filter(check => check.severity === "error")
  if (blockingChecks.length) throw new Error(`GMAT physical sanity checks failed: ${blockingChecks.map(check => check.message).join(" ")}`)
  return saveDraft(workspaceDir, refreshDraft({ ...draft, confirmed: true }))
}

/** Stores a completed GMAT execution in the same mission discussion as its draft. */
export async function recordOrbitKeepingDraftRun(workspaceDir: string, draftId: string, run: OrbitKeepingDraftRun) {
  const draft = await loadOrbitKeepingDraft(workspaceDir, draftId)
  if (draft.status !== "confirmed") throw new Error("GMAT draft must be confirmed before recording a run")
  if (!/^[-A-Za-z0-9_]+$/u.test(run.runId) || !/^gmat[\\/]orbit-keeping[\\/][-A-Za-z0-9_]+$/u.test(run.runPath)) {
    throw new Error("invalid GMAT run reference")
  }
  const runs = [...draft.runs.filter(existing => existing.runId !== run.runId), run]
  return saveDraft(workspaceDir, refreshDraft({ ...draft, runs }))
}

export function draftToOrbitKeepingChanges(draft: OrbitKeepingDraft, values: OrbitKeepingValues): OrbitKeepingValueChange[] {
  if (draft.status !== "confirmed") throw new Error("GMAT draft must be confirmed before execution")
  if (draft.safety.checks.some(check => check.severity === "error")) throw new Error("GMAT draft has unresolved physical sanity checks")
  return fields.flatMap(field => {
    const value = draft.values[field.path]
    const slot = values.slots.find(candidate => candidate.context.includes(field.context))
    if (!slot) throw new Error(`template does not expose draft field ${field.path}`)
    if (value === null) {
      if (!field.required) return []
      throw new Error(`template does not expose draft field ${field.path}`)
    }
    const text = typeof value === "number" ? String(value) : `'${value.replace(/'/gu, "")}'`
    const matches = field.context === "TOI.Isp"
      ? values.slots.filter(candidate => candidate.context.includes(".Isp"))
      : [slot]
    return matches.map(candidate => ({ id: candidate.id, value: text }))
  })
}
