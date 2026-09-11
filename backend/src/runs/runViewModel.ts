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
import { loadSimuCicResultMetrics, loadSimuCicResultSummary } from "../opalis/simuCicResults.js"
import { adaptDigitalThreadToRFComlink } from "../rfComlink/rfComlinkDigitalThreadAdapter.js"
import { loadRFComlinkResultSummary, type RFComlinkLinkBudget } from "../rfComlink/rfComlinkResults.js"
import { artifactDefinitionForPath, RUN_ARTIFACTS } from "./artifactRegistry.js"
import type { MissionRunReference } from "./runWorkspace.js"
import { loadRunManifest } from "./runManifest.js"
import { estimateOemRevolutions } from "./runResults.js"

type JsonRecord = Record<string, unknown>
type OverviewMetric = { detail?: string; source: string; value: string }

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
    "spacecraft.dryMassKg": atPath(document, "satellite.bus.physical.mass_kg.dry"),
  }
  if (templateId === "electric-propulsion-transfer") values["transfer.finalAltitudeKm"] = atPath(document, "analysis_requests.gmat.electric_propulsion_transfer.target_final_altitude_km")
  if (templateId === "orbit-keeping" || templateId === "electrical-leo-orbit-maintenance") {
    const request = templateId === "orbit-keeping" ? "orbit_keeping" : "electrical_leo_orbit_maintenance"
    values["spacecraft.initialFuelMassKg"] = atPath(document, `analysis_requests.gmat.${request}.initial_fuel_mass_kg`)
    values["stationKeeping.minimumAltitudeKm"] = atPath(document, `analysis_requests.gmat.${request}.minimum_reboost_altitude_km`)
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

function finiteNumber(value: unknown): number | null { return typeof value === "number" && Number.isFinite(value) ? value : null }

/** Builds a stable three-link RF table even when RF-COMLINK saved an empty
 * report. Calculated values take precedence; configuration and run geometry
 * remain visible as auditable inputs until the external report is available. */
function rfLinkBudgets(document: JsonRecord, calculated: RFComlinkLinkBudget[]) {
  const rfInput = adaptDigitalThreadToRFComlink(document as Parameters<typeof adaptDigitalThreadToRFComlink>[0])
  const request = record(record(document.analysis_requests)?.rf_comlink)
  const geometry = record(request?.run_geometry)
  const temperatures = record(geometry?.system_temperature_k_by_link)
  return rfInput.links.map((link, index) => {
    const saved = calculated.find(result => result.link_name === link.name)
    if (saved) return saved
    const system = link.system
    return {
      achieved_ebn0_db: null,
      binary_rate_bps: finiteNumber(system.data_rate_bps),
      data_recovery_margin_db: null,
      elevation_deg: finiteNumber(geometry?.mean_elevation_deg),
      frequency_mhz: finiteNumber(system.frequency_mhz),
      link_name: link.name,
      link_type: link.direction,
      range_km: finiteNumber(geometry?.mean_range_km),
      received_cn0_dbhz: null,
      required_ebn0_db: finiteNumber(system.required_ebn0_db),
      source_report: `reports/${String(index).padStart(2, "0")}_${link.name}.html`,
      status: "unavailable" as const,
      system_temperature_k: finiteNumber(temperatures?.[link.id]),
    }
  })
}

const RF_OVERVIEW_KEY_BY_LINK_ID: Record<string, string> = {
  telecommand: "rfTelecommand",
  "housekeeping-telemetry": "rfHousekeepingTelemetry",
  "payload-telemetry": "rfPayloadTelemetry",
}

/** Formats a duration expressed in days: days for long missions, hours or
 * minutes for short maneuvers (a Hohmann transfer lasts ~1 hour). */
function formatDurationDays(days: number | null) {
  if (days === null || !Number.isFinite(days) || days < 0) return "Unavailable"
  if (days >= 1) return `${days.toFixed(2)} days`
  const hours = days * 24
  if (hours >= 1) return `${hours.toFixed(2)} h`
  return `${Math.round(hours * 60)} min`
}

/** Elapsed mission time in days for one normalized transfer sample. */
function sampleElapsedDays(sample: JsonRecord): number | null {
  if (typeof sample.elapsedDays === "number" && Number.isFinite(sample.elapsedDays)) return sample.elapsedDays
  return null
}

/** Total simulated span of a timeseries, in days (last sample minus first). */
function timeseriesDurationDays(rawSamples: unknown): number | null {
  if (!Array.isArray(rawSamples)) return null
  const samples = rawSamples.filter(record)
  if (!samples.length) return null
  const first = sampleElapsedDays(samples[0] as JsonRecord)
  const last = sampleElapsedDays(samples.at(-1) as JsonRecord)
  return first !== null && last !== null && last >= first ? last - first : null
}

/** The GMAT OrbitAnalysisReport begins with DefaultSC.ElapsedSecs. Releases
 * produced before this correction persisted that value under the misleading
 * `epochA1ModJulian` key, so both spellings are supported for saved runs. */
function orbitKeepingDurationDays(rawSamples: unknown): number | null {
  if (!Array.isArray(rawSamples)) return null
  const final = rawSamples.filter(record).at(-1)
  const seconds = finiteSampleValue(final, "elapsedSeconds") ?? finiteSampleValue(final, "epochA1ModJulian")
  return seconds === null || seconds < 0 ? null : seconds / 86_400
}

/** Hohmann maneuver time: elapsed time at the GOI burn, i.e. the last impulsive
 * fuel drop. Samples after that belong to the one-day post-transfer sampling
 * window and must not be counted as maneuver time. */
function hohmannManeuverDays(rawSamples: unknown): number | null {
  if (!Array.isArray(rawSamples)) return null
  const samples = rawSamples.filter(record)
  for (let index = samples.length - 1; index > 0; index -= 1) {
    const before = samples[index - 1]?.fuelMassKg
    const after = samples[index]?.fuelMassKg
    if (typeof before === "number" && typeof after === "number" && before - after > 1e-3) {
      const elapsed = sampleElapsedDays(samples[index])
      return elapsed !== null ? elapsed : null
    }
  }
  return null
}

const DURATION_TEMPLATES = new Set(["orbit-keeping", "electrical-leo-orbit-maintenance", "electric-propulsion-transfer", "chemical-hohmann-transfer", "chemical-3d-transfer"])

function finiteSampleValue(sample: JsonRecord | undefined, key: string) {
  const value = sample?.[key]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

/** Explains the GMAT stop predicate alongside the measured final state. This
 * description is evidence, not an inferred claim that one threshold alone
 * caused termination. */
function orbitKeepingTerminationDetail(samples: JsonRecord[]) {
  const final = samples.at(-1)
  const duration = orbitKeepingDurationDays(samples)
  const altitude = finiteSampleValue(final, "altitudeKm")
  const fuel = finiteSampleValue(final, "fuelMassKg")
  const finalState = [
    duration === null ? null : `final elapsed time ${duration.toFixed(3)} days`,
    altitude === null ? null : `final altitude ${altitude.toFixed(3)} km`,
    fuel === null ? null : `final fuel mass ${fuel.toFixed(3)} kg`,
  ].filter((value): value is string => value !== null).join("; ")
  return `GMAT ends when its orbit-keeping loop can no longer satisfy the fuel, minimum-altitude, and configured-duration predicates.${finalState ? ` Recorded final state: ${finalState}.` : ""}`
}

async function missionOverview(runDir: string, document: JsonRecord, gmatCompleted: boolean, simuCicStatus: string, templateId: string | null) {
  const [opalis, gmatSource, electricSource, orbitSource, hohmannSource, simuCicMetrics, simuCicSummary, oemSource, rfComlink] = await Promise.all([
    loadOpalisResultSummary(runDir),
    fs.readFile(path.join(runDir, "gmat_result.json"), "utf8").then(value => JSON.parse(value) as JsonRecord).catch(() => ({} as JsonRecord)),
    fs.readFile(path.join(runDir, "electric_transfer_timeseries.json"), "utf8").then(value => JSON.parse(value) as unknown).catch(() => []),
    fs.readFile(path.join(runDir, "orbit_timeseries.json"), "utf8").then(value => JSON.parse(value) as unknown).catch(() => []),
    fs.readFile(path.join(runDir, "chemical_hohmann_timeseries.json"), "utf8").then(value => JSON.parse(value) as unknown).catch(() => []),
    loadSimuCicResultMetrics(runDir, simuCicStatus),
    loadSimuCicResultSummary(runDir),
    fs.readFile(path.join(runDir, "EphemerisFile1.oem"), "utf8").catch(() => ""),
    loadRFComlinkResultSummary(runDir),
  ])
  const gmat = record(gmatSource) ?? {}
  // Select the declared scenario's series. A run must never combine artifacts
  // left behind by another template when calculating overview metrics.
  const samples = templateId === "orbit-keeping"
    ? Array.isArray(orbitSource) ? orbitSource.filter(record) : []
    : templateId === "chemical-hohmann-transfer" || templateId === "chemical-3d-transfer"
      ? Array.isArray(hohmannSource) ? hohmannSource.filter(record) : []
      : Array.isArray(electricSource) ? electricSource.filter(record) : []
  const hohmannSamples = templateId === "chemical-hohmann-transfer" || templateId === "chemical-3d-transfer"
    ? samples
    : []
  // Electric-transfer samples store the semi-major axis, while orbit-keeping
  // and Hohmann samples store altitude directly.  Normalize both for the one overview.
  const altitudes = samples.map(sample => typeof sample?.altitudeKm === "number"
    ? sample.altitudeKm
    : typeof sample?.semiMajorAxisKm === "number" ? sample.semiMajorAxisKm - 6378.1363 : null,
  ).filter((value): value is number => value !== null && Number.isFinite(value))
  const firstFuelMass = hohmannSamples[0]?.fuelMassKg
  const finalFuelMass = hohmannSamples.at(-1)?.fuelMassKg
  const orbitInitialFuelMass = atPath(document, "analysis_requests.gmat.orbit_keeping.initial_fuel_mass_kg")
  const orbitFinalFuelMass = finiteSampleValue(samples.at(-1), "fuelMassKg")
  // ReboostReport starts at the first reboost, not at mission start. For
  // orbit keeping, consumption must therefore use the saved input fuel mass.
  const fuelUsedKg = templateId === "orbit-keeping" && typeof orbitInitialFuelMass === "number" && orbitFinalFuelMass !== null
    ? orbitInitialFuelMass - orbitFinalFuelMass
    : typeof gmat.fuelUsedBetweenReportsKg === "number" && Number.isFinite(gmat.fuelUsedBetweenReportsKg)
    ? gmat.fuelUsedBetweenReportsKg
    : typeof firstFuelMass === "number" && typeof finalFuelMass === "number" && Number.isFinite(firstFuelMass) && Number.isFinite(finalFuelMass)
      ? firstFuelMass - finalFuelMass
      : null
  const fuelUsed = !gmatCompleted ? "Waiting for GMAT" : typeof fuelUsedKg === "number" && Number.isFinite(fuelUsedKg) ? `${fuelUsedKg.toFixed(3)} kg` : "Unavailable"
  const averageAltitude = !gmatCompleted ? "Waiting for GMAT" : altitudes.length ? `${(altitudes.reduce((sum, value) => sum + value, 0) / altitudes.length).toFixed(1)} km` : "Unavailable"

  // Durations come from the GMAT time series, never from configuration:
  //  - maintenance scenarios run until fuel reserve or the day limit, so the
  //    last sample is the achieved mission lifetime;
  //  - transfer scenarios end at the target (electric spiral) or at the GOI
  //    burn (Hohmann), which is the maneuver duration.
  const waiting = gmatCompleted ? "Unavailable" : "Waiting for GMAT"
  const lifetimeDays = !gmatCompleted ? null
    : templateId === "orbit-keeping" ? orbitKeepingDurationDays(orbitSource)
    : templateId === "electrical-leo-orbit-maintenance" ? timeseriesDurationDays(electricSource)
    : null
  const maneuverDays = !gmatCompleted ? null
    : templateId === "electric-propulsion-transfer" ? timeseriesDurationDays(electricSource)
    : (templateId === "chemical-hohmann-transfer" || templateId === "chemical-3d-transfer") ? hohmannManeuverDays(hohmannSource)
    : null
  const durationDays = templateId === "orbit-keeping" || templateId === "electrical-leo-orbit-maintenance"
    ? lifetimeDays
    : maneuverDays
  const durationDetail = templateId === "chemical-hohmann-transfer"
    ? "Duration ends at the last propellant decrease in ReportFile1, which marks the solved GOI burn. The later post-transfer propagation samples are excluded."
    : templateId === "orbit-keeping"
      ? orbitKeepingTerminationDetail(Array.isArray(orbitSource) ? orbitSource.filter(record) : [])
      : templateId === "electric-propulsion-transfer"
        ? "Duration is the span of the saved GMAT electric-transfer time series and ends when the transfer propagation stops."
        : templateId === "electrical-leo-orbit-maintenance"
          ? "Duration is the span of the saved GMAT maintenance time series and ends when its GMAT propagation stops."
          : "GMAT duration is unavailable for this mission template."
  const terminationCondition = templateId === "chemical-hohmann-transfer"
    ? "Target orbit solved; duration measured at the GOI burn."
    : templateId === "orbit-keeping"
      ? "The orbit-keeping loop stops when fuel, minimum-altitude, or duration-limit predicates are no longer satisfied."
      : templateId === "electric-propulsion-transfer"
        ? "GMAT transfer propagation reached its configured terminal event."
        : templateId === "electrical-leo-orbit-maintenance"
          ? "GMAT maintenance propagation reached its configured terminal event."
          : "Unavailable"
  const overview: Record<string, OverviewMetric> = {
    fuelMassConsumed: {
      ...metric(fuelUsed, "GMAT report"),
      ...(templateId === "orbit-keeping" && typeof orbitInitialFuelMass === "number" && orbitFinalFuelMass !== null
        ? { detail: `Initial fuel from satellite.json (${orbitInitialFuelMass.toFixed(3)} kg) minus final fuel from OrbitAnalysisReport.txt (${orbitFinalFuelMass.toFixed(3)} kg).` }
        : {}),
    },
    averageAltitude: {
      ...metric(averageAltitude, "GMAT report"),
      ...(altitudes.length ? { detail: `Arithmetic mean of ${altitudes.length} saved GMAT report sample${altitudes.length === 1 ? "" : "s"}; it is not a continuous orbit average.` } : {}),
    },
    ...simuCicMetrics,
    electricalConfiguration: opalisAssessment(opalis),
  }
  if (rfComlink) {
    for (const link of adaptDigitalThreadToRFComlink(document as Parameters<typeof adaptDigitalThreadToRFComlink>[0]).links) {
      const key = RF_OVERVIEW_KEY_BY_LINK_ID[link.id]
      if (!key) continue
      const budget = rfComlink.link_budgets.find(item => item.link_name === link.name)
      overview[key] = {
        ...metric(budget ? budget.status.toUpperCase() : "Unavailable", "RF-COMLINK link budget"),
        detail: budget
          ? "PASS requires a non-negative worst-case RSS data-recovery margin. Open Results for the complete nominal, 3σ, and worst-case values."
          : "RF-COMLINK saved no populated link-budget table for this link.",
      }
    }
  }
  const revolutions = estimateOemRevolutions(oemSource)
  const calculation = simuCicSummary?.calculation
  if (simuCicStatus === "completed" && revolutions !== null && revolutions > 0 && calculation) {
    const eclipseSeconds = calculation.eclipse.duration_seconds
    if (typeof eclipseSeconds === "number" && Number.isFinite(eclipseSeconds)) {
      overview.eclipseTimePerRevolution = {
        ...metric(`${(eclipseSeconds / revolutions / 60).toFixed(2)} min/rev`, "Simu-CIC eclipse file + GMAT OEM"),
        detail: `${(eclipseSeconds / 60).toFixed(2)} min across an estimated ${revolutions.toFixed(2)} GMAT revolutions.`,
      }
    }
    const contactParts = calculation.stations.flatMap(station => typeof station.contact_duration_seconds === "number" && Number.isFinite(station.contact_duration_seconds)
      ? [`${station.station_id}: ${(station.contact_duration_seconds / revolutions / 60).toFixed(2)} min/rev`]
      : [])
    if (contactParts.length) {
      overview.contactTimePerRevolution = {
        ...metric(contactParts.join("; "), "Simu-CIC visibility files + GMAT OEM"),
        detail: `Each station total is divided by an estimated ${revolutions.toFixed(2)} GMAT revolutions.`,
      }
    }
  }
  if (DURATION_TEMPLATES.has(templateId ?? "")) {
    overview.simulatedMissionDuration = {
      ...metric(gmatCompleted ? formatDurationDays(durationDays) : waiting, "GMAT time series"),
      detail: durationDetail,
    }
    overview.terminationCondition = {
      ...metric(gmatCompleted ? terminationCondition : waiting, "GMAT mission sequence"),
      detail: "The displayed duration and this condition are derived from the same saved GMAT report; download the report from Generated files to verify the samples.",
    }
  }
  return overview
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
  const [overview, rfComlink] = await Promise.all([
    missionOverview(run.runDir, document, workflow.stages.gmat.status === "completed", workflow.stages.simu_cic.status, templateId),
    loadRFComlinkResultSummary(run.runDir),
  ])
  const fixedArtifacts = (await Promise.all(RUN_ARTIFACTS.map(async artifact => {
    const stat = await fs.stat(path.join(run.runDir, artifact.relativePath)).catch(() => null)
    return stat?.isFile() ? { ...artifact, size: stat.size, updatedAt: stat.mtime.toISOString() } : null
  }))).filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== null)
  // Simu-CIC assigns its executed .scd scenario a generated filename. Expose
  // that concrete scenario rather than the preparatory input file.
  const executionDirectory = path.join(run.runDir, "opalis", "02-simu-cic", "01-execution-complete")
  const executedScenarios = (await Promise.all((await fs.readdir(executionDirectory, { withFileTypes: true }).catch(() => []))
    .filter(entry => entry.isFile() && entry.name.endsWith(".scd"))
    .map(async entry => {
      const relativePath = `opalis/02-simu-cic/01-execution-complete/${entry.name}`
      const artifact = artifactDefinitionForPath(relativePath)
      if (!artifact) return null
      const stat = await fs.stat(path.join(executionDirectory, entry.name))
      return { ...artifact, size: stat.size, updatedAt: stat.mtime.toISOString() }
    }))).filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== null)
  const artifacts = [...fixedArtifacts, ...executedScenarios]
  return {
    artifacts,
    document,
    missionValues: missionValues(document, templateId),
    overview,
    rfComlink: { linkBudgets: rfComlink ? rfLinkBudgets(document, rfComlink.link_budgets) : [] },
    runId: run.runId,
    runPath: run.runPath,
    satelliteAssumptions: satelliteAssumptions(document),
    simuCic,
    source,
    templateId,
    workflow,
  }
}
