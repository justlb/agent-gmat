import fs from "node:fs/promises"
import path from "node:path"
import { stringify } from "yaml"
import { initializeDraftDigitalThread, isMissionRunWorkspace } from "../digitalThread/digitalThreadStore.js"
import { beginRunStage, invalidateDownstreamFromGmat } from "../runs/runLifecycle.js"
import { updateRunManifest } from "../runs/runManifest.js"
import { runManagedProcess } from "./externalProcess.js"
import { toGmatNativePath } from "./orbitKeepingRunner.js"
import { gmatMissionScenarioDefinition, type GmatMissionScenarioId } from "./templateRegistry.js"
import { renderGmatTemplate, renderPropagation, type GmatBinding, type ScenarioValue } from "./declarativeScenarioEngine.js"

type Value = ScenarioValue
type Draft = { assistantMessage?: string; confirmed: boolean; conversation: Array<{ assistant: string; user: string }>; createdAt: string; digitalThreadRequiredPaths?: string[]; draftId: string; missing: string[]; runs: Array<{ completedAt: string; missionValues?: Record<string, Value>; result: { error?: string; status: string }; runId: string; runPath: string }>; status: "collecting" | "ready" | "confirmed"; templateId: GmatMissionScenarioId; updatedAt: string; values: Record<string, Value> }
type Scenario = { id: GmatMissionScenarioId; script: string; spacecraft: string; forceModel: string; tank: string; maneuvers: string[]; leo?: boolean; electric?: boolean; extras: Record<string, { properties: string[]; value: Value; required?: boolean }> }

