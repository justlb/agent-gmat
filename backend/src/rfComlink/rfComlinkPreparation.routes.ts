import fs from "node:fs/promises"
import path from "node:path"

import type { FastifyInstance } from "fastify"

import { loadRunDigitalThreadSnapshot } from "../digitalThread/digitalThreadStore.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { adaptDigitalThreadToRFComlink } from "./rfComlinkDigitalThreadAdapter.js"

type RunBody = { runPath?: unknown }
type JsonRecord = Record<string, unknown>

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null
}

function resolveGmatRunDir(root: string, candidate: unknown) {
  if (typeof candidate !== "string" || !candidate.trim()) return null
  const runDir = path.resolve(root, candidate)
  const normalized = runDir.split(path.sep).join("/")
  return isPathInside(root, runDir) && /\/gmat\/(?:orbit-keeping|electric-propulsion-transfer|mission-runs)\/[^/]+$/u.test(normalized)
    ? runDir
    : null
}

/**
 * Produces a run-local, auditable manifest of the exact CIC inputs that the
 * RF-COMLINK scenario generator will consume.  This is deliberately separate
 * from .rfcl construction: no satellite radio parameter is fabricated here.
 */
export async function prepareRFComlinkInputs(root: string, runDir: string) {
  const snapshot = await loadRunDigitalThreadSnapshot(runDir)
  const staticInputs = adaptDigitalThreadToRFComlink(snapshot)
  const missing = [...staticInputs.validation.missing]
  const warnings = [...staticInputs.validation.warnings]

  const simuDefinitionPath = path.join(runDir, "opalis", "02-simu-cic", "simucic.definition.json")
  const simuDefinition = record(JSON.parse(await fs.readFile(simuDefinitionPath, "utf8").catch(() => "null")))
  const attitude = record(simuDefinition?.attitude)
  const actualMode = attitude?.mode
  const stations = Array.isArray(attitude?.ground_stations) ? attitude!.ground_stations.map(record).filter((value): value is JsonRecord => value !== null) : []
  const selectedStationId = staticInputs.selectedGroundStationId
  const stationIndex = selectedStationId ? stations.findIndex(station => station.id === selectedStationId) : -1

  if (actualMode !== "ground_station_tracking") {
    missing.push("Simu-CIC executed attitude.mode=ground_station_tracking")
  }
  if (selectedStationId && stationIndex < 0) {
    missing.push(`Simu-CIC executed ground station ${selectedStationId}`)
  }

  const cicDirectory = path.join(runDir, "opalis", "02-simu-cic", "02-fichiers-cic", "Sat")
  const sourceFiles = stationIndex < 0 ? [] : [
    `Sat_DISTANCE_GROUND_STATION_${stationIndex + 1}.TXT`,
    `Sat_GEOMETRICAL_VISIBILITY_GROUND_STATION_${stationIndex + 1}.TXT`,
    `Sat_GROUND_STATION_${stationIndex + 1}_DIRECTION-SATELLITE_FRAME.TXT`,
    `Sat_SATELLITE_DIRECTION-GROUND_STATION_${stationIndex + 1}_FRAME.TXT`,
  ]
  const unavailable = await Promise.all(sourceFiles.map(async file => {
    const candidate = path.join(cicDirectory, file)
    const stat = await fs.stat(candidate).catch(() => null)
    return stat?.isFile() && stat.size > 0 ? null : `CIC/Sat/${file}`
  }))
  missing.push(...unavailable.filter((value): value is string => value !== null))

  const uniqueMissing = [...new Set(missing)]
  const uniqueWarnings = [...new Set(warnings)]
  const output = {
    schema_version: 1,
    source_satellite: "satellite.json" as const,
    source_simu_cic_definition: path.relative(runDir, simuDefinitionPath).split(path.sep).join("/"),
    selected_ground_station_id: selectedStationId,
    selected_ground_station: stationIndex >= 0 ? stations[stationIndex] : null,
    links: staticInputs.links,
    cic_inputs: sourceFiles.map(file => path.relative(runDir, path.join(cicDirectory, file)).split(path.sep).join("/")),
    validation: {
      missing: uniqueMissing,
      warnings: uniqueWarnings,
      status: uniqueMissing.length || uniqueWarnings.length ? "blocked" as const : "ready" as const,
    },
  }
  const outputPath = path.join(runDir, "rf-comlink", "01-input", "rf-comlink-inputs.json")
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8")
  return { ...output, output: path.relative(root, outputPath), outputPath }
}

export async function rfComlinkPreparationRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: RunBody }>("/api/rf-comlink/prepare-inputs", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveGmatRunDir(path.resolve(root), req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      return reply.send(await prepareRFComlinkInputs(path.resolve(root), runDir))
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to prepare RF-COMLINK inputs") })
    }
  })
}
