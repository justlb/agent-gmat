/**
 * Role: Runtime contract for the per-run satellite.json digital thread.
 * Exports: validateDigitalThreadDocument and assertValidDigitalThreadDocument.
 * Dependencies: none; intentionally usable before any adapter is loaded.
 * Invariant: only structurally valid JSON reaches GMAT, Simu-CIC, OPALIS or RF-COMLINK.
 */
type JsonRecord = Record<string, unknown>

const CURRENT_SCHEMA_VERSION = 1

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null
}

function optionalFiniteNumber(value: unknown) {
  return value === null || value === undefined || (typeof value === "number" && Number.isFinite(value))
}

function numberAt(document: JsonRecord, fieldPath: string) {
  let current: unknown = document
  for (const field of fieldPath.split(".")) {
    const next = record(current)
    if (!next) return null
    current = next[field]
  }
  return typeof current === "number" && Number.isFinite(current) ? current : null
}

function validatePositiveNumber(document: JsonRecord, errors: string[], fieldPath: string, allowZero = false) {
  const value = numberAt(document, fieldPath)
  if (value !== null && (allowZero ? value < 0 : value <= 0)) errors.push(`${fieldPath} must be ${allowZero ? "non-negative" : "strictly positive"}`)
}

/** Returns every contract violation so API callers receive an actionable error. */
export function validateDigitalThreadDocument(value: unknown) {
  const errors: string[] = []
  const document = record(value)
  if (!document) return ["document must be a JSON object"]
  if (document.schema_version !== CURRENT_SCHEMA_VERSION) errors.push(`schema_version must be ${CURRENT_SCHEMA_VERSION}`)
  for (const field of ["digital_thread", "satellite", "analysis_requests", "provenance"]) {
    if (!record(document[field])) errors.push(`${field} must be an object`)
  }

  const satellite = record(document.satellite)
  const orbit = record(satellite?.orbit)
  const elements = record(orbit?.keplerian_elements)
  if (elements) {
    for (const field of ["semi_major_axis_km", "eccentricity", "inclination_deg", "raan_deg", "arg_of_perigee_deg", "true_anomaly_deg", "mean_anomaly_deg"]) {
      if (!optionalFiniteNumber(elements[field])) errors.push(`satellite.orbit.keplerian_elements.${field} must be a finite number or null`)
    }
    if (typeof elements.eccentricity === "number" && (elements.eccentricity < 0 || elements.eccentricity >= 1)) errors.push("satellite.orbit.keplerian_elements.eccentricity must be in [0, 1)")
    if (typeof elements.semi_major_axis_km === "number" && elements.semi_major_axis_km <= 6378.1363) errors.push("satellite.orbit.keplerian_elements.semi_major_axis_km must be above the Earth equatorial radius")
    if (typeof elements.inclination_deg === "number" && (elements.inclination_deg < 0 || elements.inclination_deg > 180)) errors.push("satellite.orbit.keplerian_elements.inclination_deg must be in [0, 180]")
    for (const field of ["raan_deg", "arg_of_perigee_deg", "true_anomaly_deg", "mean_anomaly_deg"]) {
      if (typeof elements[field] === "number" && (elements[field] < 0 || elements[field] > 360)) errors.push(`satellite.orbit.keplerian_elements.${field} must be in [0, 360]`)
    }
  }

  for (const fieldPath of [
    "satellite.bus.physical.mass_kg.dry",
    "satellite.bus.physical.drag_area_m2",
    "satellite.bus.physical.drag_coefficient",
    "satellite.bus.propulsion_subsystem.specific_impulse_seconds",
    "satellite.bus.electrical_subsystem.solar_panels.total_area_m2",
    "satellite.bus.electrical_subsystem.solar_panels.total_power_generated_watts",
    "satellite.bus.electrical_subsystem.bus_voltage_v",
  ]) validatePositiveNumber(document, errors, fieldPath)
  for (const fieldPath of [
    "satellite.bus.propulsion_subsystem.electric_thruster.propellant_mass_kg",
    "satellite.bus.electrical_subsystem.spacecraft_bus_load_kw",
    "satellite.bus.electrical_subsystem.system_margin_percent",
  ]) validatePositiveNumber(document, errors, fieldPath, true)

  const minimumPower = numberAt(document, "satellite.bus.propulsion_subsystem.electric_thruster.minimum_usable_power_kw")
  const maximumPower = numberAt(document, "satellite.bus.propulsion_subsystem.electric_thruster.maximum_usable_power_kw")
  if (minimumPower !== null && maximumPower !== null && minimumPower > maximumPower) errors.push("electric-thruster minimum usable power must not exceed maximum usable power")
  const solarEfficiency = numberAt(document, "satellite.bus.electrical_subsystem.solar_panels.efficiency_percent")
  if (solarEfficiency !== null && (solarEfficiency <= 0 || solarEfficiency > 100)) errors.push("solar-panel efficiency_percent must be in (0, 100]")
  const systemMargin = numberAt(document, "satellite.bus.electrical_subsystem.system_margin_percent")
  if (systemMargin !== null && systemMargin > 100) errors.push("electrical system_margin_percent must be in [0, 100]")

  const analysis = record(document.analysis_requests)
  const simuCic = record(analysis?.simu_cic)
  if (simuCic) {
    const mode = simuCic.attitude_mode
    // Older dated runs used `earth_pointing`. digitalThreadStore normalizes
    // that legacy spelling to `nadir_pointing` immediately after validation.
    if (mode !== undefined && mode !== "nadir_pointing" && mode !== "ground_station_tracking" && mode !== "earth_pointing") errors.push("analysis_requests.simu_cic.attitude_mode must be nadir_pointing or ground_station_tracking")
    if (simuCic.ground_station_ids !== undefined && (!Array.isArray(simuCic.ground_station_ids) || simuCic.ground_station_ids.some(id => typeof id !== "string" || !id.trim()))) errors.push("analysis_requests.simu_cic.ground_station_ids must be an array of non-empty strings")
    const stations = Array.isArray(simuCic.ground_station_ids) ? simuCic.ground_station_ids.filter(id => typeof id === "string") as string[] : []
    if ((mode === "nadir_pointing" || mode === "earth_pointing") && stations.length) errors.push("nadir pointing must not define ground stations")
    if (mode === "ground_station_tracking" && !stations.length) errors.push("ground_station_tracking requires at least one ground station")
  }
  const rfComlink = record(analysis?.rf_comlink)
  if (rfComlink && rfComlink.selected_ground_station_id !== undefined && rfComlink.selected_ground_station_id !== null && typeof rfComlink.selected_ground_station_id !== "string") errors.push("analysis_requests.rf_comlink.selected_ground_station_id must be a string or null")
  if (simuCic?.attitude_mode === "ground_station_tracking" && typeof rfComlink?.selected_ground_station_id === "string") {
    const stations = Array.isArray(simuCic.ground_station_ids) ? simuCic.ground_station_ids : []
    if (!stations.includes(rfComlink.selected_ground_station_id)) errors.push("RF-COMLINK selected ground station must be tracked by Simu-CIC")
  }
  return errors
}

export function assertValidDigitalThreadDocument(value: unknown): asserts value is JsonRecord {
  const errors = validateDigitalThreadDocument(value)
  if (errors.length) throw new Error(`invalid satellite.json: ${errors.join("; ")}`)
}