const EARTH_RADIUS_KM = 6378.1363
const common = { "initialOrbit.epoch": "21545", "initialOrbit.eccentricity": 0, "initialOrbit.inclinationDeg": 0, "initialOrbit.raanDeg": 0, "initialOrbit.argPeriapsisDeg": 0, "initialOrbit.trueAnomalyDeg": 0, "spacecraft.dryMassKg": 1800, "spacecraft.dragCoefficient": 2.2, "spacecraft.reflectivityCoefficient": 1.4, "spacecraft.dragAreaM2": 20, "spacecraft.srpAreaM2": 35, "propulsion.fuelMassKg": 500, "propulsion.ispSeconds": 320, "propagation.decrementMass": true, "propagation.includeSun": true, "propagation.includeLuna": true, "propagation.atmosphereModel": "None", "propagation.relativisticCorrection": false } as const
// Only application-level *optional* defaults belong in a fresh draft.  The
// values embedded in a GMAT reference script are examples, not mission input:
// they must never make a required field look complete in Mission Studio.
const optionalDraftDefaults: Record<string, Value> = {
  "initialOrbit.raanDeg": 0,
  "initialOrbit.argPeriapsisDeg": 0,
  "initialOrbit.trueAnomalyDeg": 0,
  "propagation.decrementMass": true,
  "propagation.includeSun": true,
  "propagation.includeLuna": true,
  "propagation.atmosphereModel": "None",
  "propagation.relativisticCorrection": false,
}
const s = (id: GmatMissionScenarioId, script: string, spacecraft: string, forceModel: string, tank: string, maneuvers: string[], extras: Scenario["extras"], leo = false, electric = false): Scenario => ({ id, script, spacecraft, forceModel, tank, maneuvers, extras, leo, electric })
export const correctedScenarios: Record<string, Scenario> = {
 "chemical-2d-transfer": s("chemical-2d-transfer", "chemical_2D_transfer.script", "DefaultSC", "DefaultProp_ForceModel", "ChemicalTank1", ["TOI", "GOI"], { "initialOrbit.smaKm": { properties: ["DefaultSC.SMA"], value: 7100 }, "initialOrbit.altitudeKm": { properties: ["DefaultSC.SMA"], value: 721.8637 }, "targetOrbit.smaKm": { properties: ["DefaultSC.Earth.RMAG"], value: 42164.169, required: true } }, true),
 "chemical-3d-transfer": s("chemical-3d-transfer", "chemical_3D_transfer.script", "DefaultSC", "AllForces", "ChemicalTank1", ["TOI", "GOI"], { "initialOrbit.smaKm": { properties: ["DefaultSC.SMA"], value: 6578 }, "initialOrbit.altitudeKm": { properties: ["DefaultSC.SMA"], value: 199.8637 }, "targetOrbit.smaKm": { properties: ["geoSat.RMAG"], value: 42166.9, required: true }, "targetOrbit.inclinationDeg": { properties: ["INC"], value: 2 } }, true),
 "chemical-escape": s("chemical-escape", "chemical_escape.script", "GEO_CHEM", "GEO_CHEM_FM", "ChemicalTank_EOL", ["RaiseGraveyard", "CircularizeGraveyard", "EscapeBurn"], { "initialOrbit.smaKm": { properties: ["GEO_CHEM.SMA"], value: 42164.17 }, "mission.mode": { properties: ["MissionMode"], value: 0 }, "mission.escapeC3": { properties: ["EscapeC3"], value: .01 } }),
 "chemical-leo-orbit-maintenance": s("chemical-leo-orbit-maintenance", "chemical_LEOorbit_maintenance.script", "DefaultSC", "DefaultProp_ForceModel", "ChemicalTank1", ["TOI", "GOI"], { "initialOrbit.altitudeKm": { properties: ["DefaultSC.SMA"], value: 253 }, "mission.minAltitudeKm": { properties: ["minAltitude"], value: 250 }, "mission.finalAltitudeKm": { properties: ["finalAltitude"], value: 150 }, "mission.targetAltitudeKm": { properties: ["targetSMA"], value: 253 } }, true),
 "electrical-2d-transfer": s("electrical-2d-transfer", "electrical_2D_transfer.script", "DefaultSC", "DefaultProp_ForceModel", "ElectricTank1", ["ElectricThruster1"], { "initialOrbit.altitudeKm": { properties: ["DefaultSC.SMA"], value: 300 }, "targetOrbit.altitudeKm": { properties: ["targetFinalAltitudeKm"], value: 35786 }, "mission.maxDays": { properties: ["maxTransferDays"], value: 1500 }, "propulsion.thrustNewtons": { properties: ["ElectricThruster1.Thrust"], value: .25 } }, true, true),
 "electrical-3d-transfer": s("electrical-3d-transfer", "electrical_3D_transfer.script", "DefaultSC", "Electric3DForceModel", "ElectricTank1", ["ElectricThruster1"], { "initialOrbit.altitudeKm": { properties: ["DefaultSC.SMA"], value: 300 }, "targetOrbit.altitudeKm": { properties: ["targetFinalAltitudeKm"], value: 35786 }, "targetOrbit.inclinationDeg": { properties: ["targetFinalInclinationDeg"], value: .01 }, "mission.maxDays": { properties: ["maxTransferDays"], value: 8000 }, "propulsion.thrustNewtons": { properties: ["ElectricThruster1.Thrust"], value: .25 } }, true, true),
 "electrical-escape": s("electrical-escape", "electrical_escape.script", "GEO_EP", "GEO_ESC_FM", "ElectricPropellantTank", ["EscapeThruster"], { "initialOrbit.smaKm": { properties: ["GEO_EP.SMA"], value: 42164.17 }, "mission.mode": { properties: ["MissionMode"], value: 1 }, "mission.escapeC3": { properties: ["EscapeC3"], value: .01 }, "propulsion.thrustNewtons": { properties: ["EscapeThruster.Thrust"], value: 1 } }, false, true),
 "electrical-leo-orbit-maintenance": s("electrical-leo-orbit-maintenance", "electrical_LEOorbit_maintenance.script", "LEO_EP", "LEO_ForceModel", "XenonTank", ["ReboostThruster"], { "initialOrbit.altitudeKm": { properties: ["LEO_EP.SMA"], value: 500 }, "mission.days": { properties: ["MissionDays"], value: 90 }, "mission.targetAltitudeKm": { properties: ["TargetSMA"], value: 500 }, "propulsion.thrustNewtons": { properties: ["ReboostThruster.Thrust"], value: .002 } }, true, true),
 "geo-chemical-station-keeping": s("geo-chemical-station-keeping", "geo_chemical_station_keeping.script", "GEO", "GEO_FM", "GEO_Tank", ["EastWest", "NorthSouth"], { "initialOrbit.smaKm": { properties: ["GEO.SMA"], value: 42164.17 }, "mission.durationDays": { properties: ["MissionDuration"], value: 30 }, "mission.controlIntervalSecs": { properties: ["ControlIntervalSecs"], value: 21600 }, "mission.fuelReserveKg": { properties: ["FuelReserveKg"], value: 5 }, "tolerance.eastWestDeg": { properties: ["tolerance_eastwest"], value: .1 }, "tolerance.northSouthDeg": { properties: ["tolerance_northsouth"], value: .05 } }),
 "geo-electric-station-keeping": s("geo-electric-station-keeping", "geo_electric_station_keeping.script", "GEO_EP", "GSO_OperationalFM", "ElectricPropellantTank", ["EW_East", "EW_West", "NormalPlus", "NormalMinus"], { "initialOrbit.smaKm": { properties: ["GEO_EP.SMA"], value: 42164.17 }, "mission.durationDays": { properties: ["MissionDuration"], value: 30 }, "mission.controlIntervalSecs": { properties: ["ControlIntervalSecs"], value: 21600 }, "mission.fuelReserveKg": { properties: ["FuelReserveKg"], value: 5 }, "propulsion.thrustNewtons": { properties: ["EW_East.Thrust", "EW_West.Thrust", "NormalPlus.Thrust", "NormalMinus.Thrust"], value: .25 } }, false, true),
 "gso-chemical-station-keeping": s("gso-chemical-station-keeping", "gso_chemical_station_keeping.script", "GSO", "GSO_FM", "GSO_Tank", ["SmaBurn", "EccBurn", "IncBurn"], { "initialOrbit.smaKm": { properties: ["GSO.SMA"], value: 42164.17 }, "mission.durationDays": { properties: ["MissionDuration"], value: 30 }, "mission.controlIntervalSecs": { properties: ["ControlIntervalSecs"], value: 21600 }, "mission.fuelReserveKg": { properties: ["FuelReserveKg"], value: 5 } }),
 "gso-electric-station-keeping": s("gso-electric-station-keeping", "gso_electric_station_keeping.script", "GSO_EP", "GSO_OperationalFM", "ElectricPropellantTank", ["EW_East", "EW_West", "NormalPlus", "NormalMinus"], { "initialOrbit.smaKm": { properties: ["GSO_EP.SMA"], value: 42164.17 }, "mission.durationDays": { properties: ["MissionDuration"], value: 30 }, "mission.controlIntervalSecs": { properties: ["ControlIntervalSecs"], value: 21600 }, "mission.fuelReserveKg": { properties: ["FuelReserveKg"], value: 5 }, "propulsion.thrustNewtons": { properties: ["EW_East.Thrust", "EW_West.Thrust", "NormalPlus.Thrust", "NormalMinus.Thrust"], value: .25 } }, false, true),
}

