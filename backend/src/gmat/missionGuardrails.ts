/**
 * Template-independent GMAT mission sanity checks.
 *
 * These checks deliberately sit before script rendering.  GMAT is still the
 * final authority, but invalid orbital states and contradictory mission
 * requests should never be sent to the external process.
 */
export type GmatMissionGuardrailTemplate =
  | "orbit-keeping"
  | "geo-gso-orbit-keeping"
  | "geo-gso-electric-station-keeping"
  | "geo-electric-end-of-life"
  | "electric-propulsion-transfer"
  | "chemical-hohmann-transfer"
  | "chemical-3d-transfer"
  | "chemical-2d-transfer"
  | "chemical-escape"
  | "chemical-leo-orbit-maintenance"
  | "electrical-2d-transfer"
  | "electrical-3d-transfer"
  | "electrical-escape"
  | "electrical-leo-orbit-maintenance"
  | "geo-chemical-station-keeping"
  | "geo-electric-station-keeping"
  | "gso-chemical-station-keeping"
  | "gso-electric-station-keeping"

export type MissionGuardrail = { code: string; message: string; path: string }
export type MissionValues = Record<string, string | number | null | undefined>

export const EARTH_EQUATORIAL_RADIUS_KM = 6378.1363
export const MINIMUM_EARTH_ORBIT_ALTITUDE_KM = 150
export const LEO_MAXIMUM_ALTITUDE_KM = 2_000

