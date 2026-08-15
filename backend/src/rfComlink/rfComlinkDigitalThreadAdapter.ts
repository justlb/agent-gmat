import type { DigitalThreadDocument, JsonValue } from "../digitalThread/digitalThreadStore.js"
import { getAtPath } from "../digitalThread/digitalThreadStore.js"

export type RFComlinkLink = {
  direction: "EarthSpace" | "SpaceEarth"
  id: string
  name: string
  requiresGroundStationTracking: boolean
}

export type RFComlinkInputParameters = {
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

/**
 * Builds the RF-COMLINK input contract from the run-local satellite.json.
 * It does not import parameters from example .rfcl files and deliberately
 * refuses to infer a ground station from an unexecuted Simu-CIC request.
 */
export function adaptDigitalThreadToRFComlink(document: DigitalThreadDocument): RFComlinkInputParameters {
  const missing: string[] = []
  const warnings: string[] = []
  const links: RFComlinkLink[] = []
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
      if (id && name && (direction === "EarthSpace" || direction === "SpaceEarth") && typeof tracking === "boolean") {
        links.push({ id, name, direction, requiresGroundStationTracking: tracking })
      }
      // These fields are intentionally required before scenario generation,
      // while link IDs alone are enough for this schema-validation stage.
      for (const field of ["spacecraft_antenna", "system"]) {
        if (!record(link?.[field])) missing.push(`${prefix}.${field}`)
      }
    })
  }

  const simuCic = record(getAtPath(document, "analysis_requests.simu_cic"))
  const configuredStationIds = Array.isArray(simuCic?.ground_station_ids) && simuCic!.ground_station_ids.every(value => typeof value === "string")
    ? simuCic!.ground_station_ids as string[]
    : []
  const requestedStation = getAtPath(document, "analysis_requests.rf_comlink.selected_ground_station_id")
  const selectedGroundStationId = typeof requestedStation === "string" && requestedStation.trim() ? requestedStation.trim() : null
  if (links.some(link => link.requiresGroundStationTracking)) {
    if (simuCic?.attitude_mode !== "ground_station_tracking") missing.push("analysis_requests.simu_cic.attitude_mode=ground_station_tracking")
    if (!configuredStationIds.length) missing.push("analysis_requests.simu_cic.ground_station_ids")
    if (!selectedGroundStationId) missing.push("analysis_requests.rf_comlink.selected_ground_station_id")
    else if (!configuredStationIds.includes(selectedGroundStationId)) warnings.push("analysis_requests.rf_comlink.selected_ground_station_id must be one of the stations configured for Simu-CIC")
  }

  const uniqueMissing = [...new Set(missing)]
  return {
    links,
    schema_version: 1,
    selectedGroundStationId,
    source_satellite: "satellite.json",
    validation: { missing: uniqueMissing, status: uniqueMissing.length || warnings.length ? "blocked" : "ready", warnings },
  }
}