function scenario(id: GmatMissionScenarioId) { const item = correctedScenarios[id]; if (!item) throw new Error(`no corrected runtime for ${id}`); return item }
function draftPath(workspace: string, id: string, draftId: string) { if (!/^draft_[a-f0-9-]+$/u.test(draftId)) throw new Error("invalid draft id"); return path.join(path.resolve(workspace), "gmat", id, "drafts", draftId, "draft.json") }
function fields(config: Scenario) { return [...Object.keys(common), ...Object.keys(config.extras)] }
const SATELLITE_OWNED_INPUTS = new Set([
  "spacecraft.dryMassKg", "spacecraft.dragCoefficient", "spacecraft.reflectivityCoefficient", "spacecraft.dragAreaM2", "spacecraft.srpAreaM2",
  "propulsion.fuelMassKg", "propulsion.ispSeconds", "propulsion.thrustNewtons",
  "power.initialPowerKw", "power.initialMaxPowerKw", "power.annualDegradationPercent", "power.marginPercent", "power.systemMarginPercent",
  "power.busLoadKw", "power.minThrusterPowerKw", "power.maxThrusterPowerKw",
])
function requiredMissionPaths(id: GmatMissionScenarioId) {
  return new Set(gmatMissionScenarioDefinition(id).ui.missionInputFields
    .filter(field => field.required === true && !SATELLITE_OWNED_INPUTS.has(field.path))
    .map(field => field.path))
}
function defaults(config: Scenario) {
  const output: Record<string, Value> = { ...optionalDraftDefaults }
  const definition = gmatMissionScenarioDefinition(config.id)
  for (const [key, item] of Object.entries(config.extras)) {
    // Optional controls retain their ergonomic defaults.  Required controls
    // intentionally start empty even if the reference script contains a value.
    if (definition.ui.missionInputFields.find(field => field.path === key)?.required === false) output[key] = item.value
  }
  return output
}
function hydratedValues(id: GmatMissionScenarioId, supplied: Record<string, Value>, keepRequiredValues = true) {
  const required = requiredMissionPaths(id)
  const incoming = Object.fromEntries(Object.entries(supplied).filter(([key, value]) =>
    value !== null && value !== undefined && (keepRequiredValues || !required.has(key))))
  const values = { ...defaults(scenario(id)), ...incoming }
  // A newly-created draft must explicitly expose every required mission value
  // as missing.  Values originating from satellite.json are retained because
  // they are satellite-owned data, not fields entered in the mission form.
  for (const key of required) values[key] ??= null
  // Preserve the altitude/SMA invariant for both the initial and target
  // orbits, including drafts created before Target altitude was introduced.
  if (typeof values["initialOrbit.smaKm"] === "number") values["initialOrbit.altitudeKm"] = values["initialOrbit.smaKm"] - EARTH_RADIUS_KM
  else if (typeof values["initialOrbit.altitudeKm"] === "number") values["initialOrbit.smaKm"] = values["initialOrbit.altitudeKm"] + EARTH_RADIUS_KM
  if (typeof values["targetOrbit.smaKm"] === "number") values["targetOrbit.altitudeKm"] = values["targetOrbit.smaKm"] - EARTH_RADIUS_KM
  else if (typeof values["targetOrbit.altitudeKm"] === "number") values["targetOrbit.smaKm"] = values["targetOrbit.altitudeKm"] + EARTH_RADIUS_KM
  return values
}
function refresh(draft: Omit<Draft, "missing" | "status" | "updatedAt">): Draft {
  const definition = gmatMissionScenarioDefinition(draft.templateId)
  // Keep the execution gate and Mission Studio on one contract. Satellite
  // physical parameters (notably Cd) are defaulted from the selected vehicle
  // and never shown as mission data to be entered by an engineer.
  const required = definition.ui.missionInputFields
    .filter(field => field.required === true && !SATELLITE_OWNED_INPUTS.has(field.path))
    .map(field => field.path)
  const missing = required.filter(key => draft.values[key] === null || draft.values[key] === undefined || draft.values[key] === "")
  return { ...draft, missing, status: draft.confirmed ? "confirmed" : missing.length ? "collecting" : "ready", updatedAt: new Date().toISOString() }
}
async function save(workspace: string, draft: Draft) { const out = draftPath(workspace, draft.templateId, draft.draftId); await fs.mkdir(path.dirname(out), { recursive: true }); await Promise.all([fs.writeFile(out, `${JSON.stringify(draft, null, 2)}\n`), fs.writeFile(path.join(path.dirname(out), "values.yaml"), stringify({ draft_id: draft.draftId, template_id: draft.templateId, values: draft.values }))]); return draft }
export async function createCorrectedScenarioDraft(id: GmatMissionScenarioId, workspace: string, initial: Record<string, Value> = {}, digitalThreadRequiredPaths: string[] = []) {
  // `initial` includes satellite.json data and may also contain values read
  // from a reference script.  At creation, never copy required mission values:
  // the engineer must enter them in the frontend first.
  const values = hydratedValues(id, initial, false)
  const createdAt = new Date().toISOString()
  const draft = await save(workspace, refresh({ confirmed: false, conversation: [], createdAt, digitalThreadRequiredPaths, draftId: `draft_${crypto.randomUUID()}`, runs: [], templateId: id, values }))
  await initializeDraftDigitalThread(workspace, id, draft.draftId)
  return draft
}
export async function loadCorrectedScenarioDraft(id: GmatMissionScenarioId, workspace: string, draftId: string) {
  const draft = JSON.parse(await fs.readFile(draftPath(workspace, id, draftId), "utf8")) as Draft
  if (draft.templateId !== id) throw new Error("draft does not match scenario")
  // Drafts created before defaults were introduced are upgraded on read, so
  // their optional fields render exactly like a newly created scenario.
  return save(workspace, refresh({ ...draft, values: hydratedValues(id, draft.values) }))
}
export async function setCorrectedScenarioDraftValue(id: GmatMissionScenarioId, workspace: string, draft: Draft, key: string, raw: string) { const initialOrbitPair = key === "initialOrbit.smaKm" || key === "initialOrbit.altitudeKm"; const targetOrbitPair = key === "targetOrbit.smaKm" || key === "targetOrbit.altitudeKm"; if (!initialOrbitPair && !targetOrbitPair && !fields(scenario(id)).includes(key) && !key.startsWith("power.")) throw new Error("unsupported mission value"); const value: Value = ["initialOrbit.epoch", "propagation.atmosphereModel"].includes(key) ? raw.trim() : raw === "true" ? true : raw === "false" ? false : Number(raw); if (value === "" || typeof value === "number" && !Number.isFinite(value)) throw new Error("a finite value is required"); const values = (initialOrbitPair || targetOrbitPair) && typeof value === "number" ? { ...draft.values, [key]: value, ...(key === "initialOrbit.smaKm" ? { "initialOrbit.altitudeKm": value - EARTH_RADIUS_KM } : key === "initialOrbit.altitudeKm" ? { "initialOrbit.smaKm": value + EARTH_RADIUS_KM } : key === "targetOrbit.smaKm" ? { "targetOrbit.altitudeKm": value - EARTH_RADIUS_KM } : { "targetOrbit.smaKm": value + EARTH_RADIUS_KM }) } : { ...draft.values, [key]: value }; return save(workspace, refresh({ ...draft, confirmed: false, values })) }
export async function confirmCorrectedScenarioDraft(id: GmatMissionScenarioId, workspace: string, draftId: string) { const draft = await loadCorrectedScenarioDraft(id, workspace, draftId); if (draft.missing.length) throw new Error(`mission is incomplete: ${draft.missing.join(", ")}`); return save(workspace, refresh({ ...draft, confirmed: true })) }
export async function discussCorrectedScenarioDraft(id: GmatMissionScenarioId, workspace: string, draft: Draft, message: string) { const assistantMessage = "Renseignez les paramètres de mission obligatoires. Ils seront enregistrés dans satellite.json puis appliqués au modèle GMAT lors de l'exécution."; return save(workspace, refresh({ ...draft, confirmed: false, assistantMessage, conversation: [...draft.conversation, { assistant: assistantMessage, user: message }] })) }
export async function appendCorrectedScenarioDraftConversation(id: GmatMissionScenarioId, workspace: string, draftId: string, turn: { assistant: string; user: string }) { const draft = await loadCorrectedScenarioDraft(id, workspace, draftId); return save(workspace, refresh({ ...draft, conversation: [...draft.conversation, turn] })) }
function cartesianFromKepler(smaKm: number, eccentricity: number, inclinationDeg: number, raanDeg: number, argPeriapsisDeg: number, trueAnomalyDeg: number) {
  const rad = Math.PI / 180, mu = 398600.4418, p = smaKm * (1 - eccentricity ** 2), nu = trueAnomalyDeg * rad
  const r = p / (1 + eccentricity * Math.cos(nu)), x0 = r * Math.cos(nu), y0 = r * Math.sin(nu)
  const scale = Math.sqrt(mu / p), vx0 = -scale * Math.sin(nu), vy0 = scale * (eccentricity + Math.cos(nu))
  const raan = raanDeg * rad, inc = inclinationDeg * rad, aop = argPeriapsisDeg * rad
  const cO = Math.cos(raan), sO = Math.sin(raan), ci = Math.cos(inc), si = Math.sin(inc), cw = Math.cos(aop), sw = Math.sin(aop)
  const q11 = cO * cw - sO * sw * ci, q12 = -cO * sw - sO * cw * ci, q21 = sO * cw + cO * sw * ci, q22 = -sO * sw + cO * cw * ci, q31 = sw * si, q32 = cw * si
  return { xKm: q11 * x0 + q12 * y0, yKm: q21 * x0 + q22 * y0, zKm: q31 * x0 + q32 * y0, vxKmPerSec: q11 * vx0 + q12 * vy0, vyKmPerSec: q21 * vx0 + q22 * vy0, vzKmPerSec: q31 * vx0 + q32 * vy0 }
}

