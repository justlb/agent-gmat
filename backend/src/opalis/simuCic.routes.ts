import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import { toGmatNativePath } from "../gmat/orbitKeepingRunner.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage } from "../shared/index.js"
import { PREDEFINED_GROUND_STATIONS } from "./groundStationCatalog.js"
import { listRFComlinkGroundStations } from "../rfComlink/groundStationCatalog.js"
import { loadRunDigitalThreadSnapshot } from "../digitalThread/digitalThreadStore.js"
import { writeSimuCicDefinition } from "./simuCicDefinition.js"
import { appendRunConversation } from "../digitalThread/missionConversationStore.js"
import { cancelActiveCalculations, registerActiveCalculation, unregisterActiveCalculation } from "../gmat/activeCalculationRegistry.js"
import { loadRunWorkflowLog } from "./workflowRunLog.js"
import { beginRunStage, completeRunStage, failRunStage } from "../runs/runLifecycle.js"
import { writeConsolidatedRunReport } from "./consolidatedRunReport.js"
import { resolveMissionRun, relativeToWorkspaceRoot } from "../runs/runWorkspace.js"
import { acquireMissionPipelineLock, releaseMissionPipelineLock } from "../runs/missionPipelineLock.js"

type RunBody = { runPath?: unknown }

function resolveGmatRunDir(userWorkspaceRoot: string, runPath: unknown) {
  return resolveMissionRun(userWorkspaceRoot, runPath)?.runDir ?? null
}

function requiredSimuCicConfig(config: AppConfig) {
  const tool = config.tools.opalis
  const required: Array<[string, string | null]> = [
    ["tools.opalis.workerPython", tool.workerPython],
    ["tools.opalis.simuCicRunner", tool.simuCicRunner],
    ["tools.opalis.baseScenario", tool.baseScenario],
    ["tools.opalis.simucicDir", tool.simucicDir],
  ]
  const missing = required.filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) throw new Error("Simu-CIC is not configured: " + missing.join(", "))
  return {
    baseScenario: tool.baseScenario!,
    celestlabDir: tool.celestlabDir,
    scilabBin: tool.scilabBin,
    simucicDir: tool.simucicDir!,
    simuCicRunner: tool.simuCicRunner!,
    timeoutMs: tool.timeoutMs,
    workerPython: tool.workerPython!,
  }
}

function guiBinFor(scilabBin: string | null) {
  return scilabBin ? path.join(path.dirname(scilabBin), "WScilex.exe") : "WScilex.exe"
}

function nativePath(filePath: string) {
  return toGmatNativePath(filePath)
}

function ephemerisConverterFor(simuCicRunner: string) {
  return path.join(path.dirname(path.dirname(simuCicRunner)), "1-conversion_vers_SIMU-CIC", "eph_conversion.py")
}

async function findGmatEphemeris(runDir: string) {
  const preferred = ["EphemerisFile1.oem", "opalis_ephemeris.oem"]
  const entries = await fs.readdir(runDir, { withFileTypes: true }).catch(() => [])
  const names = [
    ...preferred.filter(name => entries.some(entry => entry.isFile() && entry.name === name)),
    ...entries.filter(entry => entry.isFile() && /\.oem$/iu.test(entry.name) && !preferred.includes(entry.name)).map(entry => entry.name).sort(),
  ]
  for (const name of names) {
    const candidate = path.join(runDir, name)
    const stat = await fs.stat(candidate).catch(() => null)
    if (stat?.isFile() && stat.size > 0) return candidate
  }
  return null
}

/**
 * GMAT GUI can legitimately finish a script after the earlier console launch
 * has failed to flush its OEM subscriber. The resulting OEM is the artifact
 * consumed by Simu-CIC, so reconcile the stale console status before blocking
 * the downstream workflow. This never promotes a run without a non-empty OEM.
 */
async function reconcileGmatStatusFromEphemeris(runDir: string, ephemeris: string | null) {
  if (!ephemeris) return false
  const resultPath = path.join(runDir, "gmat_result.json")
  const current = JSON.parse(await fs.readFile(resultPath, "utf8").catch(() => "null")) as Record<string, unknown> | null
  if (current?.status !== "failed" && current?.status !== "timeout") return false
  const { error: _previousError, ...resultWithoutError } = current
  await fs.writeFile(resultPath, `${JSON.stringify({
    ...resultWithoutError,
    status: "completed",
    recoveredFrom: "validated_oem_after_gmat_gui_execution",
  }, null, 2)}\n`, "utf8")

  const manifestPath = path.join(runDir, "run_manifest.json")
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8").catch(() => "null")) as Record<string, unknown> | null
  if (manifest) {
    const outputs = manifest.outputs && typeof manifest.outputs === "object" && !Array.isArray(manifest.outputs)
      ? manifest.outputs as Record<string, unknown>
      : {}
    await fs.writeFile(manifestPath, `${JSON.stringify({
      ...manifest,
      status: "completed",
      completedAt: new Date().toISOString(),
      outputs: { ...outputs, ephemeris: path.basename(ephemeris) },
    }, null, 2)}\n`, "utf8")
  }
  return true
}

