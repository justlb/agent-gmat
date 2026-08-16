import fs from "node:fs/promises"
import path from "node:path"

import type { DigitalThreadDocument, JsonValue } from "../digitalThread/digitalThreadStore.js"
import { assertValidSimuCicRequest, getPredefinedGroundStation, type PredefinedGroundStation } from "./groundStationCatalog.js"

type JsonRecord = { [key: string]: JsonValue }
type AttitudeMode = "nadir_pointing" | "ground_station_tracking"

export type SimuCicDefinition = {
  schema_version: 1
  source_digital_thread_revision: number
  generated_at: string
  attitude: {
    mode: AttitudeMode
    fallback_mode: "nadir_pointing"
    nadir_trace: { nadir_axis: "+X"; trace_axis: "+Y" }
    simultaneous_visibility_policy: "first_visible_station_wins" | null
    ground_stations: PredefinedGroundStation[]
  }
}

function asRecord(value: JsonValue | undefined): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null
}

/** Turns stable station IDs in the digital thread into the coordinates Simu-CIC needs. */
export function adaptDigitalThreadToSimuCic(document: DigitalThreadDocument): SimuCicDefinition {
  const request = asRecord(document.analysis_requests.simu_cic)
  if (!request) throw new Error("Simu-CIC request is missing from the digital thread")
  assertValidSimuCicRequest(request)
  const mode = request.attitude_mode === "ground_station_tracking" ? "ground_station_tracking" : "nadir_pointing"
  // A nadir law has no station target. Ignore stale station IDs left by an
  // earlier tracking request so the display and the generated calculation
  // cannot diverge.
  const stationIds = mode === "ground_station_tracking" && Array.isArray(request.ground_station_ids) ? request.ground_station_ids as string[] : []
  if (mode === "ground_station_tracking" && !stationIds.length) throw new Error("Simu-CIC station tracking requires at least one predefined ground station")
  const groundStations = stationIds.map(id => {
    const station = getPredefinedGroundStation(id)
    if (!station) throw new Error(`unknown predefined Simu-CIC ground station: ${id}`)
    return station
  })
  return {
    schema_version: 1,
    source_digital_thread_revision: Number(document.digital_thread.revision ?? 0),
    generated_at: new Date().toISOString(),
    attitude: {
      mode,
      fallback_mode: "nadir_pointing",
      nadir_trace: { nadir_axis: "+X", trace_axis: "+Y" },
      simultaneous_visibility_policy: mode === "ground_station_tracking" ? "first_visible_station_wins" : null,
      ground_stations: groundStations,
    },
  }
}

export async function writeSimuCicDefinition(runDir: string, document: DigitalThreadDocument) {
  const definition = adaptDigitalThreadToSimuCic(document)
  const output = path.join(runDir, "opalis", "02-simu-cic", "simucic.definition.json")
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(definition, null, 2)}\n`, "utf8")
  return { definition, output }
}