function gmatFailureMessage(output: string) {
  const details = [...output.matchAll(/^(?:Hardware|Interpreter|Command|SolarSystem|Propagator|Utility|Subscriber|Solver) Exception(?: Thrown)?:\s*(.+)$/gmu)]
  return details.at(-1)?.[1]?.trim()
}
const electricHardware: Partial<Record<GmatMissionScenarioId, { powerSystem: string; thrusters: string[] }>> = {
  "electrical-2d-transfer": { powerSystem: "SolarPowerSystem1", thrusters: ["ElectricThruster1"] },
  "electrical-3d-transfer": { powerSystem: "SolarPowerSystem3D", thrusters: ["ElectricTangentialThruster", "ElectricNormalMinusThruster", "ElectricNormalPlusThruster"] },
  "electrical-escape": { powerSystem: "GEO_SolarArray_ESC", thrusters: ["EP_Prograde"] },
  "electrical-leo-orbit-maintenance": { powerSystem: "SolarArray", thrusters: ["ReboostThruster"] },
  "geo-electric-station-keeping": { powerSystem: "GSO_SolarArray", thrusters: ["EW_East", "EW_West", "NormalPlus", "NormalMinus"] },
  "gso-electric-station-keeping": { powerSystem: "GSO_SolarArray", thrusters: ["EW_East", "EW_West", "NormalPlus", "NormalMinus"] },
}