async function runCommand(executable: string, args: string[], cwd: string, timeoutMs: number, completed?: () => Promise<boolean>) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true })
    registerActiveCalculation(cwd, child)
    let output = ""
    let settled = false
    child.stdout.on("data", chunk => { output += String(chunk) })
    child.stderr.on("data", chunk => { output += String(chunk) })
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (completionTimer) clearInterval(completionTimer)
      unregisterActiveCalculation(cwd, child)
      callback()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new Error("Simu-CIC timed out after " + timeoutMs + " ms")))
    }, timeoutMs)
    const completionTimer = completed ? setInterval(() => {
      void completed().then(isComplete => {
        if (!isComplete) return
        // Some GUI Scilab versions leave their launcher alive even after all
        // CIC files have been written. The verified artifacts are the useful
        // completion signal for a non-interactive mission pipeline.
        child.kill()
        finish(() => resolve(output))
      }).catch(() => undefined)
    }, 1_000) : null
    child.once("error", error => finish(() => reject(error)))
    child.once("close", code => {
      if (code === 0) finish(() => resolve(output))
      else finish(() => reject(new Error("Simu-CIC failed with code " + code + ": " + output.slice(-2_000))))
    })
  })
}

async function convertGmatEphemeris(settings: ReturnType<typeof requiredSimuCicConfig>, runDir: string) {
  const ephemeris = await findGmatEphemeris(runDir)
  if (!ephemeris) {
    throw new Error("GMAT did not produce a usable OEM ephemeris for this run. Regenerate the GMAT run, then launch Simu-CIC.")
  }
  const conversionDir = path.join(runDir, "opalis", "01-conversion_vers_SIMU-CIC")
  const convertedEphemeris = path.join(conversionDir, "EphemerisFile1_SIMU.txt")
  const converter = ephemerisConverterFor(settings.simuCicRunner)
  await fs.mkdir(conversionDir, { recursive: true })
  await fs.access(converter).catch(() => {
    throw new Error("OPALIS ephemeris converter is unavailable: " + converter)
  })
  const output = await runCommand(settings.workerPython, [
    nativePath(converter),
    nativePath(ephemeris),
    "--output", nativePath(convertedEphemeris),
    "--json",
  ], runDir, settings.timeoutMs)
  const convertedStat = await fs.stat(convertedEphemeris).catch(() => null)
  if (!convertedStat?.isFile() || convertedStat.size === 0) {
    throw new Error("The GMAT ephemeris conversion did not produce a usable SIMU-CIC file")
  }
  return { convertedEphemeris, output, sourceEphemeris: ephemeris }
}

async function latestScenario(runDir: string) {
  const root = path.join(runDir, "opalis", "02-simu-cic", "01-execution-complete")
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => [])
  const candidates = await Promise.all(entries
    .filter(entry => entry.isFile() && entry.name.endsWith(".scd"))
    .map(async entry => ({ path: path.join(root, entry.name), mtimeMs: (await fs.stat(path.join(root, entry.name))).mtimeMs })))
  return candidates.sort((left, right) => right.mtimeMs - left.mtimeMs)[0]?.path ?? null
}

/** Snapshot the exact Simu-CIC scenario input for this run before execution. */
async function snapshotBaseScenario(settings: ReturnType<typeof requiredSimuCicConfig>, runDir: string) {
  const destination = path.join(runDir, "opalis", "02-simu-cic", "00-scenario-input", "simucic-input.scd")
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.copyFile(settings.baseScenario, destination)
  return destination
}

