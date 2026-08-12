import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import { toGmatNativePath } from "../gmat/orbitKeepingRunner.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { PREDEFINED_GROUND_STATIONS } from "./groundStationCatalog.js"
import { loadRunDigitalThreadSnapshot } from "../digitalThread/digitalThreadStore.js"
import { writeSimuCicDefinition } from "./simuCicDefinition.js"

type RunBody = { runPath?: unknown }

function resolveGmatRunDir(userWorkspaceRoot: string, runPath: unknown) {
  if (typeof runPath !== "string" || !runPath.trim()) return null
  const root = path.resolve(userWorkspaceRoot)
  const runDir = path.resolve(root, runPath)
  const normalized = runDir.split(path.sep).join("/")
  if (!isPathInside(root, runDir) || !/\/gmat\/(?:orbit-keeping|electric-propulsion-transfer)\/[^/]+$/u.test(normalized)) return null
  return runDir
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

async function runCommand(executable: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true })
    let output = ""
    child.stdout.on("data", chunk => { output += String(chunk) })
    child.stderr.on("data", chunk => { output += String(chunk) })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error("Simu-CIC timed out after " + timeoutMs + " ms"))
    }, timeoutMs)
    child.once("error", error => { clearTimeout(timer); reject(error) })
    child.once("close", code => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else reject(new Error("Simu-CIC failed with code " + code + ": " + output.slice(-2_000)))
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

export async function simuCicRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.get("/api/opalis/simu-cic/ground-stations", async () => ({
    stations: PREDEFINED_GROUND_STATIONS,
  }))

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
    try {
      const settings = requiredSimuCicConfig(config)
      // Simu-CIC must use the exact satellite/mission state that generated this
      // GMAT run, never the mutable workspace-level selection.
      const simuCicDefinition = await writeSimuCicDefinition(runDir, await loadRunDigitalThreadSnapshot(runDir))
      const conversion = await convertGmatEphemeris(settings, runDir)
      const saveRoot = path.join(runDir, "opalis", "02-simu-cic", "01-execution-complete")
      const cicOutput = path.join(runDir, "opalis", "02-simu-cic", "02-fichiers-cic")
      await fs.mkdir(saveRoot, { recursive: true })
      const args = [
        nativePath(settings.simuCicRunner), "--gui", "--hide-window",
        "--scilab", nativePath(guiBinFor(settings.scilabBin)),
        "--ephemeris", nativePath(conversion.convertedEphemeris),
        "--simucic-definition", nativePath(simuCicDefinition.output),
        "--simucic-dir", nativePath(settings.simucicDir),
        "--base-scenario", nativePath(settings.baseScenario),
        "--save-root", nativePath(saveRoot),
        "--cic-output", nativePath(cicOutput),
      ]
      const output = await runCommand(settings.workerPython, args, runDir, settings.timeoutMs)
      const cicSatDir = path.join(cicOutput, "Sat")
      const cicFiles = await fs.readdir(cicSatDir).catch(() => [])
      if (!cicFiles.some(file => file.endsWith(".TXT"))) throw new Error("Simu-CIC completed without producing CIC/Sat files")
      return reply.send({
        cicSatDir: path.relative(root, cicSatDir),
        conversionOutput: conversion.output,
        convertedEphemeris: path.relative(root, conversion.convertedEphemeris),
        sourceEphemeris: path.relative(root, conversion.sourceEphemeris),
        output,
        scenarioPath: await latestScenario(runDir),
        simuCicDefinition: path.relative(root, simuCicDefinition.output),
      })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to run Simu-CIC") })
    }
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
