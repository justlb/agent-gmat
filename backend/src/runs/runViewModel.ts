/**
 * Role: Builds the single backend-owned view model shown for a selected mission run.
 * Exports: buildRunViewModel.
 * Dependencies: run workspace, artifact registry, workflow log and digital-thread schema.
 * Invariant: displayed run values always originate from this run's satellite.json.
 */
import fs from "node:fs/promises"
import path from "node:path"

import { assertValidDigitalThreadDocument } from "../digitalThread/digitalThreadSchema.js"
import { loadRunWorkflowLog } from "../opalis/workflowRunLog.js"
import { loadOpalisResultSummary, opalisAssessment } from "../opalis/opalisResults.js"
import { loadSimuCicResultMetrics } from "../opalis/simuCicResults.js"
import { RUN_ARTIFACTS } from "./artifactRegistry.js"
import type { MissionRunReference } from "./runWorkspace.js"
import { loadRunManifest } from "./runManifest.js"

type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null }

function atPath(document: JsonRecord, fieldPath: string): string | number | null {
  let current: unknown = document
  for (const field of fieldPath.split(".")) {
    const next = record(current)
    if (!next) return null
    current = next[field]
  }
  return typeof current === "string" || typeof current === "number" ? current : null
}

function missionValues(document: JsonRecord, templateId: string | null) {
  const semiMajorAxis = atPath(document, "satellite.orbit.keplerian_elements.semi_major_axis_km")
  const initialAltitude = typeof semiMajorAxis === "number"
    ? Number((semiMajorAxis - 6378.1363).toFixed(6))
    : null
  const values: Record<string, string | number | null> = {
    "initialOrbit.epoch": atPath(document, "satellite.orbit.reference_epoch_tai_mod_julian"),
    "initialOrbit.smaKm": semiMajorAxis,
    // Altitude is derived from the run-local SMA rather than copied from a
    // draft, so the saved-run UI remains a projection of satellite.json.
    "initialOrbit.altitudeKm": initialAltitude,
    "initialOrbit.eccentricity": atPath(document, "satellite.orbit.keplerian_elements.eccentricity"),
    "initialOrbit.inclinationDeg": atPath(document, "satellite.orbit.keplerian_elements.inclination_deg"),
  }
  if (templateId === "electric-propulsion-transfer") values["transfer.finalAltitudeKm"] = atPath(document, "analysis_requests.gmat.electric_propulsion_transfer.target_final_altitude_km")
  if (templateId === "orbit-keeping") {
    values["spacecraft.initialFuelMassKg"] = atPath(document, "analysis_requests.gmat.orbit_keeping.initial_fuel_mass_kg")
    values["stationKeeping.minimumAltitudeKm"] = atPath(document, "analysis_requests.gmat.orbit_keeping.minimum_reboost_altitude_km")
  }
  if (templateId === "chemical-hohmann-transfer") {
    values["transfer.targetRadiusKm"] = atPath(document, "analysis_requests.gmat.chemical_hohmann_transfer.target_orbit.radius_km")
    values["transfer.targetEccentricity"] = atPath(document, "analysis_requests.gmat.chemical_hohmann_transfer.target_orbit.eccentricity")
    values["transfer.finalPropagationSeconds"] = atPath(document, "analysis_requests.gmat.chemical_hohmann_transfer.final_propagation_seconds")
  }
  if (templateId === "chemical-3d-transfer") {
    values["transfer.finalAltitudeKm"] = atPath(document, "analysis_requests.gmat.chemical_3d_transfer.final_altitude_km")
    values["transfer.finalInclinationDeg"] = atPath(document, "analysis_requests.gmat.chemical_3d_transfer.final_inclination_deg")
  }
  return values
}

function satelliteAssumptions(document: JsonRecord) {
  const fields: Array<[string, string, string?]> = [
    ["Dry mass", "satellite.bus.physical.mass_kg.dry", "kg"],
    ["Drag area", "satellite.bus.physical.drag_area_m2", "m²"],
    ["Drag coefficient", "satellite.bus.physical.drag_coefficient"],
    ["Specific impulse", "satellite.bus.propulsion_subsystem.specific_impulse_seconds", "s"],
    ["Solar-array area", "satellite.bus.electrical_subsystem.solar_panels.total_area_m2", "m²"],
    ["Solar-array rated power", "satellite.bus.electrical_subsystem.solar_panels.total_power_generated_watts", "W"],
  ]
  return fields.flatMap(([label, fieldPath, unit]) => {
    const value = atPath(document, fieldPath)
    return value === null ? [] : [{ label, value: `${value}${unit ? ` ${unit}` : ""}` }]
  })
}