async function openGui(config: AppConfig, runDir: string) {
  const settings = requiredSimuCicConfig(config)
  if (!settings.celestlabDir) throw new Error("Simu-CIC GUI is not configured: tools.opalis.celestlabDir")
  const scenario = await latestScenario(runDir)
  if (!scenario) throw new Error("Run Simu-CIC first: no generated scenario is available for this GMAT run")
  const template = await fs.readFile(path.join(path.dirname(settings.simuCicRunner), "open_simucic_gui_template.sce"), "utf8")
  const launcher = template
    .replaceAll("__CELESTLAB_LOADER__", nativePath(path.join(settings.celestlabDir, "loader.sce")).replace(/\\/gu, "/"))
    .replaceAll("__SIMUCIC_LOADER__", nativePath(path.join(settings.simucicDir, "loader.sce")).replace(/\\/gu, "/"))
    .replaceAll("__SCENARIO_FILE__", nativePath(scenario).replace(/\\/gu, "/"))
  const launcherPath = path.join(runDir, "opalis", "02-simu-cic", "open_simucic_gui.sce")
  await fs.writeFile(launcherPath, launcher, "utf8")
  // The backend can run under WSL while Scilab itself is a Windows process.
  // Keep a /mnt/c path for WSL's spawn, but normalize it when Node runs on Windows.
  const configuredGuiBin = guiBinFor(settings.scilabBin)
  const guiBin = process.platform === "win32" ? nativePath(configuredGuiBin) : configuredGuiBin
  await new Promise<void>((resolve, reject) => {
    const child = spawn(guiBin, ["-f", nativePath(launcherPath)], { detached: true, stdio: "ignore", windowsHide: false })
    child.once("error", reject)
    child.once("spawn", () => { child.unref(); resolve() })
  })
  return { guiBin, scenario }
}

export async function runSimuCicForRun(config: AppConfig, root: string, runDir: string) {
  const settings = requiredSimuCicConfig(config)
  const gmatResult = JSON.parse(await fs.readFile(path.join(runDir, "gmat_result.json"), "utf8").catch(() => "null")) as { status?: unknown } | null
  const ephemeris = await findGmatEphemeris(runDir)
  if ((gmatResult?.status === "failed" || gmatResult?.status === "timeout") && !ephemeris) {
    throw new Error("GMAT failed for this run. Run GMAT successfully before starting Simu-CIC.")
  }
  await reconcileGmatStatusFromEphemeris(runDir, ephemeris)
  await beginRunStage(runDir, "simu_cic", "Simu-CIC calculation is running.")
  await appendRunConversation(runDir, { answer: "Simu-CIC calculation started.", askedAt: new Date().toISOString(), channel: "simu-cic", question: "Run Simu-CIC" })
  const inputScenario = await snapshotBaseScenario(settings, runDir)
  // Simu-CIC reads the satellite.json saved with this run. A later attitude
  // request is synchronized into that same run file, never taken from an
  // unrelated mutable workspace selection.
  const simuCicDefinition = await writeSimuCicDefinition(runDir, await loadRunDigitalThreadSnapshot(runDir))
  const conversion = await convertGmatEphemeris(settings, runDir)
  const saveRoot = path.join(runDir, "opalis", "02-simu-cic", "01-execution-complete")
  const cicOutput = path.join(runDir, "opalis", "02-simu-cic", "02-fichiers-cic")
  await fs.mkdir(saveRoot, { recursive: true })
  const args = [
    // Simu-CIC requires the GUI runtime of this installation, but its window
    // remains hidden and artifact completion below keeps the pipeline batch.
    nativePath(settings.simuCicRunner), "--gui", "--hide-window",
    "--scilab", nativePath(guiBinFor(settings.scilabBin)),
    "--ephemeris", nativePath(conversion.convertedEphemeris),
    "--simucic-definition", nativePath(simuCicDefinition.output),
    "--simucic-dir", nativePath(settings.simucicDir),
    "--base-scenario", nativePath(inputScenario),
    "--save-root", nativePath(saveRoot),
    "--cic-output", nativePath(cicOutput),
  ]
  const output = await runCommand(settings.workerPython, args, runDir, settings.timeoutMs, async () => {
    const entries = await fs.readdir(saveRoot, { withFileTypes: true }).catch(() => [])
    const completedRun = entries.find(entry => entry.isDirectory() && entry.name.startsWith("run_"))
    if (!completedRun) return false
    const generatedCic = path.join(saveRoot, completedRun.name, "CIC", "Sat")
    const files: string[] = await fs.readdir(generatedCic).catch(() => [])
    // These are the shared minimum inputs read immediately by OPALIS and
    // RF-COMLINK. Waiting for all of them avoids a race with Simu-CIC's
    // incremental writes when the GUI process itself does not exit promptly.
    const requiredFiles = [
      "Sat_SUN_ANGLE_SA_1.TXT", "Sat_SATELLITE_ECLIPSE.TXT", "Sat_EARTH_ANGLE_SA_1.TXT", "Sat_SATELLITE_ALTITUDE.TXT",
      "Sat_EARTH_DIRECTION-SATELLITE_FRAME.TXT", "Sat_GEOGRAPHICAL_COORDINATES.TXT", "Sat_SUN_DIRECTION-SATELLITE_FRAME.TXT",
      "Sat_DISTANCE_GROUND_STATION_1.TXT", "Sat_GEOMETRICAL_VISIBILITY_GROUND_STATION_1.TXT", "Sat_SATELLITE_DIRECTION-GROUND_STATION_1_FRAME.TXT",
    ]
    if (!requiredFiles.every(file => files.includes(file))) return false
    await fs.rm(cicOutput, { force: true, recursive: true }).catch(() => undefined)
    await fs.cp(path.dirname(generatedCic), cicOutput, { recursive: true })
    return true
  })
  const cicSatDir = path.join(cicOutput, "Sat")
  const cicFiles = await fs.readdir(cicSatDir).catch(() => [])
  if (!cicFiles.some(file => file.endsWith(".TXT"))) throw new Error("Simu-CIC completed without producing CIC/Sat files")
  const result = {
    cicSatDir: path.relative(root, cicSatDir), conversionOutput: conversion.output,
    convertedEphemeris: path.relative(root, conversion.convertedEphemeris), sourceEphemeris: path.relative(root, conversion.sourceEphemeris),
    output, inputScenario: relativeToWorkspaceRoot(root, inputScenario), scenarioPath: await latestScenario(runDir), simuCicDefinition: relativeToWorkspaceRoot(root, simuCicDefinition.output),
  }
  await completeRunStage(runDir, "simu_cic", "Simu-CIC completed and generated CIC data.")
  await appendRunConversation(runDir, { answer: `Simu-CIC completed. CIC data generated in ${result.cicSatDir}.`, askedAt: new Date().toISOString(), channel: "simu-cic", question: "Run Simu-CIC" })
  await writeConsolidatedRunReport(runDir)
  return result
}

