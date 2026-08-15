import fs from "node:fs/promises"
import path from "node:path"
import { spawn } from "node:child_process"
import { fileURLToPath } from "node:url"

import type { FastifyInstance } from "fastify"

import { loadRunDigitalThreadSnapshot } from "../digitalThread/digitalThreadStore.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { adaptDigitalThreadToRFComlink } from "./rfComlinkDigitalThreadAdapter.js"
import { loadRunWorkflowLog, updateRunWorkflowLog } from "../opalis/workflowRunLog.js"

type RunBody = { runPath?: unknown }
type JsonRecord = Record<string, unknown>
const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SOURCE_DIR, "../../..")

function rfComlinkHomeForHost() {
  const configured = process.env.RF_COMLINK_HOME?.trim() || "D:\\STAGE\\APP\\rf-comlink"
  if (process.platform === "win32") return configured
  const normalized = configured.replace(/\\/gu, "/")
  const windowsPath = /^([a-z]):\/(.*)$/iu.exec(normalized)
  return windowsPath ? `/mnt/${windowsPath[1].toLowerCase()}/${windowsPath[2]}` : configured
}

function runProcess(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", chunk => { stderr += chunk })
    child.once("error", reject)
    child.once("close", code => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}`)))
  })
}

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
    data_handling: staticInputs.dataHandling,
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

  fastify.post<{ Body: RunBody }>("/api/rf-comlink/prepare-scenario", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveGmatRunDir(path.resolve(root), req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      const workflow = await loadRunWorkflowLog(runDir)
      if (workflow.stages.simu_cic.status !== "completed") return reply.status(422).send({ error: "Run Simu-CIC first. RF-COMLINK requires CIC files generated with the current attitude configuration." })
      await updateRunWorkflowLog(runDir, "rf_comlink", "running", "Preparing RF-COMLINK scenario from satellite.json and Simu-CIC CIC files")
      const inputs = await prepareRFComlinkInputs(path.resolve(root), runDir)
      if (inputs.validation.status !== "ready") {
        await updateRunWorkflowLog(runDir, "rf_comlink", "failed", `Missing RF-COMLINK data: ${inputs.validation.missing.join(", ")}`)
        return reply.status(422).send({ error: `RF-COMLINK inputs are incomplete: ${inputs.validation.missing.join(", ")}`, ...inputs })
      }
      const templateOverride = process.env.RF_COMLINK_TEMPLATE?.trim()
      // `vide.rfcl` is the vendor's empty scenario structure.  Satellite
      // values are filled only from this run's digital thread, never copied
      // from a Starlink or VLEO example scenario.
      const templateName = "vide.rfcl"
      const template = templateOverride || path.join(rfComlinkHomeForHost(), "example", templateName)
      const output = path.join(runDir, "rf-comlink", "02-scenario", "prepared-rf-comlink.rfcl")
      await fs.access(template)
      const script = path.join(PROJECT_ROOT, "tools", "workflow_RF-COMLINK", "02-prepare-scenario", "build_rf_comlink_scenario.py")
      const python = process.env.RF_COMLINK_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3")
      await runProcess(python, [script, "--template", template, "--inputs", inputs.outputPath, "--output", output])
      await updateRunWorkflowLog(runDir, "rf_comlink", "completed", `Prepared ${path.basename(output)}`)
      return reply.send({ ...inputs, scenario: path.relative(root, output).split(path.sep).join("/") })
    } catch (error) {
      const message = getErrorMessage(error, "failed to prepare RF-COMLINK scenario")
      await updateRunWorkflowLog(runDir, "rf_comlink", "failed", message)
      return reply.status(422).send({ error: message })
    }
  })
}