function finiteNumber(values: MissionValues, path: string) {
  const value = values[path]
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

function error(code: string, message: string, path: string): MissionGuardrail {
  return { code, message, path }
}

/** Returns all currently evaluable guardrail failures. Missing fields are
 * handled by the draft completeness validators, so a partially filled form
 * remains editable. */
export function validateGmatMissionGuardrails(template: GmatMissionGuardrailTemplate, values: MissionValues): MissionGuardrail[] {
  const guards: MissionGuardrail[] = []
  const eccentricity = finiteNumber(values, "initialOrbit.eccentricity")
  const inclination = finiteNumber(values, "initialOrbit.inclinationDeg")
  const semiMajorAxis = finiteNumber(values, "initialOrbit.smaKm")
  const initialAltitude = finiteNumber(values, "initialOrbit.altitudeKm")

  if (eccentricity !== null && (eccentricity < 0 || eccentricity >= 1)) {
    guards.push(error("eccentricity_bounds", "Eccentricity must be within [0, 1) for a bound Earth orbit.", "initialOrbit.eccentricity"))
  }
  if (inclination !== null && (inclination < 0 || inclination > 180)) {
    guards.push(error("inclination_bounds", "Inclination must be within [0, 180] degrees.", "initialOrbit.inclinationDeg"))
  }

  const perigeeAltitude = semiMajorAxis !== null && eccentricity !== null && eccentricity >= 0 && eccentricity < 1
    ? semiMajorAxis * (1 - eccentricity) - EARTH_EQUATORIAL_RADIUS_KM
    : null
  if (perigeeAltitude !== null && perigeeAltitude < MINIMUM_EARTH_ORBIT_ALTITUDE_KM) {
    guards.push(error("initial_perigee_altitude", `Initial perigee altitude is ${perigeeAltitude.toFixed(1)} km; it must be at least ${MINIMUM_EARTH_ORBIT_ALTITUDE_KM} km.`, "initialOrbit.smaKm"))
  }
  if (initialAltitude !== null && initialAltitude < MINIMUM_EARTH_ORBIT_ALTITUDE_KM) {
    guards.push(error("initial_altitude", `Initial altitude must be at least ${MINIMUM_EARTH_ORBIT_ALTITUDE_KM} km.`, "initialOrbit.altitudeKm"))
  }

  for (const [path, label] of [["spacecraft.dryMassKg", "Dry mass"], ["spacecraft.dragAreaM2", "Drag area"], ["spacecraft.dragCoefficient", "Drag coefficient"], ["propulsion.ispSeconds", "Specific impulse"]] as const) {
    const value = finiteNumber(values, path)
    if (value !== null && value <= 0) guards.push(error("positive_spacecraft_property", `${label} must be strictly positive.`, path))
  }

  if (template === "orbit-keeping") {
    const apogeeAltitude = semiMajorAxis !== null && eccentricity !== null && eccentricity >= 0 && eccentricity < 1
      ? semiMajorAxis * (1 + eccentricity) - EARTH_EQUATORIAL_RADIUS_KM
      : null
    if (perigeeAltitude !== null && perigeeAltitude > LEO_MAXIMUM_ALTITUDE_KM || apogeeAltitude !== null && apogeeAltitude > LEO_MAXIMUM_ALTITUDE_KM) {
      guards.push(error("orbit_keeping_leo_only", `Orbit keeping supports LEO only: both perigee and apogee must remain at or below ${LEO_MAXIMUM_ALTITUDE_KM} km.`, "initialOrbit.smaKm"))
    }
    const minimumReboost = finiteNumber(values, "stationKeeping.minimumAltitudeKm")
    if (minimumReboost !== null && minimumReboost < MINIMUM_EARTH_ORBIT_ALTITUDE_KM) {
      guards.push(error("minimum_reboost_altitude", `Minimum reboost altitude must be at least ${MINIMUM_EARTH_ORBIT_ALTITUDE_KM} km.`, "stationKeeping.minimumAltitudeKm"))
    }
    if (minimumReboost !== null && perigeeAltitude !== null && minimumReboost > perigeeAltitude) {
      guards.push(error("reboost_above_initial_orbit", `Minimum reboost altitude (${minimumReboost} km) cannot exceed initial perigee altitude (${perigeeAltitude.toFixed(1)} km).`, "stationKeeping.minimumAltitudeKm"))
    }
    const fuelMass = finiteNumber(values, "spacecraft.initialFuelMassKg")
    const fuelReserve = finiteNumber(values, "stationKeeping.fuelReserveKg")
    if (fuelMass !== null && (fuelMass < 0 || fuelMass > 100)) guards.push(error("orbit_keeping_fuel_range", "Initial fuel mass must be between 0 and 100 kg for the orbit-keeping mission model.", "spacecraft.initialFuelMassKg"))
    if (fuelMass !== null && fuelReserve !== null && fuelReserve >= fuelMass) guards.push(error("fuel_reserve", "Fuel reserve must be lower than initial fuel mass.", "stationKeeping.fuelReserveKg"))
  }

  if (template === "geo-gso-orbit-keeping" || template === "geo-gso-electric-station-keeping") {
    if (semiMajorAxis !== null && (semiMajorAxis < 40_000 || semiMajorAxis > 45_000)) guards.push(error("geo_gso_sma", "GEO/GSO orbit keeping requires an initial semi-major axis between 40,000 and 45,000 km.", "initialOrbit.smaKm"))
    for (const [path, label] of template === "geo-gso-electric-station-keeping" ? [["spacecraft.initialFuelMassKg", "Initial fuel mass"], ["stationKeeping.northSouthToleranceDeg", "North/South tolerance"], ["stationKeeping.eastWestToleranceDeg", "East/West tolerance"], ["stationKeeping.eastWestBurnDurationSec", "East/West burn duration"], ["stationKeeping.northSouthBurnDurationSec", "North/South burn duration"], ["stationKeeping.missionDurationDays", "Mission duration"], ["power.initialMaxPowerKw", "Initial solar power"]] : [["spacecraft.initialFuelMassKg", "Initial fuel mass"], ["stationKeeping.northSouthToleranceDeg", "North/South tolerance"], ["stationKeeping.eastWestToleranceDeg", "East/West tolerance"], ["stationKeeping.eccentricityTolerance", "Eccentricity tolerance"], ["stationKeeping.daysOfOk", "Days of station keeping"]] as const) {
      const value = finiteNumber(values, path)
      if (value !== null && value <= 0) guards.push(error("geo_gso_positive", `${label} must be strictly positive.`, path))
    }
  }

  if (template === "geo-gso-orbit-keeping" || template === "geo-gso-electric-station-keeping") {
    const eastWestTolerance = finiteNumber(values, "stationKeeping.eastWestToleranceDeg")
    const northSouthTolerance = finiteNumber(values, "stationKeeping.northSouthToleranceDeg")
    if (eastWestTolerance !== null && (eastWestTolerance <= 0 || eastWestTolerance > 1)) guards.push(error("geo_gso_east_west_tolerance", "East/West tolerance must be within (0, 1] degrees.", "stationKeeping.eastWestToleranceDeg"))
    if (northSouthTolerance !== null && (northSouthTolerance <= 0 || northSouthTolerance > 1)) guards.push(error("geo_gso_north_south_tolerance", "North/South tolerance must be within (0, 1] degrees.", "stationKeeping.northSouthToleranceDeg"))
    if (template === "geo-gso-orbit-keeping") {
      const duration = finiteNumber(values, "stationKeeping.daysOfOk")
      if (eastWestTolerance !== null && eastWestTolerance <= 0.02) guards.push(error("geo_gso_east_west_guardband", "East/West tolerance must exceed the 0.02 degree controller guardband.", "stationKeeping.eastWestToleranceDeg"))
      if (duration !== null && duration > 60) guards.push(error("geo_gso_duration_limit", "GEO/GSO station keeping is limited to 60 days because this model is not validated beyond that duration.", "stationKeeping.daysOfOk"))
    } else {
      const duration = finiteNumber(values, "stationKeeping.missionDurationDays")
      const eastWestBurn = finiteNumber(values, "stationKeeping.eastWestBurnDurationSec")
      const northSouthBurn = finiteNumber(values, "stationKeeping.northSouthBurnDurationSec")
      const solarPower = finiteNumber(values, "power.initialMaxPowerKw")
      if (duration !== null && duration > 60) guards.push(error("geo_gso_electric_duration_limit", "GEO/GSO electric station keeping is limited to 60 days because this model is not validated beyond that duration.", "stationKeeping.missionDurationDays"))
      if (eastWestBurn !== null && (eastWestBurn < 1 || eastWestBurn > 86_400)) guards.push(error("geo_gso_electric_east_west_burn", "East/West burn duration must be between 1 and 86,400 seconds.", "stationKeeping.eastWestBurnDurationSec"))
      if (northSouthBurn !== null && (northSouthBurn < 1 || northSouthBurn > 86_400)) guards.push(error("geo_gso_electric_north_south_burn", "North/South burn duration must be between 1 and 86,400 seconds.", "stationKeeping.northSouthBurnDurationSec"))
      if (solarPower !== null && solarPower > 50) guards.push(error("geo_gso_electric_solar_power", "Initial solar-array power must not exceed 50 kW for this model.", "power.initialMaxPowerKw"))
    }
  }
  if (template === "chemical-hohmann-transfer") {
    const targetRadius = finiteNumber(values, "transfer.targetRadiusKm")
    if (targetRadius !== null && targetRadius - EARTH_EQUATORIAL_RADIUS_KM < MINIMUM_EARTH_ORBIT_ALTITUDE_KM) {
      guards.push(error("target_orbit_altitude", `Target orbit altitude must be at least ${MINIMUM_EARTH_ORBIT_ALTITUDE_KM} km above Earth.`, "transfer.targetRadiusKm"))
    }
  }

  if (template === "chemical-3d-transfer") {
    if (initialAltitude !== null && initialAltitude > LEO_MAXIMUM_ALTITUDE_KM) {
      guards.push(error("chemical_3d_initial_leo", `Chemical 3D GEO transfer starts from LEO; initial altitude must not exceed ${LEO_MAXIMUM_ALTITUDE_KM} km.`, "initialOrbit.altitudeKm"))
    }
    const finalAltitude = finiteNumber(values, "transfer.finalAltitudeKm")
    if (finalAltitude !== null && finalAltitude < 30_000) guards.push(error("chemical_3d_target_altitude", "Chemical 3D GEO transfer requires a final altitude of at least 30,000 km.", "transfer.finalAltitudeKm"))
    if (initialAltitude !== null && finalAltitude !== null && finalAltitude <= initialAltitude) guards.push(error("chemical_3d_altitude_order", "Final altitude must be greater than initial altitude for a LEO-to-GEO transfer.", "transfer.finalAltitudeKm"))
  }

  if (template === "electric-propulsion-transfer") {
    const finalAltitude = finiteNumber(values, "transfer.finalAltitudeKm")
    // Electric-transfer missions normally provide SMA rather than an explicit
    // altitude. Derive it here so the guardrail still rejects a descent or a
    // no-op transfer before GMAT is launched.
    const electricInitialAltitude = initialAltitude ?? (semiMajorAxis !== null ? semiMajorAxis - EARTH_EQUATORIAL_RADIUS_KM : null)
    const propellant = finiteNumber(values, "spacecraft.initialFuelMassKg")
    const minPower = finiteNumber(values, "propulsion.minimumUsablePowerKw")
    const maxPower = finiteNumber(values, "propulsion.maximumUsablePowerKw")
    const solarPower = finiteNumber(values, "power.initialMaxPowerKw")
    const busLoad = finiteNumber(values, "power.busLoadKw")
    const margin = finiteNumber(values, "power.systemMarginPercent")
    if (finalAltitude !== null && finalAltitude < MINIMUM_EARTH_ORBIT_ALTITUDE_KM) guards.push(error("electric_target_altitude", `Electric-transfer target altitude must be at least ${MINIMUM_EARTH_ORBIT_ALTITUDE_KM} km above Earth.`, "transfer.finalAltitudeKm"))
    if (electricInitialAltitude !== null && finalAltitude !== null && finalAltitude <= electricInitialAltitude) guards.push(error("electric_altitude_order", "Electric-transfer target altitude must be greater than the initial altitude.", "transfer.finalAltitudeKm"))
    if (propellant !== null && propellant <= 0) guards.push(error("electric_propellant", "Electric propellant mass must be strictly positive.", "spacecraft.initialFuelMassKg"))
    if (minPower !== null && minPower <= 0) guards.push(error("minimum_thruster_power", "Minimum usable thruster power must be strictly positive.", "propulsion.minimumUsablePowerKw"))
    if (maxPower !== null && maxPower <= 0) guards.push(error("maximum_thruster_power", "Maximum usable thruster power must be strictly positive.", "propulsion.maximumUsablePowerKw"))
    if (minPower !== null && maxPower !== null && minPower >= maxPower) guards.push(error("thruster_power_range", "Minimum usable thruster power must be lower than maximum usable power.", "propulsion.minimumUsablePowerKw"))
    if (solarPower !== null && solarPower <= 0) guards.push(error("solar_power", "Solar-array maximum power must be strictly positive.", "power.initialMaxPowerKw"))
    if (busLoad !== null && busLoad < 0) guards.push(error("bus_load", "Spacecraft bus load cannot be negative.", "power.busLoadKw"))
    if (margin !== null && (margin < 0 || margin >= 100)) guards.push(error("power_margin", "Power-system margin must be within [0, 100) percent.", "power.systemMarginPercent"))
    if (solarPower !== null && busLoad !== null && margin !== null && minPower !== null) {
      const usablePower = Math.max(0, (solarPower - busLoad) * (1 - margin / 100))
      if (usablePower < minPower) guards.push(error("insufficient_initial_thrust_power", `Usable initial thrust power is ${usablePower.toFixed(3)} kW, below the ${minPower.toFixed(3)} kW thruster minimum.`, "power.initialMaxPowerKw"))
    }
  }
  return guards
}

export function assertGmatMissionGuardrails(template: GmatMissionGuardrailTemplate, values: MissionValues) {
  const guards = validateGmatMissionGuardrails(template, values)
  if (guards.length) throw new Error(`GMAT mission guardrails failed: ${guards.map(guard => guard.message).join(" ")}`)
  return guards
}