export async function simuCicRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.get('/api/opalis/rf-comlink/ground-stations', async (_req, reply) => {
    try { return { stations: await listRFComlinkGroundStations() } }
    catch { return reply.status(503).send({ error: 'RF-COMLINK ground-station database is unavailable. Check RF_COMLINK_HOME.' }) }
  })
  fastify.get("/api/opalis/simu-cic/ground-stations", async () => ({
    stations: PREDEFINED_GROUND_STATIONS,
  }))

  fastify.post<{ Body: RunBody }>("/api/opalis/workflow-status", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveGmatRunDir(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    return reply.send({ workflow: await loadRunWorkflowLog(runDir) })
  })

  fastify.post<{ Body: RunBody }>("/api/gmat/cancel-calculations", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root && req.body?.runPath ? resolveGmatRunDir(root, req.body.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (req.body?.runPath && !runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    const cancelled = cancelActiveCalculations(root, runDir)
    if (runDir) {
      const workflow = await loadRunWorkflowLog(runDir)
      for (const stage of ["simu_cic", "opalis", "rf_comlink"] as const) {
        if (workflow.stages[stage].status === "running") await failRunStage(runDir, stage, "Stopped by the user.")
      }
    }
    return reply.send({ cancelled })
  })

  fastify.post<{ Body: RunBody }>("/api/opalis/simu-cic/convert-ephemeris", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveGmatRunDir(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      const conversion = await convertGmatEphemeris(requiredSimuCicConfig(config), runDir)
      return reply.send({
        convertedEphemeris: path.relative(root, conversion.convertedEphemeris),
        output: conversion.output,
        sourceEphemeris: path.relative(root, conversion.sourceEphemeris),
      })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to convert the GMAT ephemeris") })
    }
  })

  fastify.post<{ Body: RunBody }>("/api/opalis/simu-cic/run", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveGmatRunDir(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    if (!acquireMissionPipelineLock(runDir, "simu_cic")) return reply.status(409).send({ error: "Simu-CIC is already running for this mission run" })
    try {
      return reply.send(await runSimuCicForRun(config, root, runDir))
    } catch (error) {
      const message = getErrorMessage(error, "failed to run Simu-CIC")
      await failRunStage(runDir, "simu_cic", message).catch(() => undefined)
      await writeConsolidatedRunReport(runDir).catch(() => undefined)
      return reply.status(422).send({ error: message })
    } finally { releaseMissionPipelineLock(runDir, "simu_cic") }
  })

  fastify.post<{ Body: RunBody }>("/api/opalis/simu-cic/open-gui", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveGmatRunDir(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      return reply.send({ ok: true, ...(await openGui(config, runDir)) })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to open Simu-CIC GUI") })
    }
  })
}
