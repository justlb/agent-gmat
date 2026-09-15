import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import type { FastifyInstance } from "fastify"

import { loadRunDigitalThreadSnapshot, type DigitalThreadDocument, type JsonValue } from "../digitalThread/digitalThreadStore.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage } from "../shared/index.js"
import { adaptDigitalThreadToRFComlink } from "./rfComlinkDigitalThreadAdapter.js"
import { loadRunWorkflowLog } from "../opalis/workflowRunLog.js"
import { failRunStage, markRunStageNotVisible } from "../runs/runLifecycle.js"
import { resolveMissionRun, relativeToWorkspaceRoot } from "../runs/runWorkspace.js"
import { registerActiveCalculation, unregisterActiveCalculation } from "../gmat/activeCalculationRegistry.js"
import { loadConfig } from "../config.js"

type RunBody = { runPath?: unknown }
type JsonRecord = Record<string, unknown>
const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SOURCE_DIR, "../../..")
const config = loadConfig()

function rfComlinkHomeForHost() {
  const configured = process.env.RF_COMLINK_HOME?.trim() || config.tools.rfComlink.home
  if (!configured) throw new Error("RF-COMLINK is not configured. Set tools.rfComlink.home in config.json.")
  if (process.platform === "win32") return configured
  const normalized = configured.replace(/\\/gu, "/")
  const windowsPath = /^([a-z]):\/(.*)$/iu.exec(normalized)
  return windowsPath ? `/mnt/${windowsPath[1].toLowerCase()}/${windowsPath[2]}` : configured
}