async function readRunDocument(runDir: string) {
  const canonical = path.join(runDir, "satellite.json")
  const raw = await fs.readFile(canonical, "utf8")
  const parsed: unknown = JSON.parse(raw)
  assertValidDigitalThreadDocument(parsed)
  return { document: parsed as JsonRecord, source: "satellite.json" as const }
}

function metric(value: string, source: string) { return { source, value } }

async function missionOverview(runDir: string, document: JsonRecord, gmatCompleted: boolean, simuCicStatus: string) {
  const [opalis, gmatSource, electricSource, orbitSource, simuCicMetrics] = await Promise.all([
    loadOpalisResultSummary(runDir),
    fs.readFile(path.join(runDir, "gmat_result.json"), "utf8").then(value => JSON.parse(value) as JsonRecord).catch(() => ({} as JsonRecord)),
    fs.readFile(path.join(runDir, "electric_transfer_timeseries.json"), "utf8").then(value => JSON.parse(value) as unknown).catch(() => []),
    fs.readFile(path.join(runDir, "orbit_timeseries.json"), "utf8").then(value => JSON.parse(value) as unknown).catch(() => []),
    loadSimuCicResultMetrics(runDir, simuCicStatus),
  ])
  // Configuration values are inputs, not GMAT results.  In particular, the
  // requested propagation duration must never be shown as a computed lifetime
  // while GMAT is still running.
  const propagation = atPath(document, "analysis_requests.gmat.chemical_hohmann_transfer.final_propagation_seconds")
  const lifetimeDays = !gmatCompleted ? "Waiting for GMAT" : typeof propagation === "number" && propagation > 0 ? `${(propagation / 86400).toFixed(2)} days` : "Unavailable"
  const gmat = record(gmatSource) ?? {}
  const samples = [electricSource, orbitSource].flatMap(source => Array.isArray(source) ? source.filter(record) : [])
  // Electric-transfer samples store the semi-major axis, while orbit-keeping
  // samples store altitude directly.  Normalize both for the one overview.
  const altitudes = samples.map(sample => typeof sample?.altitudeKm === "number"
    ? sample.altitudeKm
    : typeof sample?.semiMajorAxisKm === "number" ? sample.semiMajorAxisKm - 6378.1363 : null,
  ).filter((value): value is number => value !== null && Number.isFinite(value))
  const fuelUsed = !gmatCompleted ? "Waiting for GMAT" : typeof gmat.fuelUsedBetweenReportsKg === "number" ? `${gmat.fuelUsedBetweenReportsKg.toFixed(3)} kg` : "Unavailable"
  const averageAltitude = !gmatCompleted ? "Waiting for GMAT" : altitudes.length ? `${(altitudes.reduce((sum, value) => sum + value, 0) / altitudes.length).toFixed(1)} km` : "Unavailable"
  return {
    lifetime: metric(lifetimeDays, "GMAT mission configuration"),
    fuelMassConsumed: metric(fuelUsed, "GMAT ElectricTransferReport"),
    averageAltitude: metric(averageAltitude, "GMAT ElectricTransferReport"),
    ...simuCicMetrics,
    electricalConfiguration: opalisAssessment(opalis),
  }
}

export async function buildRunViewModel(run: MissionRunReference) {
  const [loadedDocument, manifestSource, workflow] = await Promise.all([
    readRunDocument(run.runDir),
    loadRunManifest(run.runDir),
    loadRunWorkflowLog(run.runDir),
  ])
  const { document, source } = loadedDocument
  const manifest = record(manifestSource)
  const templateId = typeof manifest?.templateId === "string" ? manifest.templateId : null
  const simuCic = record(record(document.analysis_requests)?.simu_cic) ?? { attitude_mode: "nadir_pointing", ground_station_ids: [], simultaneous_visibility_policy: null }
  const overview = await missionOverview(run.runDir, document, workflow.stages.gmat.status === "completed", workflow.stages.simu_cic.status)
  const artifacts = (await Promise.all(RUN_ARTIFACTS.map(async artifact => {
    const stat = await fs.stat(path.join(run.runDir, artifact.relativePath)).catch(() => null)
    return stat?.isFile() ? { ...artifact, size: stat.size, updatedAt: stat.mtime.toISOString() } : null
  }))).filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== null)
  return {
    artifacts,
    document,
    missionValues: missionValues(document, templateId),
    overview,
    runId: run.runId,
    runPath: run.runPath,
    satelliteAssumptions: satelliteAssumptions(document),
    simuCic,
    source,
    templateId,
    workflow,
  }
}
