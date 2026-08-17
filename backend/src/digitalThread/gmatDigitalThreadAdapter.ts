import type { DigitalThreadDocument, JsonValue } from "./digitalThreadStore.js"
import { getAtPath, loadOrCreateDigitalThread, saveDigitalThread, setAtPath } from "./digitalThreadStore.js"
import { gmatTemplateDefinition, type GmatTemplateId } from "../gmat/templateRegistry.js"

export type GmatDigitalThreadTemplate = GmatTemplateId
export type DigitalThreadGuard = { code: string; message: string; path: string }
export type DigitalThreadDerivation = { formula: string; inputs: string[]; output: string; value: number | string }

function analysisTemplateKey(template: string) {
  // Orbit Keeping keeps its engineering-contract identifier in persisted
  // drafts; the registry identifier remains the shorter route/template name.
  if (template === "orbit-keeping-earth-keplerian") return "orbit_keeping"
  return gmatTemplateDefinition(template as GmatTemplateId).analysisRequestKey
}

const JULIAN_DATE_AT_UNIX_EPOCH = 2440587.5
const GMAT_MODIFIED_JULIAN_OFFSET = 2430000
const TAI_UTC_LEAP_SECONDS: ReadonlyArray<readonly [string, number]> = [
  ["1972-01-01T00:00:00Z", 10], ["1972-07-01T00:00:00Z", 11], ["1973-01-01T00:00:00Z", 12], ["1974-01-01T00:00:00Z", 13], ["1975-01-01T00:00:00Z", 14], ["1976-01-01T00:00:00Z", 15], ["1977-01-01T00:00:00Z", 16], ["1978-01-01T00:00:00Z", 17], ["1979-01-01T00:00:00Z", 18], ["1980-01-01T00:00:00Z", 19], ["1981-07-01T00:00:00Z", 20], ["1982-07-01T00:00:00Z", 21], ["1983-07-01T00:00:00Z", 22], ["1985-07-01T00:00:00Z", 23], ["1988-01-01T00:00:00Z", 24], ["1990-01-01T00:00:00Z", 25], ["1991-01-01T00:00:00Z", 26], ["1992-07-01T00:00:00Z", 27], ["1993-07-01T00:00:00Z", 28], ["1994-07-01T00:00:00Z", 29], ["1996-01-01T00:00:00Z", 30], ["1997-07-01T00:00:00Z", 31], ["1999-01-01T00:00:00Z", 32], ["2006-01-01T00:00:00Z", 33], ["2009-01-01T00:00:00Z", 34], ["2012-07-01T00:00:00Z", 35], ["2015-07-01T00:00:00Z", 36], ["2017-01-01T00:00:00Z", 37],
]