function runProcess(command: string, args: string[], runDir?: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd: runDir, stdio: ["ignore", "pipe", "pipe"] })
    if (runDir) registerActiveCalculation(runDir, child)
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", chunk => { stderr += chunk })
    child.once("error", error => { if (runDir) unregisterActiveCalculation(runDir, child); reject(error) })
    child.once("close", code => { if (runDir) unregisterActiveCalculation(runDir, child); code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}`)) })
  })
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null
}

type CicPoint = { time: number; value: number }
type RFRunGeometry = {
  mean_elevation_deg: number
  mean_range_km: number
  sample_count: number
  source_files: string[]
  system_temperature_k_by_link: Record<string, number>
}

const GROUND_STATION_NOT_VISIBLE = "GROUND_STATION_NOT_VISIBLE"

function isNoGroundStationVisibility(inputs: { validation: { missing: string[] } }) {
  return inputs.validation.missing.some(item => item.includes("contains no visible samples"))
}

export function isGroundStationNotVisibleError(error: unknown) {
  return Boolean(error && typeof error === "object" && (error as { code?: unknown }).code === GROUND_STATION_NOT_VISIBLE)
}

/** CIC files share an MJD + seconds grid. This deliberately keeps only their
 * scalar payload, allowing the RF scenario to use the actual Simu-CIC pass
 * geometry rather than template placeholder values. */
function parseCicColumn(source: string, valueIndex: number): CicPoint[] {
  const marker = source.indexOf("META_STOP")
  if (marker < 0) throw new Error("CIC file is missing META_STOP")
  return source.slice(marker).split(/\r?\n/u).flatMap(line => {
    const fields = line.trim().split(/\s+/u)
    const day = Number(fields[0])
    const seconds = Number(fields[1])
    const value = Number(fields[valueIndex])
    return Number.isFinite(day) && Number.isFinite(seconds) && Number.isFinite(value)
      ? [{ time: day * 86_400 + seconds, value }]
      : []
  })
}

function mean(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null
}

function systemTemperatureForLink(link: { direction: string; id: string; spacecraftAntenna: Record<string, JsonValue>; system: Record<string, JsonValue> }) {
  const band = typeof link.system.frequency_band === "string" ? link.system.frequency_band.toUpperCase() : "S"
  // A spacecraft receiver can be reconstructed from its explicit G/T and
  // antenna gain. Ground-receiver defaults are conservative band values when
  // RF-COMLINK's station database is the hardware authority.
  if (link.direction === "EarthSpace") {
    const gain = link.spacecraftAntenna.gain_db
    const figureOfMerit = link.spacecraftAntenna.figure_of_merit_db_per_k
    if (typeof gain === "number" && typeof figureOfMerit === "number") {
      return 10 ** ((gain - figureOfMerit) / 10)
    }
    return 300
  }
  return band === "X" ? 250 : 150
}

async function writeRFRunGeometry(
  runDir: string,
  document: DigitalThreadDocument,
  links: ReturnType<typeof adaptDigitalThreadToRFComlink>["links"],
  sourceFiles: string[],
) {
  const [distanceSource, visibilitySource, directionSource] = await Promise.all(sourceFiles.map(file => fs.readFile(path.join(runDir, file), "utf8")))
  const distances = new Map(parseCicColumn(distanceSource, 2).map(point => [point.time, point.value]))
  const elevations = new Map(parseCicColumn(directionSource, 3).map(point => [point.time, point.value]))
  const visibleTimes = parseCicColumn(visibilitySource, 2).filter(point => point.value > 0).map(point => point.time)
  const samples = visibleTimes.flatMap(time => {
    const distance = distances.get(time)
    const elevation = elevations.get(time)
    return typeof distance === "number" && typeof elevation === "number" && elevation > 0 ? [{ distance, elevation }] : []
  })
  const meanRangeKm = mean(samples.map(sample => sample.distance))
  const meanElevationDeg = mean(samples.map(sample => sample.elevation))
  if (meanRangeKm === null || meanElevationDeg === null) throw new Error("Simu-CIC has no visible geometry samples for the selected RF-COMLINK station")
  const systemTemperature = Object.fromEntries(links.map(link => [link.id, Number(systemTemperatureForLink(link).toFixed(2))]))
  const geometry: RFRunGeometry = {
    mean_elevation_deg: Number(meanElevationDeg.toFixed(3)),
    mean_range_km: Number(meanRangeKm.toFixed(3)),
    sample_count: samples.length,
    source_files: sourceFiles,
    system_temperature_k_by_link: systemTemperature,
  }
  const request = record(document.analysis_requests.rf_comlink) ?? {}
  request.run_geometry = {
    ...geometry,
    method: {
      elevation: "arithmetic mean of positive-elevation Simu-CIC visibility samples",
      range: "arithmetic mean of Simu-CIC distance samples during visible passes",
      system_temperature: "receiver G/T and gain when available; otherwise conservative receiver-band default",
    },
  }
  document.analysis_requests.rf_comlink = request as JsonValue
  const provenance = record(document.provenance.values) ?? {}
  provenance["analysis_requests.rf_comlink.run_geometry"] = { source: "simu_cic", computed_at: new Date().toISOString(), source_files: sourceFiles }
  document.provenance.values = provenance as JsonValue
  await fs.writeFile(path.join(runDir, "satellite.json"), `${JSON.stringify(document, null, 2)}\n`, "utf8")
  return geometry
}

function rfInputProblem(missing: string[]) {
  const details: string[] = []
  if (missing.some(item => item.includes("attitude_mode=ground_station_tracking") || item.includes("executed attitude.mode=ground_station_tracking"))) {
    details.push("Select a ground-station attitude target (for example Kourou), then rerun Simu-CIC before RF-COMLINK.")
  }
  if (missing.some(item => item.includes("ground_station_ids") || item.includes("selected_ground_station_id") || item.includes("executed ground station"))) {
    details.push("RF-COMLINK needs one station selected both in the Simu-CIC request and in the newly generated CIC files.")
  }
  if (missing.some(item => item.includes("contains no visible samples"))) {
    details.push("The selected Simu-CIC ground station has no visible samples in its CIC file. Select the station, rerun Simu-CIC, and verify the GMAT OEM covers the intended orbit before preparing RF-COMLINK.")
  }
  const satelliteFields = missing.filter(item => item.startsWith("satellite.bus.rf_comlink"))
  if (satelliteFields.length) details.push(`Satellite RF data are incomplete: ${satelliteFields.join(", ")}.`)
  return details.length ? details.join(" ") : `RF-COMLINK inputs are incomplete: ${missing.join(", ")}`
}

/**
 * Produces a run-local, auditable manifest of the exact CIC inputs that the
 * RF-COMLINK scenario generator will consume.  This is deliberately separate
 * from .rfcl construction: no satellite radio parameter is fabricated here.
 */
export async function prepareRFComlinkInputs(root: string, runDir: string) {
  let snapshot = await loadRunDigitalThreadSnapshot(runDir)
  let staticInputs = adaptDigitalThreadToRFComlink(snapshot)
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
    `Sat_SATELLITE_DIRECTION-GROUND_STATION_${stationIndex + 1}_FRAME.TXT`,
  ]
  const unavailable = await Promise.all(sourceFiles.map(async file => {
    const candidate = path.join(cicDirectory, file)
    const stat = await fs.stat(candidate).catch(() => null)
    return stat?.isFile() && stat.size > 0 ? null : `CIC/Sat/${file}`
  }))
  missing.push(...unavailable.filter((value): value is string => value !== null))
  const visibilityFile = sourceFiles.find(file => file.startsWith("Sat_GEOMETRICAL_VISIBILITY_"))
  if (visibilityFile && !unavailable.some(value => value?.endsWith(visibilityFile))) {
    const source = await fs.readFile(path.join(cicDirectory, visibilityFile), "utf8").catch(() => "")
    // Simu-CIC visibility CIC rows end with 0 (not visible) or 1 (visible).
    // Do not allow RF-COMLINK to report an artificial zero availability when
    // the upstream trajectory/station configuration contains no pass at all.
    const hasVisibleSample = source.split(/\r?\n/u).some(line => /\s1\s*$/u.test(line))
    if (!hasVisibleSample) missing.push(`CIC/Sat/${visibilityFile} contains no visible samples`)
  }

  let runGeometry: RFRunGeometry | null = null
  if (!missing.length && sourceFiles.length === 3) {
    runGeometry = await writeRFRunGeometry(runDir, snapshot, staticInputs.links, sourceFiles.map(file => path.relative(runDir, path.join(cicDirectory, file)).split(path.sep).join("/")))
    // The geometry is now part of the run-local satellite snapshot, which is
    // the only source consumed by the adapter and RF scenario builder.
    snapshot = await loadRunDigitalThreadSnapshot(runDir)
    staticInputs = adaptDigitalThreadToRFComlink(snapshot)
  }

  const uniqueMissing = [...new Set(missing)]
  const uniqueWarnings = [...new Set(warnings)]
  const output = {
    schema_version: 1,
    source_satellite: "satellite.json" as const,
    source_simu_cic_definition: path.relative(runDir, simuDefinitionPath).split(path.sep).join("/"),
    selected_ground_station_id: selectedStationId,
    selected_ground_station: stationIndex >= 0 ? stations[stationIndex] : null,
    data_handling: staticInputs.dataHandling,
    links: staticInputs.links,
    run_geometry: runGeometry,
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
  return { ...output, output: relativeToWorkspaceRoot(root, outputPath), outputPath }
}

/** Build the audited RF-COMLINK package for one already completed Simu-CIC run. */
export async function prepareRFComlinkScenario(root: string, runDir: string) {
  const workflow = await loadRunWorkflowLog(runDir)
  if (workflow.stages.simu_cic.status !== "completed") {
    throw new Error("Run Simu-CIC first. RF-COMLINK requires CIC files generated with the current attitude configuration.")
  }
  const inputs = await prepareRFComlinkInputs(root, runDir)
  if (inputs.validation.status !== "ready") {
    if (isNoGroundStationVisibility(inputs)) {
      const station = inputs.selected_ground_station && typeof inputs.selected_ground_station.name === "string"
        ? inputs.selected_ground_station.name
        : inputs.selected_ground_station_id ?? "selected ground station"
      throw Object.assign(new Error(`Ground station not visible: ${station} has no line-of-sight during the simulated mission window. RF-COMLINK was not started.`), { code: GROUND_STATION_NOT_VISIBLE, inputs })
    }
    throw Object.assign(new Error(rfInputProblem(inputs.validation.missing)), { inputs })
  }
  const templateOverride = process.env.RF_COMLINK_TEMPLATE?.trim()
  const exampleDirectory = path.join(rfComlinkHomeForHost(), "example")
  // RF-COMLINK releases do not all include vide.rfcl. example.rfcl is the
  // complete, valid ZIP template distributed with the current installation.
  const template = templateOverride || (await (async () => {
    for (const fileName of ["vide.rfcl", "example.rfcl"]) {
      const candidate = path.join(exampleDirectory, fileName)
      if (await fs.access(candidate).then(() => true).catch(() => false)) return candidate
    }
    throw new Error("RF-COMLINK template is unavailable. Expected example/vide.rfcl or example/example.rfcl under " + rfComlinkHomeForHost())
  })())
  const output = path.join(runDir, "rf-comlink", "02-scenario", "prepared-rf-comlink.rfcl")
  await fs.access(template)
  const script = path.join(PROJECT_ROOT, "tools", "workflow_RF-COMLINK", "02-prepare-scenario", "build_rf_comlink_scenario.py")
  const python = process.env.RF_COMLINK_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3")
  await runProcess(python, [script, "--template", template, "--inputs", inputs.outputPath, "--output", output], runDir)
  return { ...inputs, scenario: relativeToWorkspaceRoot(root, output), scenarioPath: output }
}

export async function rfComlinkPreparationRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: RunBody }>("/api/rf-comlink/prepare-inputs", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const run = root ? resolveMissionRun(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!run) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      return reply.send(await prepareRFComlinkInputs(run.root, run.runDir))
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to prepare RF-COMLINK inputs") })
    }
  })

  fastify.post<{ Body: RunBody }>("/api/rf-comlink/prepare-scenario", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const run = root ? resolveMissionRun(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!run) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      return reply.send(await prepareRFComlinkScenario(run.root, run.runDir))
    } catch (error) {
      const message = getErrorMessage(error, "failed to prepare RF-COMLINK scenario")
      if (isGroundStationNotVisibleError(error)) await markRunStageNotVisible(run.runDir, "rf_comlink", message)
      else await failRunStage(run.runDir, "rf_comlink", message)
      return reply.status(422).send({ error: message })
    }
  })
}