function render(id: GmatMissionScenarioId, source: string, values: Record<string, Value>, oem: string) {
  const config = scenario(id)
  const hardware = electricHardware[id]
  const thrusters = hardware?.thrusters ?? config.maneuvers
  const v = { ...values }
  // A few legacy templates use a subscriber name other than EphemerisFile1.
  // Bind the existing filename assignment in every case; never create one here.
  const ephemerisProperties = [...source.matchAll(/^Create EphemerisFile\s+([A-Za-z][A-Za-z0-9_]*)\s*;/gmu)].map(match => `${match[1]}.Filename`)
  if (config.leo) {
    // The spacecraft SMA assignment consumes initial altitude as a radius.
    // Other altitude inputs are converted only when their actual GMAT target
    // is an SMA/RMAG variable; `targetFinalAltitudeKm` must remain an altitude.
    if (typeof v["initialOrbit.altitudeKm"] === "number") v["initialOrbit.altitudeKm"] += EARTH_RADIUS_KM
    for (const [key, item] of Object.entries(config.extras)) {
      if (key === "initialOrbit.altitudeKm" || !key.toLowerCase().includes("altitudekm")) continue
      if (typeof v[key] === "number" && item.properties.some(property => /sma|rmag/iu.test(property))) v[key] += EARTH_RADIUS_KM
    }
  }
  if (!new RegExp(`^${config.spacecraft}\\.SMA\\s*=`, "mu").test(source)) {
    const state = cartesianFromKepler(Number(v[config.leo ? "initialOrbit.altitudeKm" : "initialOrbit.smaKm"]), Number(v["initialOrbit.eccentricity"]), Number(v["initialOrbit.inclinationDeg"]), Number(v["initialOrbit.raanDeg"]), Number(v["initialOrbit.argPeriapsisDeg"]), Number(v["initialOrbit.trueAnomalyDeg"]))
    Object.assign(v, { "initialOrbit.xKm": state.xKm, "initialOrbit.yKm": state.yKm, "initialOrbit.zKm": state.zKm, "initialOrbit.vxKmPerSec": state.vxKmPerSec, "initialOrbit.vyKmPerSec": state.vyKmPerSec, "initialOrbit.vzKmPerSec": state.vzKmPerSec })
  }
  const bindings: GmatBinding[] = [
    { path: "initialOrbit.epoch", properties: [`${config.spacecraft}.Epoch`], quote: true },
    { path: config.leo ? "initialOrbit.altitudeKm" : "initialOrbit.smaKm", properties: [`${config.spacecraft}.SMA`] },
    ...["X", "Y", "Z", "VX", "VY", "VZ"].map(property => ({ path: `initialOrbit.${property.toLowerCase().replace("v", "v")}Km${property.startsWith("V") ? "PerSec" : ""}`, properties: [`${config.spacecraft}.${property}`] })),
    { path: "initialOrbit.eccentricity", properties: [`${config.spacecraft}.ECC`] },
    { path: "initialOrbit.inclinationDeg", properties: [`${config.spacecraft}.INC`] },
    { path: "initialOrbit.raanDeg", properties: [`${config.spacecraft}.RAAN`] },
    { path: "initialOrbit.argPeriapsisDeg", properties: [`${config.spacecraft}.AOP`] },
    { path: "initialOrbit.trueAnomalyDeg", properties: [`${config.spacecraft}.TA`] },
    { path: "spacecraft.dryMassKg", properties: [`${config.spacecraft}.DryMass`] },
    { path: "spacecraft.dragCoefficient", properties: [`${config.spacecraft}.Cd`] },
    { path: "spacecraft.reflectivityCoefficient", properties: [`${config.spacecraft}.Cr`] },
    { path: "spacecraft.dragAreaM2", properties: [`${config.spacecraft}.DragArea`] },
    { path: "spacecraft.srpAreaM2", properties: [`${config.spacecraft}.SRPArea`] },
    { path: "propulsion.fuelMassKg", properties: [`${config.tank}.FuelMass`] },
    { path: "propulsion.ispSeconds", properties: thrusters.map(name => `${name}.Isp`) },
    { path: "propulsion.thrustNewtons", properties: thrusters.map(name => `${name}.ConstantThrust`) },
    ...(hardware ? [
      { path: "power.initialPowerKw", properties: [`${hardware.powerSystem}.InitialMaxPower`] },
      { path: "power.annualDegradationPercent", properties: [`${hardware.powerSystem}.AnnualDecayRate`] },
      { path: "power.marginPercent", properties: [`${hardware.powerSystem}.Margin`] },
      { path: "power.busLoadKw", properties: [`${hardware.powerSystem}.BusCoeff1`] },
      { path: "power.minThrusterPowerKw", properties: thrusters.map(name => `${name}.MinimumUsablePower`) },
      { path: "power.maxThrusterPowerKw", properties: thrusters.map(name => `${name}.MaximumUsablePower`) },
    ] satisfies GmatBinding[] : []),
    { path: "output.oem", properties: ephemerisProperties, quote: true },
  ]
  for (const [key, item] of Object.entries(config.extras)) if (!bindings.some(binding => binding.path === key)) bindings.push({ path: key, properties: item.properties, required: item.required })
  let script = renderGmatTemplate(source, { ...v, "output.oem": toGmatNativePath(oem).replace(/\\/gu, "/") }, bindings)
  script = renderPropagation(script, v, config.forceModel, thrusters)
  return script
}
export async function generateCorrectedScenarioMission(id: GmatMissionScenarioId, { draft, workspaceDir, execution }: { draft: Draft; workspaceDir: string; execution?: { bin: string; timeoutMs: number } }) {
  if (!draft.confirmed || draft.missing.length) throw new Error("confirm the complete mission draft before execution")
  if (!isMissionRunWorkspace(workspaceDir)) throw new Error("GMAT generation requires a dated mission workspace")
  const definition = gmatMissionScenarioDefinition(id)
  const runDir = path.resolve(workspaceDir)
  const base = scenario(id).script.replace(/\.script$/u, "")
  const scriptPath = path.join(runDir, `${base}.script`)
  const valuesPath = path.join(runDir, `${base}.values.yaml`)
  const resultPath = path.join(runDir, "gmat_result.json")
  const logPath = path.join(runDir, "gmat.log")
  const oem = path.join(runDir, "EphemerisFile1.oem")
  const reference = await fs.readFile(path.join(definition.skillDirectory, definition.gmatReferenceScript), "utf8")
  const referenceWritesOem = /^Create EphemerisFile EphemerisFile1;/mu.test(reference)
  await fs.writeFile(valuesPath, stringify({ draft_id: draft.draftId, template_id: id, values: draft.values }))
  await fs.writeFile(scriptPath, render(id, reference, draft.values, oem))
  let result: { error?: string; executionDurationMs?: number; status: "generated" | "completed" | "failed" | "timeout" } = { status: "generated" }
  if (execution) {
    await fs.rm(oem, { force: true })
    await beginRunStage(runDir, "gmat", "GMAT simulation is running.")
    const started = Date.now()
    const process = await runManagedProcess({ args: ["--run", toGmatNativePath(scriptPath)], command: execution.bin, cwd: runDir, timeoutMs: execution.timeoutMs })
    await fs.writeFile(logPath, process.output)
    const hasOem = await fs.stat(oem).then(item => item.size > 0).catch(() => false)
    const status = process.timedOut ? "timeout" : process.exitCode === 0 && (!referenceWritesOem || hasOem) ? "completed" : "failed"
    const detail = gmatFailureMessage(String(process.output))
    result = { executionDurationMs: Date.now() - started, status, ...(status === "completed" ? {} : { error: process.timedOut ? "GMAT timed out" : detail ? `GMAT failed: ${detail}` : referenceWritesOem ? "GMAT did not produce EphemerisFile1.oem" : "GMAT failed" }) }
  }
  await Promise.all([fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`), updateRunManifest(runDir, { templateId: id, status: result.status, outputs: { ephemeris: result.status === "completed" && referenceWritesOem ? path.basename(oem) : null } })])
  await invalidateDownstreamFromGmat(runDir)
  return { changes: [], result, runDir, runId: path.basename(runDir) }
}
export async function recordCorrectedScenarioDraftRun(id: GmatMissionScenarioId, workspace: string, draft: Draft, execution: Awaited<ReturnType<typeof generateCorrectedScenarioMission>>, runPath: string) { return save(workspace, refresh({ ...draft, runs: [...draft.runs.filter(run => run.runId !== execution.runId), { completedAt: new Date().toISOString(), missionValues: { ...draft.values }, result: execution.result, runId: execution.runId, runPath }] })) }
