/**
 * Role: Draft, render and execute the chemical GEO/GSO station-keeping
 * mission scenario from one immutable GMAT reference script.
 * Exports: mission-template runtime operations for geo-gso-orbit-keeping.
 * Dependencies: dated mission workspace, lifecycle, manifest and guardrails.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { stringify } from "yaml"

import { initializeDraftDigitalThread, isMissionRunWorkspace } from "../digitalThread/digitalThreadStore.js"
import { beginRunStage, invalidateDownstreamFromGmat } from "../runs/runLifecycle.js"
import { updateRunManifest } from "../runs/runManifest.js"
import { runManagedProcess } from "./externalProcess.js"
import { toGmatNativePath } from "./orbitKeepingRunner.js"
import { assertGmatMissionGuardrails, validateGmatMissionGuardrails } from "./missionGuardrails.js"
import { gmatMissionScenarioDefinition } from "./templateRegistry.js"

type Value = string | number | null
type Run = { completedAt: string; result: { error?: string; status: string }; runId: string; runPath: string }
export type GeoGsoOrbitKeepingDraft = { assistantMessage?: string; confirmed: boolean; conversation: Array<{ assistant: string; user: string }>; createdAt: string; digitalThreadRequiredPaths?: string[]; draftId: string; missing: string[]; runs: Run[]; status: "collecting" | "ready" | "confirmed"; templateId: "geo-gso-orbit-keeping"; updatedAt: string; values: Record<string, Value> }

const GEO_NOMINAL_SMA_KM = 42164.17
const requiredFields = ["initialOrbit.epoch", "initialOrbit.smaKm", "initialOrbit.eccentricity", "initialOrbit.inclinationDeg", "initialOrbit.raanDeg", "initialOrbit.argPeriapsisDeg", "initialOrbit.trueAnomalyDeg", "spacecraft.initialFuelMassKg", "spacecraft.dryMassKg", "spacecraft.dragAreaM2", "spacecraft.dragCoefficient", "propulsion.ispSeconds"] as const
const fields = [...requiredFields, "stationKeeping.northSouthToleranceDeg", "stationKeeping.eastWestToleranceDeg", "stationKeeping.eccentricityTolerance", "stationKeeping.daysOfOk", "stationKeeping.controlIntervalSecs", "stationKeeping.fuelReserveKg", "stationKeeping.eastWestPulseKmPerSec", "stationKeeping.northSouthPulseKmPerSec", "stationKeeping.eastWestGuardbandDeg", "propagation.decrementMass", "propagation.includeSun", "propagation.includeLuna", "propagation.atmosphereModel", "propagation.relativisticCorrection"] as const
const defaults: Record<string, Value> = { "initialOrbit.epoch": "21545", "initialOrbit.smaKm": GEO_NOMINAL_SMA_KM, "initialOrbit.eccentricity": 0, "initialOrbit.inclinationDeg": 0, "initialOrbit.raanDeg": 0, "initialOrbit.argPeriapsisDeg": 0, "initialOrbit.trueAnomalyDeg": 0, "spacecraft.initialFuelMassKg": 500, "spacecraft.dryMassKg": 1800, "spacecraft.dragAreaM2": 20, "spacecraft.dragCoefficient": 2.2, "propulsion.ispSeconds": 320, "stationKeeping.northSouthToleranceDeg": 0.05, "stationKeeping.eastWestToleranceDeg": 0.1, "stationKeeping.eccentricityTolerance": 0.0004, "stationKeeping.daysOfOk": 30, "stationKeeping.controlIntervalSecs": 3600, "stationKeeping.fuelReserveKg": 5, "stationKeeping.eastWestPulseKmPerSec": 0.00005, "stationKeeping.northSouthPulseKmPerSec": 0.001, "stationKeeping.eastWestGuardbandDeg": 0.01, "propagation.decrementMass": 1, "propagation.includeSun": 1, "propagation.includeLuna": 1, "propagation.atmosphereModel": "None", "propagation.relativisticCorrection": 0 }

function draftPath(workspaceDir: string, draftId: string) {
  if (!/^draft_[a-f0-9-]+$/u.test(draftId)) throw new Error("invalid GEO/GSO draft id")
  return path.join(path.resolve(workspaceDir), "gmat", "geo-gso-orbit-keeping", "drafts", draftId, "draft.json")
}
function epoch(value: Value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value) || Number(value) < 6116 || Number(value) > 58127.5) throw new Error("initial epoch must be a GMAT-compatible numeric TAIModJulian")
}
function refresh(draft: Omit<GeoGsoOrbitKeepingDraft, "missing" | "status" | "updatedAt">): GeoGsoOrbitKeepingDraft {
  if (draft.values["initialOrbit.epoch"] !== null) epoch(draft.values["initialOrbit.epoch"])
  const missing = requiredFields.filter(field => draft.values[field] === null || draft.values[field] === undefined || draft.values[field] === "")
  return { ...draft, missing, status: draft.confirmed ? "confirmed" : missing.length ? "collecting" : "ready", updatedAt: new Date().toISOString() }
}
async function save(workspaceDir: string, draft: GeoGsoOrbitKeepingDraft) {
  const output = draftPath(workspaceDir, draft.draftId)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await Promise.all([fs.writeFile(output, `${JSON.stringify(draft, null, 2)}\n`), fs.writeFile(path.join(path.dirname(output), "geo_gso_orbit_keeping.values.yaml"), stringify({ draft_id: draft.draftId, template_id: draft.templateId, values: draft.values }))])
  return draft
}
export async function createGeoGsoOrbitKeepingDraft(workspaceDir: string, initialValues: Record<string, Value> = {}, digitalThreadRequiredPaths: string[] = []) {
  const createdAt = new Date().toISOString()
  const values = Object.fromEntries(fields.map(field => [field, initialValues[field] ?? defaults[field] ?? null])) as Record<string, Value>
  const draft = await save(workspaceDir, refresh({ confirmed: false, conversation: [], createdAt, digitalThreadRequiredPaths, draftId: `draft_${crypto.randomUUID()}`, runs: [], templateId: "geo-gso-orbit-keeping", values }))
  await initializeDraftDigitalThread(workspaceDir, "geo-gso-orbit-keeping", draft.draftId)
  return draft
}
export async function loadGeoGsoOrbitKeepingDraft(workspaceDir: string, draftId: string) {
  const source = JSON.parse(await fs.readFile(draftPath(workspaceDir, draftId), "utf8")) as GeoGsoOrbitKeepingDraft
  if (source.templateId !== "geo-gso-orbit-keeping") throw new Error("unsupported GEO/GSO orbit-keeping draft")
  return refresh({ ...source, conversation: Array.isArray(source.conversation) ? source.conversation : [], runs: Array.isArray(source.runs) ? source.runs : [], values: source.values })
}
export async function setGeoGsoOrbitKeepingDraftValue(workspaceDir: string, draft: GeoGsoOrbitKeepingDraft, field: string, raw: string) {
  if (!fields.includes(field as typeof fields[number])) throw new Error("unsupported GEO/GSO mission value")
  const value: Value = field === "initialOrbit.epoch" || field === "propagation.atmosphereModel" ? raw.trim() : Number(raw)
  if (value === "" || typeof value === "number" && !Number.isFinite(value)) throw new Error("a finite value is required")
  if (field === "initialOrbit.epoch") epoch(value)
  const values = { ...draft.values, [field]: value }
  const guards = validateGmatMissionGuardrails("geo-gso-orbit-keeping", values)
  if (guards.length) throw new Error(`GMAT mission guardrails failed: ${guards.map(guard => guard.message).join(" ")}`)
  return save(workspaceDir, refresh({ ...draft, confirmed: false, values }))
}
export async function confirmGeoGsoOrbitKeepingDraft(workspaceDir: string, draftId: string, authoritative?: Record<string, Value>) {
  const current = await loadGeoGsoOrbitKeepingDraft(workspaceDir, draftId)
  const values = current.values
  const draft = refresh({ ...current, confirmed: false, values })
  if (draft.missing.length) throw new Error(`GEO/GSO draft is incomplete: ${draft.missing.join(", ")}`)
  assertGmatMissionGuardrails("geo-gso-orbit-keeping", draft.values)
  return save(workspaceDir, refresh({ ...draft, confirmed: true }))
}
export async function discussGeoGsoOrbitKeepingDraft({ draft, workspaceDir, message }: { draft: GeoGsoOrbitKeepingDraft; workspaceDir: string; message: string }) {
  const assistantMessage = `Use the editable Mission Studio fields to record the GEO/GSO state, fuel mass and tolerances. I received: ${message}`
  return save(workspaceDir, refresh({ ...draft, assistantMessage, confirmed: false, conversation: [...draft.conversation, { assistant: assistantMessage, user: message }] }))
}
export async function appendGeoGsoOrbitKeepingDraftConversation(workspaceDir: string, draftId: string, turn: { assistant: string; user: string }) {
  const draft = await loadGeoGsoOrbitKeepingDraft(workspaceDir, draftId)
  return save(workspaceDir, refresh({ ...draft, conversation: [...draft.conversation, turn] }))
}
function number(values: Record<string, Value>, field: string) { const value = values[field]; if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`GEO/GSO scenario requires ${field}`); return value }
function replace(script: string, property: string, value: string) { const pattern = new RegExp(`^(${property.replace(/\./gu, "\\.")}\\s*=\\s*)[^;]+;`, "mu"); if (!pattern.test(script)) throw new Error(`GEO/GSO reference script does not expose ${property}`); return script.replace(pattern, `$1${value};`) }
function render(source: string, values: Record<string, Value>, ephemerisPath: string) {
  const flag = (field: string) => number(values, field) > 0
  const atmosphere = values["propagation.atmosphereModel"]
  if (atmosphere !== "None" && atmosphere !== "MSISE90") throw new Error("unsupported atmosphere model")
  const pointMasses = [flag("propagation.includeSun") ? "Sun" : null, flag("propagation.includeLuna") ? "Luna" : null].filter((body): body is string => body !== null).join(", ")
  let script = source
  for (const [property, value] of [["GEO.Epoch", `'${values["initialOrbit.epoch"]}'`], ["GEO.SMA", String(number(values, "initialOrbit.smaKm"))], ["GEO.ECC", String(number(values, "initialOrbit.eccentricity"))], ["GEO.INC", String(number(values, "initialOrbit.inclinationDeg"))], ["GEO.RAAN", String(number(values, "initialOrbit.raanDeg"))], ["GEO.AOP", String(number(values, "initialOrbit.argPeriapsisDeg"))], ["GEO.TA", String(number(values, "initialOrbit.trueAnomalyDeg"))], ["GEO.DryMass", String(number(values, "spacecraft.dryMassKg"))], ["GEO.Cd", String(number(values, "spacecraft.dragCoefficient"))], ["GEO.DragArea", String(number(values, "spacecraft.dragAreaM2"))], ["GEO_Tank.FuelMass", String(number(values, "spacecraft.initialFuelMassKg"))], ["EastWest.Isp", String(number(values, "propulsion.ispSeconds"))], ["NorthSouth.Isp", String(number(values, "propulsion.ispSeconds"))], ["EastWest.DecrementMass", flag("propagation.decrementMass") ? "true" : "false"], ["NorthSouth.DecrementMass", flag("propagation.decrementMass") ? "true" : "false"], ["GEO_FM.PointMasses", `{${pointMasses}}`], ["GEO_FM.RelativisticCorrection", flag("propagation.relativisticCorrection") ? "On" : "Off"], ["GEO_FM.Drag", atmosphere === "None" ? "None" : "On"], ["tolerance_northsouth", String(number(values, "stationKeeping.northSouthToleranceDeg"))], ["tolerance_eastwest", String(number(values, "stationKeeping.eastWestToleranceDeg"))], ["eastwest_pulse", String(number(values, "stationKeeping.eastWestPulseKmPerSec"))], ["northsouth_pulse", String(number(values, "stationKeeping.northSouthPulseKmPerSec"))], ["eastwest_guardband", String(number(values, "stationKeeping.eastWestGuardbandDeg"))], ["fuelReserve", String(number(values, "stationKeeping.fuelReserveKg"))], ["mission_days", String(number(values, "stationKeeping.daysOfOk"))], ["ControlIntervalSecs", String(number(values, "stationKeeping.controlIntervalSecs"))], ["EphemerisFile1.Filename", `'${toGmatNativePath(ephemerisPath).replace(/\\/gu, "/")}'`]] as const) script = replace(script, property, value)
  if (atmosphere !== "None") script = script.replace(/^(GEO_FM\.Drag\s*=\s*On;)$/mu, "$1\nGEO_FM.Drag.AtmosphereModel              = " + atmosphere + ";")
  return script
}
export async function generateGeoGsoOrbitKeepingMission({ draft, workspaceDir, execution }: { draft: GeoGsoOrbitKeepingDraft; workspaceDir: string; execution?: { bin: string; timeoutMs: number } }) {
  if (!draft.confirmed || draft.missing.length) throw new Error("confirm the complete GEO/GSO draft before execution")
  assertGmatMissionGuardrails("geo-gso-orbit-keeping", draft.values)
  if (!isMissionRunWorkspace(workspaceDir)) throw new Error("GEO/GSO generation requires a dated mission run workspace")
  const runDir = path.resolve(workspaceDir); const definition = gmatMissionScenarioDefinition("geo-gso-orbit-keeping")
  const scriptPath = path.join(runDir, "geo_gso_orbit_keeping.script"), valuesPath = path.join(runDir, "geo_gso_orbit_keeping.values.yaml"), resultPath = path.join(runDir, "gmat_result.json"), manifestPath = path.join(runDir, "run_manifest.json"), logPath = path.join(runDir, "gmat.log"), ephemerisPath = path.join(runDir, "EphemerisFile1.oem")
  await fs.writeFile(valuesPath, stringify({ draft_id: draft.draftId, template_id: draft.templateId, values: draft.values }))
  await fs.writeFile(scriptPath, render(await fs.readFile(path.join(definition.skillDirectory, definition.gmatReferenceScript), "utf8"), draft.values, ephemerisPath))
  let result: { error?: string; executionDurationMs?: number; status: "generated" | "completed" | "failed" | "timeout" } = { status: "generated" }
  if (execution) { await beginRunStage(runDir, "gmat", "GMAT GEO/GSO station-keeping simulation is running."); const started = Date.now(); const process = await runManagedProcess({ args: ["--run", toGmatNativePath(scriptPath)], command: execution.bin, cwd: runDir, timeoutMs: execution.timeoutMs }); await fs.writeFile(logPath, process.output); const oem = await fs.stat(ephemerisPath).then(stat => stat.size > 0).catch(() => false); const status = process.timedOut ? "timeout" : process.exitCode === 0 && oem ? "completed" : "failed"; result = { executionDurationMs: Date.now() - started, status, ...(status === "completed" ? {} : { error: process.timedOut ? "GMAT timed out" : process.exitCode === 0 ? "GMAT completed but did not produce EphemerisFile1.oem" : `GMAT exited with code ${process.exitCode}` }) } }
  await Promise.all([fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`), updateRunManifest(runDir, { templateId: draft.templateId, status: result.status, outputs: { ephemeris: result.status === "completed" ? path.basename(ephemerisPath) : null } })]); await invalidateDownstreamFromGmat(runDir)
  return { changes: [], result, runDir, runId: path.basename(runDir), scriptPath, valuesPath, resultPath, manifestPath }
}
export async function recordGeoGsoOrbitKeepingDraftRun({ draft, execution, runPath, workspaceDir }: { draft: GeoGsoOrbitKeepingDraft; execution: Awaited<ReturnType<typeof generateGeoGsoOrbitKeepingMission>>; runPath: string; workspaceDir: string }) { return save(workspaceDir, refresh({ ...draft, runs: [...draft.runs, { completedAt: new Date().toISOString(), result: execution.result, runId: execution.runId, runPath }] })) }