function taiModJulianToUtcIso(value: string) {
  const taiModJulian = Number(value)
  if (!Number.isFinite(taiModJulian)) return null
  const taiMilliseconds = (taiModJulian + GMAT_MODIFIED_JULIAN_OFFSET - JULIAN_DATE_AT_UNIX_EPOCH) * 86_400_000
  let utcMilliseconds = taiMilliseconds - 37_000
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const taiMinusUtcSeconds = TAI_UTC_LEAP_SECONDS.reduce((offset, [effectiveAt, candidate]) => utcMilliseconds >= Date.parse(effectiveAt) ? candidate : offset, 0)
    utcMilliseconds = taiMilliseconds - taiMinusUtcSeconds * 1000
  }
  const date = new Date(utcMilliseconds)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function numberAt(document: DigitalThreadDocument, fieldPath: string) {
  const value = getAtPath(document, fieldPath)
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function stringAt(document: DigitalThreadDocument, fieldPath: string) {
  const value = getAtPath(document, fieldPath)
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function firstNumber(document: DigitalThreadDocument, ...fieldPaths: string[]) {
  for (const fieldPath of fieldPaths) {
    const value = numberAt(document, fieldPath)
    if (value !== null) return value
  }
  return null
}

function firstString(document: DigitalThreadDocument, ...fieldPaths: string[]) {
  for (const fieldPath of fieldPaths) {
    const value = stringAt(document, fieldPath)
    if (value !== null) return value
  }
  return null
}

function taiEpochAt(document: DigitalThreadDocument, ...fieldPaths: string[]) {
  for (const fieldPath of fieldPaths) {
    const value = getAtPath(document, fieldPath)
    if ((typeof value === "string" || typeof value === "number") && Number.isFinite(Number(value)) && String(value).trim()) return String(value).trim()
  }
  return null
}

function utcToTaiModJulian(value: string) {
  const milliseconds = Date.parse(value)
  if (!Number.isFinite(milliseconds)) throw new Error("satellite.orbit.reference_epoch_utc must be a valid ISO-8601 time")
  const taiMinusUtcSeconds = TAI_UTC_LEAP_SECONDS.reduce((offset, [effectiveAt, candidate]) => milliseconds >= Date.parse(effectiveAt) ? candidate : offset, 0)
  return Number((milliseconds / 86_400_000 + JULIAN_DATE_AT_UNIX_EPOCH + taiMinusUtcSeconds / 86_400 - GMAT_MODIFIED_JULIAN_OFFSET).toFixed(12)).toString()
}

function meanToTrueAnomalyDeg(meanAnomalyDeg: number, eccentricity: number) {
  const mean = ((meanAnomalyDeg % 360) + 360) % 360 * Math.PI / 180
  let eccentricAnomaly = eccentricity < 0.8 ? mean : Math.PI
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const correction = (eccentricAnomaly - eccentricity * Math.sin(eccentricAnomaly) - mean) / (1 - eccentricity * Math.cos(eccentricAnomaly))
    eccentricAnomaly -= correction
    if (Math.abs(correction) < 1e-12) break
  }
  const trueAnomaly = 2 * Math.atan2(Math.sqrt(1 + eccentricity) * Math.sin(eccentricAnomaly / 2), Math.sqrt(1 - eccentricity) * Math.cos(eccentricAnomaly / 2))
  return Number(((((trueAnomaly * 180 / Math.PI) % 360) + 360) % 360).toFixed(12))
}

function requireNumber(document: DigitalThreadDocument, sourcePath: string, targetPath: string, values: Record<string, string | number | null>, guards: DigitalThreadGuard[]) {
  const value = numberAt(document, sourcePath)
  if (value === null) guards.push({ code: "missing_digital_thread_value", message: `Required digital-thread value is missing: ${sourcePath}`, path: sourcePath })
  else values[targetPath] = value
}

function optionalNumber(document: DigitalThreadDocument, sourcePath: string, targetPath: string, values: Record<string, string | number | null>) {
  const value = numberAt(document, sourcePath)
  if (value !== null) values[targetPath] = value
}

function initialSolarPowerKw(document: DigitalThreadDocument, guards: DigitalThreadGuard[], derivations: DigitalThreadDerivation[]) {
  const ratedWattsPath = "satellite.bus.electrical_subsystem.solar_panels.total_power_generated_watts"
  const ratedWatts = numberAt(document, ratedWattsPath)
  if (ratedWatts !== null) {
    const value = ratedWatts / 1000
    derivations.push({ formula: "rated solar-array power / 1000", inputs: [ratedWattsPath], output: "power.initialMaxPowerKw", value })
    return value
  }
  const areaPath = "satellite.bus.electrical_subsystem.solar_panels.total_area_m2"
  const efficiencyPath = "satellite.bus.electrical_subsystem.solar_panels.efficiency_percent"
  const area = numberAt(document, areaPath)
  const efficiency = numberAt(document, efficiencyPath)
  if (area === null || efficiency === null) {
    guards.push({ code: "missing_solar_power_model", message: "GMAT electric propulsion needs rated solar power, or both solar-array area and efficiency.", path: ratedWattsPath })
    return null
  }
  const value = 1361 * area * (efficiency / 100) / 1000
  derivations.push({ formula: "1361 W/m² × array area × efficiency / 1000", inputs: [areaPath, efficiencyPath], output: "power.initialMaxPowerKw", value })
  return value
}

export function adaptDigitalThreadToGmat(document: DigitalThreadDocument, template: GmatDigitalThreadTemplate) {
  const values: Record<string, string | number | null> = {}
  const guards: DigitalThreadGuard[] = []
  const derivations: DigitalThreadDerivation[] = []
  const missionRoot = `analysis_requests.gmat.${analysisTemplateKey(template)}`
  const missionOrbitRoot = `${missionRoot}.initial_orbit`
  const taiEpoch = taiEpochAt(document, `${missionOrbitRoot}.epoch_tai_mod_julian`, "satellite.orbit.reference_epoch_tai_mod_julian")
  const utcEpoch = stringAt(document, "satellite.orbit.reference_epoch_utc")
  if (taiEpoch) values["initialOrbit.epoch"] = taiEpoch
  else if (utcEpoch) {
    values["initialOrbit.epoch"] = utcToTaiModJulian(utcEpoch)
    derivations.push({ formula: "UTC → GMAT TAIModJulian using the deterministic leap-second table", inputs: ["satellite.orbit.reference_epoch_utc"], output: "initialOrbit.epoch", value: values["initialOrbit.epoch"] as string })
  } else guards.push({ code: "missing_epoch", message: "A GMAT run requires satellite.orbit.reference_epoch_utc or reference_epoch_tai_mod_julian.", path: "satellite.orbit.reference_epoch_utc" })

  const orbitFields: Array<[string, string, boolean]> = [
    ["semi_major_axis_km", "initialOrbit.smaKm", true], ["eccentricity", "initialOrbit.eccentricity", true], ["inclination_deg", "initialOrbit.inclinationDeg", true],
    ["raan_deg", "initialOrbit.raanDeg", false], ["arg_of_perigee_deg", "initialOrbit.argPeriapsisDeg", false], ["true_anomaly_deg", "initialOrbit.trueAnomalyDeg", false],
  ]
  for (const [sourceField, targetPath, required] of orbitFields) {
    const value = firstNumber(document, `${missionOrbitRoot}.${sourceField}`, `satellite.orbit.keplerian_elements.${sourceField}`)
    if (value === null && required) guards.push({ code: "missing_digital_thread_value", message: `Required digital-thread value is missing: ${missionOrbitRoot}.${sourceField} or satellite.orbit.keplerian_elements.${sourceField}`, path: targetPath })
    else if (value !== null) values[targetPath] = value
  }
  if (values["initialOrbit.trueAnomalyDeg"] === undefined) {
    const meanAnomaly = firstNumber(document, `${missionOrbitRoot}.mean_anomaly_deg`, "satellite.orbit.keplerian_elements.mean_anomaly_deg")
    const eccentricity = firstNumber(document, `${missionOrbitRoot}.eccentricity`, "satellite.orbit.keplerian_elements.eccentricity")
    if (meanAnomaly !== null && eccentricity !== null && eccentricity >= 0 && eccentricity < 1) {
      values["initialOrbit.trueAnomalyDeg"] = meanToTrueAnomalyDeg(meanAnomaly, eccentricity)
      derivations.push({ formula: "solve Kepler's equation M = E - e·sin(E), then convert eccentric anomaly to true anomaly", inputs: ["satellite.orbit.keplerian_elements.mean_anomaly_deg", "satellite.orbit.keplerian_elements.eccentricity"], output: "initialOrbit.trueAnomalyDeg", value: values["initialOrbit.trueAnomalyDeg"] as number })
    }
  }
  requireNumber(document, "satellite.bus.physical.mass_kg.dry", "spacecraft.dryMassKg", values, guards)
  const propulsionType = stringAt(document, "satellite.bus.propulsion_subsystem.type")?.toLowerCase() ?? ""

  if (template === "orbit-keeping" || template === "chemical-hohmann-transfer" || template === "chemical-3d-transfer") {
    if (!propulsionType || !/(chemical|bipropellant|monopropellant)/u.test(propulsionType)) guards.push({ code: "incompatible_propulsion", message: `The ${template === "chemical-hohmann-transfer" ? "chemical Hohmann-transfer" : template === "chemical-3d-transfer" ? "chemical 3D GEO-transfer" : "orbit-keeping"} template requires an explicitly identified chemical propulsion subsystem.`, path: "satellite.bus.propulsion_subsystem.type" })
    if (template === "orbit-keeping") {
      requireNumber(document, "analysis_requests.gmat.orbit_keeping.minimum_reboost_altitude_km", "stationKeeping.minimumAltitudeKm", values, guards)
      optionalNumber(document, "analysis_requests.gmat.orbit_keeping.target_semi_major_axis_km", "stationKeeping.targetSmaKm", values)
      optionalNumber(document, "analysis_requests.gmat.orbit_keeping.fuel_reserve_kg", "stationKeeping.fuelReserveKg", values)
      optionalNumber(document, "analysis_requests.gmat.orbit_keeping.final_altitude_km", "endOfLife.finalAltitudeKm", values)
      const initialFuelMass = firstNumber(document, "analysis_requests.gmat.orbit_keeping.initial_fuel_mass_kg", "satellite.bus.physical.mass_kg.propellant")
      if (initialFuelMass !== null) values["spacecraft.initialFuelMassKg"] = initialFuelMass
    } else if (template === "chemical-hohmann-transfer") {
      requireNumber(document, "analysis_requests.gmat.chemical_hohmann_transfer.target_orbit.radius_km", "transfer.targetRadiusKm", values, guards)
      optionalNumber(document, "analysis_requests.gmat.chemical_hohmann_transfer.target_orbit.eccentricity", "transfer.targetEccentricity", values)
      optionalNumber(document, "analysis_requests.gmat.chemical_hohmann_transfer.final_propagation_seconds", "transfer.finalPropagationSeconds", values)
    } else {
      const initialSma = values["initialOrbit.smaKm"]
      if (typeof initialSma === "number") values["initialOrbit.altitudeKm"] = initialSma - 6378.1363
      optionalNumber(document, "analysis_requests.gmat.chemical_3d_transfer.final_altitude_km", "transfer.finalAltitudeKm", values)
      optionalNumber(document, "analysis_requests.gmat.chemical_3d_transfer.final_inclination_deg", "transfer.finalInclinationDeg", values)
    }
    optionalNumber(document, "satellite.bus.physical.drag_area_m2", "spacecraft.dragAreaM2", values)
    optionalNumber(document, "satellite.bus.physical.drag_coefficient", "spacecraft.dragCoefficient", values)
    optionalNumber(document, "satellite.bus.propulsion_subsystem.specific_impulse_seconds", "propulsion.ispSeconds", values)
  } else {
    requireNumber(document, "satellite.bus.propulsion_subsystem.electric_thruster.propellant_mass_kg", "spacecraft.initialFuelMassKg", values, guards)
    if (!propulsionType || !/(electric|hall|ion)/u.test(propulsionType)) guards.push({ code: "incompatible_propulsion", message: "The electric-transfer template requires an explicitly identified electric propulsion subsystem.", path: "satellite.bus.propulsion_subsystem.type" })
    requireNumber(document, "analysis_requests.gmat.electric_propulsion_transfer.burn_duration_days", "transfer.burnDurationDays", values, guards)
    requireNumber(document, "satellite.bus.propulsion_subsystem.electric_thruster.minimum_usable_power_kw", "propulsion.minimumUsablePowerKw", values, guards)
    requireNumber(document, "satellite.bus.propulsion_subsystem.electric_thruster.maximum_usable_power_kw", "propulsion.maximumUsablePowerKw", values, guards)
    // The satellite may declare a reduced payload load during orbit raising.
    // It is an operational allocation, not a replacement for the nominal bus
    // load used by the other tools and mission phases.
    const orbitRaisingBusLoadPath = "satellite.bus.electrical_subsystem.electric_propulsion_mode.bus_load_kw"
    const orbitRaisingBusLoad = numberAt(document, orbitRaisingBusLoadPath)
    if (orbitRaisingBusLoad !== null) {
      values["power.busLoadKw"] = orbitRaisingBusLoad
      derivations.push({ formula: "electric-propulsion mission-mode bus allocation", inputs: [orbitRaisingBusLoadPath], output: "power.busLoadKw", value: orbitRaisingBusLoad })
    } else requireNumber(document, "satellite.bus.electrical_subsystem.spacecraft_bus_load_kw", "power.busLoadKw", values, guards)
    requireNumber(document, "satellite.bus.electrical_subsystem.system_margin_percent", "power.systemMarginPercent", values, guards)
    const solarPower = initialSolarPowerKw(document, guards, derivations)
    if (solarPower !== null) values["power.initialMaxPowerKw"] = solarPower
  }
  const requiredDraftPaths = template === "orbit-keeping"
    ? ["spacecraft.dryMassKg"]
    : template === "chemical-hohmann-transfer"
      ? ["initialOrbit.epoch", "initialOrbit.smaKm", "initialOrbit.eccentricity", "initialOrbit.inclinationDeg", "transfer.targetRadiusKm"]
      : template === "chemical-3d-transfer"
        ? ["initialOrbit.epoch", "initialOrbit.altitudeKm", "initialOrbit.eccentricity", "initialOrbit.inclinationDeg", "transfer.finalAltitudeKm", "transfer.finalInclinationDeg"]
      : ["initialOrbit.epoch", "initialOrbit.smaKm", "initialOrbit.eccentricity", "initialOrbit.inclinationDeg", "transfer.burnDurationDays"]
  for (const fieldPath of requiredDraftPaths) {
    if ((values[fieldPath] === null || values[fieldPath] === undefined || values[fieldPath] === "") && !guards.some(guard => guard.path === fieldPath)) {
      guards.push({ code: "missing_adapter_input", message: `The GMAT adapter cannot produce required value ${fieldPath} from the digital thread.`, path: fieldPath })
    }
  }
  return { derivations, guards, ready: guards.length === 0, requiredDraftPaths, template, values }
}

const MISSION_ORBIT_PATHS: Record<string, string> = {
  "initialOrbit.epoch": "epoch_tai_mod_julian",
  "initialOrbit.smaKm": "semi_major_axis_km",
  "initialOrbit.eccentricity": "eccentricity",
  "initialOrbit.inclinationDeg": "inclination_deg",
  "initialOrbit.raanDeg": "raan_deg",
  "initialOrbit.argPeriapsisDeg": "arg_of_perigee_deg",
  "initialOrbit.trueAnomalyDeg": "true_anomaly_deg",
}

function missionDraftPaths(templateId: string) {
  const root = `analysis_requests.gmat.${analysisTemplateKey(templateId)}`
  return {
    ...Object.fromEntries(Object.entries(MISSION_ORBIT_PATHS).map(([draftPath, threadPath]) => [draftPath, `${root}.initial_orbit.${threadPath}`])),
    ...(templateId === "chemical-hohmann-transfer"
      ? {
          "transfer.targetRadiusKm": `${root}.target_orbit.radius_km`,
          "transfer.targetEccentricity": `${root}.target_orbit.eccentricity`,
          "transfer.finalPropagationSeconds": `${root}.final_propagation_seconds`,
        }
      : templateId === "chemical-3d-transfer"
      ? { "initialOrbit.altitudeKm": `${root}.initial_orbit.altitude_km`, "transfer.finalAltitudeKm": `${root}.final_altitude_km`, "transfer.finalInclinationDeg": `${root}.final_inclination_deg` }
      : templateId === "electric-propulsion-transfer"
      ? { "transfer.burnDurationDays": `${root}.burn_duration_days` }
      : {
          "stationKeeping.minimumAltitudeKm": `${root}.minimum_reboost_altitude_km`,
          "stationKeeping.targetSmaKm": `${root}.target_semi_major_axis_km`,
          "spacecraft.initialFuelMassKg": `${root}.initial_fuel_mass_kg`,
          "stationKeeping.fuelReserveKg": `${root}.fuel_reserve_kg`,
          "endOfLife.finalAltitudeKm": `${root}.final_altitude_km`,
        }),
  }
}

const SATELLITE_DRAFT_PATHS: Record<string, string> = {
  "spacecraft.dryMassKg": "satellite.bus.physical.mass_kg.dry",
  "spacecraft.dragAreaM2": "satellite.bus.physical.drag_area_m2",
  "spacecraft.dragCoefficient": "satellite.bus.physical.drag_coefficient",
  "propulsion.ispSeconds": "satellite.bus.propulsion_subsystem.specific_impulse_seconds",
  "propulsion.minimumUsablePowerKw": "satellite.bus.propulsion_subsystem.electric_thruster.minimum_usable_power_kw",
  "propulsion.maximumUsablePowerKw": "satellite.bus.propulsion_subsystem.electric_thruster.maximum_usable_power_kw",
  "power.systemMarginPercent": "satellite.bus.electrical_subsystem.system_margin_percent",
}

export async function syncDigitalThreadFromGmatDraft(workspaceDir: string, draft: { templateId: string; values: Record<string, string | number | null> }) {
  const document = await loadOrCreateDigitalThread(workspaceDir)
  const provenance = document.provenance.values as { [key: string]: JsonValue }
  // A mission may update mission inputs only. Physical spacecraft values are
  // owned by the selected satellite definition and cannot be overwritten by a
  // conversation or a GMAT draft.
  for (const [draftPath, threadPath] of Object.entries(missionDraftPaths(draft.templateId))) {
    const value = draft.values[draftPath]
    if (value === null || value === undefined || value === "") continue
    setAtPath(document, threadPath, value)
    provenance[threadPath] = { source: "gmat_mission_draft", recorded_at: new Date().toISOString() }
  }
  // Physical values are editable as mission-specific what-if overrides.  The
  // selected file in data/satellite-library is never written here.
  for (const [draftPath, threadPath] of Object.entries(SATELLITE_DRAFT_PATHS)) {
    const value = draft.values[draftPath]
    if (value === null || value === undefined || value === "") continue
    setAtPath(document, threadPath, value)
    provenance[threadPath] = { source: "gmat_mission_satellite_override", recorded_at: new Date().toISOString() }
  }
  if (draft.templateId === "electric-propulsion-transfer") {
    const propellantMass = draft.values["spacecraft.initialFuelMassKg"]
    if (typeof propellantMass === "number") {
      const threadPath = "satellite.bus.propulsion_subsystem.electric_thruster.propellant_mass_kg"
      setAtPath(document, threadPath, propellantMass)
      provenance[threadPath] = { source: "gmat_mission_satellite_override", recorded_at: new Date().toISOString() }
    }
    const solarPowerKw = draft.values["power.initialMaxPowerKw"]
    if (typeof solarPowerKw === "number") {
      const threadPath = "satellite.bus.electrical_subsystem.solar_panels.total_power_generated_watts"
      setAtPath(document, threadPath, solarPowerKw * 1000)
      provenance[threadPath] = { source: "gmat_mission_satellite_override", recorded_at: new Date().toISOString(), conversion: "kW_to_W" }
    }
    const busLoadKw = draft.values["power.busLoadKw"]
    if (typeof busLoadKw === "number") {
      // An electric-propulsion allocation is more specific when the selected
      // satellite defines one; otherwise the nominal spacecraft bus load is
      // the only available source. Both paths are present in satellite.json
      // templates where applicable, so custom records remain supported.
      const propulsionModePath = "satellite.bus.electrical_subsystem.electric_propulsion_mode.bus_load_kw"
      const threadPath = getAtPath(document, propulsionModePath) === undefined
        ? "satellite.bus.electrical_subsystem.spacecraft_bus_load_kw"
        : propulsionModePath
      setAtPath(document, threadPath, busLoadKw)
      provenance[threadPath] = { source: "gmat_mission_satellite_override", recorded_at: new Date().toISOString() }
    }
  }
  // `analysis_requests` preserves the exact mission inputs for each tool.
  // `satellite.orbit` is the active orbital state of this mission and is the
  // compact, top-level representation that downstream tools consume.
  const epoch = draft.values["initialOrbit.epoch"]
  if (typeof epoch === "string" && epoch.trim()) {
    setAtPath(document, "satellite.orbit.reference_epoch_tai_mod_julian", epoch)
    const utcEpoch = taiModJulianToUtcIso(epoch)
    if (utcEpoch) setAtPath(document, "satellite.orbit.reference_epoch_utc", utcEpoch)
    provenance["satellite.orbit.reference_epoch_tai_mod_julian"] = { source: "gmat_mission_draft", recorded_at: new Date().toISOString() }
    if (utcEpoch) provenance["satellite.orbit.reference_epoch_utc"] = { source: "gmat_mission_draft", recorded_at: new Date().toISOString() }
  }
  for (const [draftPath, orbitField] of Object.entries(MISSION_ORBIT_PATHS)) {
    if (draftPath === "initialOrbit.epoch") continue
    const value = draft.values[draftPath]
    if (value === null || value === undefined || value === "") continue
    const targetPath = `satellite.orbit.keplerian_elements.${orbitField}`
    setAtPath(document, targetPath, value)
    provenance[targetPath] = { source: "gmat_mission_draft", recorded_at: new Date().toISOString() }
  }
  return saveDigitalThread(workspaceDir, document)
}

export async function digitalThreadGmatSeed(workspaceDir: string, template: GmatDigitalThreadTemplate) {
  const document = await loadOrCreateDigitalThread(workspaceDir)
  const result = adaptDigitalThreadToGmat(document, template)
  document.provenance.derivations = result.derivations as unknown as JsonValue
  await saveDigitalThread(workspaceDir, document)
  return result
}
