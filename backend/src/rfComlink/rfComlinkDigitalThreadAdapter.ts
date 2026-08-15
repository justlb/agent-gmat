import type { DigitalThreadDocument, JsonValue } from "../digitalThread/digitalThreadStore.js"
import { getAtPath } from "../digitalThread/digitalThreadStore.js"

export type RFComlinkLink = {
  direction: "EarthSpace" | "SpaceEarth"
  id: string
  name: string
  requiresGroundStationTracking: boolean
  propagation: Record<string, JsonValue> | null
  spacecraftAntenna: Record<string, JsonValue>
  system: Record<string, JsonValue>
}

export type RFComlinkInputParameters = {
  dataHandling: Record<string, JsonValue>
  links: RFComlinkLink[]
  schema_version: 1
  selectedGroundStationId: string | null
  source_satellite: "satellite.json"
  validation: { missing: string[]; status: "blocked" | "ready"; warnings: string[] }
}

function record(value: JsonValue | undefined): Record<string, JsonValue> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null
}

function requiredString(value: JsonValue | undefined, path: string, missing: string[]) {
  if (typeof value === "string" && value.trim()) return value.trim()
  missing.push(path)
  return null
}

function requiredPositiveNumber(value: JsonValue | undefined, path: string, missing: string[]) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value
  missing.push(path)
  return null
}

function hasFiniteNumber(value: JsonValue | undefined) {
  return typeof value === "number" && Number.isFinite(value)
}

/**
 * Builds the RF-COMLINK input contract from the run-local satellite.json.
 * It does not import parameters from example .rfcl files and deliberately
 * refuses to infer a ground station from an unexecuted Simu-CIC request.
 */
