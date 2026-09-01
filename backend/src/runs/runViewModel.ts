/**
 * Role: Builds the single backend-owned view model shown for a selected mission run.
 * Exports: buildRunViewModel.
 * Dependencies: run workspace, artifact registry, workflow log and digital-thread schema.
 * Invariant: displayed run values always originate from this run's satellite.json.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { parse } from "yaml"

import { assertValidDigitalThreadDocument } from "../digitalThread/digitalThreadSchema.js"
import { loadRunWorkflowLog } from "../opalis/workflowRunLog.js"
import { artifactDefinitionForPath, RUN_ARTIFACTS } from "./artifactRegistry.js"
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
  if (templateId === "geo-gso-orbit-keeping") {
    values["initialOrbit.raanDeg"] = atPath(document, "satellite.orbit.keplerian_elements.raan_deg")
    values["initialOrbit.argPeriapsisDeg"] = atPath(document, "satellite.orbit.keplerian_elements.arg_of_perigee_deg")
    values["initialOrbit.trueAnomalyDeg"] = atPath(document, "satellite.orbit.keplerian_elements.true_anomaly_deg")
    values["spacecraft.initialFuelMassKg"] = atPath(document, "analysis_requests.gmat.geo_gso_orbit_keeping.initial_fuel_mass_kg")
    values["stationKeeping.northSouthToleranceDeg"] = atPath(document, "analysis_requests.gmat.geo_gso_orbit_keeping.north_south_tolerance_deg")
    values["stationKeeping.eastWestToleranceDeg"] = atPath(document, "analysis_requests.gmat.geo_gso_orbit_keeping.east_west_tolerance_deg")
    values["stationKeeping.eccentricityTolerance"] = atPath(document, "analysis_requests.gmat.geo_gso_orbit_keeping.eccentricity_tolerance")
    values["stationKeeping.daysOfOk"] = atPath(document, "analysis_requests.gmat.geo_gso_orbit_keeping.days_of_station_keeping")
  }
  if (templateId === "geo-gso-electric-station-keeping") {
    values["initialOrbit.raanDeg"] = atPath(document, "satellite.orbit.keplerian_elements.raan_deg")
    values["initialOrbit.argPeriapsisDeg"] = atPath(document, "satellite.orbit.keplerian_elements.arg_of_perigee_deg")
    values["initialOrbit.trueAnomalyDeg"] = atPath(document, "satellite.orbit.keplerian_elements.true_anomaly_deg")
    values["spacecraft.initialFuelMassKg"] = atPath(document, "analysis_requests.gmat.geo_electric_station_keeping.initial_fuel_mass_kg")
    values["stationKeeping.northSouthToleranceDeg"] = atPath(document, "analysis_requests.gmat.geo_electric_station_keeping.north_south_tolerance_deg")
    values["stationKeeping.eastWestToleranceDeg"] = atPath(document, "analysis_requests.gmat.geo_electric_station_keeping.east_west_tolerance_deg")
    values["stationKeeping.eastWestBurnDurationSec"] = atPath(document, "analysis_requests.gmat.geo_electric_station_keeping.east_west_burn_duration_sec")
    values["stationKeeping.northSouthBurnDurationSec"] = atPath(document, "analysis_requests.gmat.geo_electric_station_keeping.north_south_burn_duration_sec")
    values["stationKeeping.missionDurationDays"] = atPath(document, "analysis_requests.gmat.geo_electric_station_keeping.mission_duration_days")
  }  if (templateId === "chemical-hohmann-transfer") {
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

async function readPersistedMissionValues(runDir: string) {
  const entries = await fs.readdir(runDir, { withFileTypes: true }).catch(() => [])
  const valueFile = entries.filter(entry => entry.isFile() && /\.values\.yaml$/u.test(entry.name)).map(entry => entry.name).sort()[0]
  if (!valueFile) return {}
  const parsed = parse(await fs.readFile(path.join(runDir, valueFile), "utf8")) as { values?: unknown } | null
  const values = record(parsed?.values)
  if (!values) return {}
  return Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string" || typeof value === "number" || value === null)) as Record<string, string | number | null>
}
async function readRunDocument(runDir: string) {
  const canonical = path.join(runDir, "satellite.json")
  const raw = await fs.readFile(canonical, "utf8")
  const parsed: unknown = JSON.parse(raw)
  assertValidDigitalThreadDocument(parsed)
  return { document: parsed as JsonRecord, source: "satellite.json" as const }
}

export async function buildRunViewModel(run: MissionRunReference) {
  const [loadedDocument, manifestSource, workflow, persistedMissionValues] = await Promise.all([
    readRunDocument(run.runDir),
    loadRunManifest(run.runDir),
    loadRunWorkflowLog(run.runDir),
    readPersistedMissionValues(run.runDir),
  ])
  const { document, source } = loadedDocument
  const manifest = record(manifestSource)
  const templateId = typeof manifest?.templateId === "string" ? manifest.templateId : null
  const simuCic = record(record(document.analysis_requests)?.simu_cic) ?? { attitude_mode: "nadir_pointing", ground_station_ids: [], simultaneous_visibility_policy: null }
  const artifacts = (await Promise.all(RUN_ARTIFACTS.map(async artifact => {
    const stat = await fs.stat(path.join(run.runDir, artifact.relativePath)).catch(() => null)
    return stat?.isFile() ? { ...artifact, size: stat.size, updatedAt: stat.mtime.toISOString() } : null
  }))).filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== null)
  return {
    artifacts,
    document,
    missionValues: { ...missionValues(document, templateId), ...persistedMissionValues },
    runId: run.runId,
    runPath: run.runPath,
    satelliteAssumptions: satelliteAssumptions(document),
    simuCic,
    source,
    templateId,
    workflow,
  }
}
