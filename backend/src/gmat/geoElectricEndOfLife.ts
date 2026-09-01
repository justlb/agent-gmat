/**
 * Role: Draft, render and execute the chemical GEO electric end-of-life station-keeping
 * mission scenario from one immutable GMAT reference script.
 * Exports: mission-template runtime operations for geo-electric-end-of-life.
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
export type GeoElectricEndOfLifeDraft = { assistantMessage?: string; confirmed: boolean; conversation: Array<{ assistant: string; user: string }>; createdAt: string; digitalThreadRequiredPaths?: string[]; draftId: string; missing: string[]; runs: Run[]; status: "collecting" | "ready" | "confirmed"; templateId: "geo-electric-end-of-life"; updatedAt: string; values: Record<string, Value> }

const GEO_NOMINAL_SMA_KM = 42164.17
const requiredFields = ["initialOrbit.epoch", "initialOrbit.eccentricity", "initialOrbit.inclinationDeg", "initialOrbit.raanDeg", "initialOrbit.argPeriapsisDeg", "initialOrbit.trueAnomalyDeg", "spacecraft.initialFuelMassKg", "spacecraft.dryMassKg", "spacecraft.dragAreaM2", "spacecraft.dragCoefficient", "propulsion.ispSeconds"] as const
const fields = [...requiredFields, "endOfLife.missionMode", "endOfLife.escapeC3Km2PerSec2", "endOfLife.maxCemeteryDays", "endOfLife.maxEscapeDays", "power.initialMaxPowerKw"] as const
const defaults: Record<string, Value> = { "initialOrbit.epoch": "21545", "initialOrbit.eccentricity": 0, "initialOrbit.inclinationDeg": 0, "initialOrbit.raanDeg": 0, "initialOrbit.argPeriapsisDeg": 0, "initialOrbit.trueAnomalyDeg": 0, "spacecraft.initialFuelMassKg": 400, "spacecraft.dryMassKg": 1800, "spacecraft.dragAreaM2": 20, "spacecraft.dragCoefficient": 2.2, "propulsion.ispSeconds": 1800, "endOfLife.missionMode": 0, "endOfLife.escapeC3Km2PerSec2": 0.01, "endOfLife.maxCemeteryDays": 20, "endOfLife.maxEscapeDays": 300, "power.initialMaxPowerKw": 30 }

function draftPath(workspaceDir: string, draftId: string) {
  if (!/^draft_[a-f0-9-]+$/u.test(draftId)) throw new Error("invalid GEO electric end-of-life draft id")
  return path.join(path.resolve(workspaceDir), "gmat", "geo-electric-end-of-life", "drafts", draftId, "draft.json")
}
function epoch(value: Value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/u.test(value) || Number(value) < 6116 || Number(value) > 58127.5) throw new Error("initial epoch must be a GMAT-compatible numeric TAIModJulian")
}
function refresh(draft: Omit<GeoElectricEndOfLifeDraft, "missing" | "status" | "updatedAt">): GeoElectricEndOfLifeDraft {
  if (draft.values["initialOrbit.epoch"] !== null) epoch(draft.values["initialOrbit.epoch"])
  const missing = requiredFields.filter(field => draft.values[field] === null || draft.values[field] === undefined || draft.values[field] === "")
  return { ...draft, missing, status: draft.confirmed ? "confirmed" : missing.length ? "collecting" : "ready", updatedAt: new Date().toISOString() }
}
async function save(workspaceDir: string, draft: GeoElectricEndOfLifeDraft) {
  const output = draftPath(workspaceDir, draft.draftId)
  await fs.mkdir(path.dirname(output), { recursive: true })
  await Promise.all([fs.writeFile(output, `${JSON.stringify(draft, null, 2)}\n`), fs.writeFile(path.join(path.dirname(output), "geo_electric_end_of_life.values.yaml"), stringify({ draft_id: draft.draftId, template_id: draft.templateId, values: draft.values }))])
  return draft
}
export async function createGeoElectricEndOfLifeDraft(workspaceDir: string, initialValues: Record<string, Value> = {}, digitalThreadRequiredPaths: string[] = []) {
  const createdAt = new Date().toISOString()
  const values = { ...Object.fromEntries(fields.map(field => [field, initialValues[field] ?? defaults[field] ?? null])), "initialOrbit.smaKm": GEO_NOMINAL_SMA_KM } as Record<string, Value>
  const draft = await save(workspaceDir, refresh({ confirmed: false, conversation: [], createdAt, digitalThreadRequiredPaths, draftId: `draft_${crypto.randomUUID()}`, runs: [], templateId: "geo-electric-end-of-life", values }))
  await initializeDraftDigitalThread(workspaceDir, "geo-electric-end-of-life", draft.draftId)
  return draft
}
export async function loadGeoElectricEndOfLifeDraft(workspaceDir: string, draftId: string) {
  const source = JSON.parse(await fs.readFile(draftPath(workspaceDir, draftId), "utf8")) as GeoElectricEndOfLifeDraft
  if (source.templateId !== "geo-electric-end-of-life") throw new Error("unsupported GEO electric end-of-life orbit-keeping draft")
  return refresh({ ...source, conversation: Array.isArray(source.conversation) ? source.conversation : [], runs: Array.isArray(source.runs) ? source.runs : [], values: source.values })
}
export async function setGeoElectricEndOfLifeDraftValue(workspaceDir: string, draft: GeoElectricEndOfLifeDraft, field: string, raw: string) {
  if (!fields.includes(field as typeof fields[number])) throw new Error("unsupported GEO/GSO mission value")
  const value: Value = field === "initialOrbit.epoch" ? raw.trim() : Number(raw)
  if (value === "" || typeof value === "number" && !Number.isFinite(value)) throw new Error("a finite value is required")
  if (field === "initialOrbit.epoch") epoch(value)
  const values = { ...draft.values, [field]: value }
  const guards = validateGmatMissionGuardrails("geo-electric-end-of-life", values)
  if (guards.length) throw new Error(`GMAT mission guardrails failed: ${guards.map(guard => guard.message).join(" ")}`)
  return save(workspaceDir, refresh({ ...draft, confirmed: false, values }))
}
export async function confirmGeoElectricEndOfLifeDraft(workspaceDir: string, draftId: string, authoritative?: Record<string, Value>) {
  const current = await loadGeoElectricEndOfLifeDraft(workspaceDir, draftId)
  const values = current.values
  const draft = refresh({ ...current, confirmed: false, values })
  if (draft.missing.length) throw new Error(`GEO electric end-of-life draft is incomplete: ${draft.missing.join(", ")}`)
  assertGmatMissionGuardrails("geo-electric-end-of-life", draft.values)
  return save(workspaceDir, refresh({ ...draft, confirmed: true }))
}
export async function discussGeoElectricEndOfLifeDraft({ draft, workspaceDir, message }: { draft: GeoElectricEndOfLifeDraft; workspaceDir: string; message: string }) {
  const assistantMessage = `Use the editable Mission Studio fields to record the GEO/GSO state, fuel mass and tolerances. I received: ${message}`
  return save(workspaceDir, refresh({ ...draft, assistantMessage, confirmed: false, conversation: [...draft.conversation, { assistant: assistantMessage, user: message }] }))
}
export async function appendGeoElectricEndOfLifeDraftConversation(workspaceDir: string, draftId: string, turn: { assistant: string; user: string }) {
  const draft = await loadGeoElectricEndOfLifeDraft(workspaceDir, draftId)
  return save(workspaceDir, refresh({ ...draft, conversation: [...draft.conversation, turn] }))
}
function number(values: Record<string, Value>, field: string) { const value = values[field]; if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`GEO electric end-of-life scenario requires ${field}`); return value }
function replace(script: string, property: string, value: string) { const pattern = new RegExp(`^(${property.replace(/\./gu, "\\.")}\\s*=\\s*)[^;]+;`, "mu"); if (!pattern.test(script)) throw new Error(`GEO/GSO reference script does not expose ${property}`); return script.replace(pattern, `$1${value};`) }
function render(source: string, values: Record<string, Value>, ephemerisPath: string) {
  let script = source
  for (const [property, value] of [["GEO_ESC.Epoch", `'${values["initialOrbit.epoch"]}'`], ["GEO_ESC.SMA", String(number(values, "initialOrbit.smaKm"))], ["GEO_ESC.ECC", String(number(values, "initialOrbit.eccentricity"))], ["GEO_ESC.INC", String(number(values, "initialOrbit.inclinationDeg"))], ["GEO_ESC.RAAN", String(number(values, "initialOrbit.raanDeg"))], ["GEO_ESC.AOP", String(number(values, "initialOrbit.argPeriapsisDeg"))], ["GEO_ESC.TA", String(number(values, "initialOrbit.trueAnomalyDeg"))], ["GEO_ESC.DryMass", String(number(values, "spacecraft.dryMassKg"))], ["GEO_ESC.Cd", String(number(values, "spacecraft.dragCoefficient"))], ["GEO_ESC.DragArea", String(number(values, "spacecraft.dragAreaM2"))], ["ElectricPropellantTank_ESC.FuelMass", String(number(values, "spacecraft.initialFuelMassKg"))], ["EP_Prograde.Isp", String(number(values, "propulsion.ispSeconds"))], ["GEO_SolarArray_ESC.InitialMaxPower", String(number(values, "power.initialMaxPowerKw"))], ["MissionMode", String(number(values, "endOfLife.missionMode"))], ["EscapeC3", String(number(values, "endOfLife.escapeC3Km2PerSec2"))], ["MaxCemeteryDays", String(number(values, "endOfLife.maxCemeteryDays"))], ["MaxEscapeDays", String(number(values, "endOfLife.maxEscapeDays"))], ["EphemerisFile1.Filename", `'${toGmatNativePath(ephemerisPath).replace(/\\/gu, "/")}'`]] as const) script = replace(script, property, value)
  return script
}
export async function generateGeoElectricEndOfLifeMission({ draft, workspaceDir, execution }: { draft: GeoElectricEndOfLifeDraft; workspaceDir: string; execution?: { bin: string; timeoutMs: number } }) {
  if (!draft.confirmed || draft.missing.length) throw new Error("confirm the complete GEO electric end-of-life draft before execution")
  assertGmatMissionGuardrails("geo-electric-end-of-life", draft.values)
  if (!isMissionRunWorkspace(workspaceDir)) throw new Error("GEO/GSO generation requires a dated mission run workspace")
  const runDir = path.resolve(workspaceDir); const definition = gmatMissionScenarioDefinition("geo-electric-end-of-life")
  const scriptPath = path.join(runDir, "geo_electric_end_of_life.script"), valuesPath = path.join(runDir, "geo_electric_end_of_life.values.yaml"), resultPath = path.join(runDir, "gmat_result.json"), manifestPath = path.join(runDir, "run_manifest.json"), logPath = path.join(runDir, "gmat.log"), ephemerisPath = path.join(runDir, "EphemerisFile1.oem")
  await fs.writeFile(valuesPath, stringify({ draft_id: draft.draftId, template_id: draft.templateId, values: draft.values }))
  await fs.writeFile(scriptPath, render(await fs.readFile(path.join(definition.skillDirectory, definition.gmatReferenceScript), "utf8"), draft.values, ephemerisPath))
  let result: { error?: string; executionDurationMs?: number; status: "generated" | "completed" | "failed" | "timeout" } = { status: "generated" }
  if (execution) { await beginRunStage(runDir, "gmat", "GMAT GEO electric end-of-life station-keeping simulation is running."); const started = Date.now(); const process = await runManagedProcess({ args: ["--run", toGmatNativePath(scriptPath)], command: execution.bin, cwd: runDir, timeoutMs: execution.timeoutMs }); await fs.writeFile(logPath, process.output); const oem = await fs.stat(ephemerisPath).then(stat => stat.size > 0).catch(() => false); const status = process.timedOut ? "timeout" : process.exitCode === 0 && oem ? "completed" : "failed"; result = { executionDurationMs: Date.now() - started, status, ...(status === "completed" ? {} : { error: process.timedOut ? "GMAT timed out" : process.exitCode === 0 ? "GMAT completed but did not produce EphemerisFile1.oem" : `GMAT exited with code ${process.exitCode}` }) } }
  await Promise.all([fs.writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`), updateRunManifest(runDir, { templateId: draft.templateId, status: result.status, outputs: { ephemeris: result.status === "completed" ? path.basename(ephemerisPath) : null } })]); await invalidateDownstreamFromGmat(runDir)
  return { changes: [], result, runDir, runId: path.basename(runDir), scriptPath, valuesPath, resultPath, manifestPath }
}
export async function recordGeoElectricEndOfLifeDraftRun({ draft, execution, runPath, workspaceDir }: { draft: GeoElectricEndOfLifeDraft; execution: Awaited<ReturnType<typeof generateGeoElectricEndOfLifeMission>>; runPath: string; workspaceDir: string }) { return save(workspaceDir, refresh({ ...draft, runs: [...draft.runs, { completedAt: new Date().toISOString(), result: execution.result, runId: execution.runId, runPath }] })) }