export function adaptDigitalThreadToRFComlink(document: DigitalThreadDocument): RFComlinkInputParameters {
  const missing: string[] = []
  const warnings: string[] = []
  const links: RFComlinkLink[] = []
  const dataHandling = record(getAtPath(document, "satellite.bus.rf_comlink.data_handling"))
  if (!dataHandling) {
    missing.push("satellite.bus.rf_comlink.data_handling")
  } else {
    const initialMemory = typeof dataHandling.initial_memory_usage_bits === "number" && Number.isFinite(dataHandling.initial_memory_usage_bits)
      ? dataHandling.initial_memory_usage_bits : null
    const memoryCapacity = typeof dataHandling.memory_capacity_bits === "number" && Number.isFinite(dataHandling.memory_capacity_bits)
      ? dataHandling.memory_capacity_bits : null
    if (initialMemory === null || initialMemory < 0) missing.push("satellite.bus.rf_comlink.data_handling.initial_memory_usage_bits")
    if (memoryCapacity === null || memoryCapacity <= 0) missing.push("satellite.bus.rf_comlink.data_handling.memory_capacity_bits")
    if (initialMemory !== null && memoryCapacity !== null && initialMemory > memoryCapacity) {
      missing.push("satellite.bus.rf_comlink.data_handling.initial_memory_usage_bits must not exceed memory_capacity_bits")
    }
    const payloadRate = record(dataHandling.payload_binary_rate)
    if (!payloadRate || (payloadRate.mode !== "none" && payloadRate.mode !== "periodic")) {
      missing.push("satellite.bus.rf_comlink.data_handling.payload_binary_rate.mode")
    } else if (payloadRate.mode === "periodic") {
      for (const field of ["rate_bps", "active_duration_s", "repeat_period_s"]) {
        if (!hasFiniteNumber(payloadRate[field]) || (payloadRate[field] as number) <= 0) missing.push(`satellite.bus.rf_comlink.data_handling.payload_binary_rate.${field}`)
      }
      const activeDuration = typeof payloadRate.active_duration_s === "number" && Number.isFinite(payloadRate.active_duration_s) ? payloadRate.active_duration_s : null
      const repeatPeriod = typeof payloadRate.repeat_period_s === "number" && Number.isFinite(payloadRate.repeat_period_s) ? payloadRate.repeat_period_s : null
      if (activeDuration !== null && repeatPeriod !== null && activeDuration > repeatPeriod) {
        missing.push("satellite.bus.rf_comlink.data_handling.payload_binary_rate.active_duration_s must not exceed repeat_period_s")
      }
    }
  }
  const rawLinks = getAtPath(document, "satellite.bus.rf_comlink.links")
  if (!Array.isArray(rawLinks) || !rawLinks.length) {
    missing.push("satellite.bus.rf_comlink.links")
  } else {
    rawLinks.forEach((rawLink, index) => {
      const link = record(rawLink)
      const prefix = `satellite.bus.rf_comlink.links[${index}]`
      const id = requiredString(link?.id, `${prefix}.id`, missing)
      const name = requiredString(link?.name, `${prefix}.name`, missing)
      const direction = link?.direction
      if (direction !== "EarthSpace" && direction !== "SpaceEarth") missing.push(`${prefix}.direction`)
      const tracking = link?.requires_ground_station_tracking
      if (typeof tracking !== "boolean") missing.push(`${prefix}.requires_ground_station_tracking`)
      const antenna = record(link?.spacecraft_antenna)
      const system = record(link?.system)
      if (!antenna) missing.push(`${prefix}.spacecraft_antenna`)
      if (!system) missing.push(`${prefix}.system`)
      if (system) {
        requiredString(system.frequency_band, `${prefix}.system.frequency_band`, missing)
        requiredPositiveNumber(system.frequency_mhz, `${prefix}.system.frequency_mhz`, missing)
        requiredPositiveNumber(system.data_rate_bps, `${prefix}.system.data_rate_bps`, missing)
        requiredPositiveNumber(system.bit_error_rate, `${prefix}.system.bit_error_rate`, missing)
        requiredString(system.modulation, `${prefix}.system.modulation`, missing)
      }
      if (antenna) {
        requiredString(antenna.role, `${prefix}.spacecraft_antenna.role`, missing)
        if (direction === "EarthSpace" && !hasFiniteNumber(antenna.figure_of_merit_db_per_k) && !hasFiniteNumber(system?.receiver_sensitivity_dbm)) {
          missing.push(`${prefix}.spacecraft_antenna.figure_of_merit_db_per_k or ${prefix}.system.receiver_sensitivity_dbm`)
        }
        if (direction === "SpaceEarth" && !hasFiniteNumber(antenna.eirp_dbw) && !hasFiniteNumber(system?.transmit_power_dbm)) {
          missing.push(`${prefix}.spacecraft_antenna.eirp_dbw or ${prefix}.system.transmit_power_dbm`)
        }
      }
      if (id && name && (direction === "EarthSpace" || direction === "SpaceEarth") && typeof tracking === "boolean" && antenna && system) {
        links.push({ id, name, direction, requiresGroundStationTracking: tracking, spacecraftAntenna: antenna, system, propagation: record(link?.propagation) })
      }
    })
  }

  const simuCic = record(getAtPath(document, "analysis_requests.simu_cic"))
  const configuredStationIds = Array.isArray(simuCic?.ground_station_ids) && simuCic!.ground_station_ids.every(value => typeof value === "string")
    ? simuCic!.ground_station_ids as string[]
    : []
  const requestedStation = getAtPath(document, "analysis_requests.rf_comlink.selected_ground_station_id")
  // A single Simu-CIC tracking station is unambiguous: it is necessarily the
  // RF link counterpart.  Keep an explicit RF choice only when several
  // stations are configured.
  const selectedGroundStationId = typeof requestedStation === "string" && requestedStation.trim()
    ? requestedStation.trim()
    : configuredStationIds.length === 1 ? configuredStationIds[0] : null
  if (links.some(link => link.requiresGroundStationTracking)) {
    if (simuCic?.attitude_mode !== "ground_station_tracking") missing.push("analysis_requests.simu_cic.attitude_mode=ground_station_tracking")
    if (!configuredStationIds.length) missing.push("analysis_requests.simu_cic.ground_station_ids")
    if (!selectedGroundStationId) missing.push("analysis_requests.rf_comlink.selected_ground_station_id")
    else if (!configuredStationIds.includes(selectedGroundStationId)) warnings.push("analysis_requests.rf_comlink.selected_ground_station_id must be one of the stations configured for Simu-CIC")
  }

  const uniqueMissing = [...new Set(missing)]
  return {
    dataHandling: dataHandling ?? {},
    links,
    schema_version: 1,
    selectedGroundStationId,
    source_satellite: "satellite.json",
    validation: { missing: uniqueMissing, status: uniqueMissing.length || warnings.length ? "blocked" : "ready", warnings },
  }
}
