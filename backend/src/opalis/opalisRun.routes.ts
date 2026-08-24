import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { FastifyInstance } from "fastify"

import type { AppConfig } from "../config.js"
import { toGmatNativePath } from "../gmat/orbitKeepingRunner.js"
import { snapshotRunArtifacts } from "../gmat/artifactHistory.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage } from "../shared/index.js"
import { prepareOpalisInputs } from "./opalisPreparation.routes.js"
import { loadOpalisResultSummary } from "./opalisResults.js"
import { appendRunConversation } from "../digitalThread/missionConversationStore.js"
import { writeConsolidatedRunReport } from "./consolidatedRunReport.js"
import { loadRunWorkflowLog } from "./workflowRunLog.js"
import { beginRunStage, completeRunStage, failRunStage } from "../runs/runLifecycle.js"
import { registerActiveCalculation, unregisterActiveCalculation } from "../gmat/activeCalculationRegistry.js"
import { resolveMissionRun } from "../runs/runWorkspace.js"

type RunBody = { runPath?: unknown }

const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SOURCE_DIR, "../../..")
const PIPELINE = path.join(PROJECT_ROOT, "tools", "workflow_OPALIS", "workflow_OPALIS", "3-run_OPALIS", "opalis_pipeline.py")
const EMPTY_TEMPLATE = path.join(path.dirname(PIPELINE), "templates", "empty.opalis")

function resolveGmatRunDir(root: string, candidate: unknown) {
  return resolveMissionRun(root, candidate)?.runDir ?? null
}

function nativePath(filePath: string) { return toGmatNativePath(filePath) }

function opalisInputProblem(action: "prepared" | "run", inputs: { validation: { missing: string[]; warnings: string[] } }) {
  const missing = inputs.validation.missing.filter(Boolean)
  if (missing.length === 1 && missing[0] === "digital_thread.satellite_definition") {
    return `OPALIS cannot be ${action} yet. No satellite is selected for this dated mission. Choose a compatible satellite first; its OPALIS electrical model will then be written to this run's satellite.json.`
  }
  if (missing.length) return `OPALIS cannot be ${action} yet. Missing data: ${missing.join(", ")}`
  // Defensive fallback for old or externally-created validation snapshots.
  // A non-ready result must always explain what is blocking it.
  const warnings = inputs.validation.warnings.filter(Boolean)
  return warnings.length
    ? `OPALIS cannot be ${action} yet. Configuration checks to resolve: ${warnings.join("; ")}`
    : `OPALIS cannot be ${action} yet. The OPALIS input validation returned no blocking detail.`
}

function requiredOpalisConfig(config: AppConfig) {
  const tool = config.tools.opalis
  const required: Array<[string, string | null]> = [
    ["tools.opalis.workerPython", tool.workerPython],
    ["tools.opalis.installationDir", tool.installationDir],
  ]
  const missing = required.filter(([, value]) => !value).map(([name]) => name)
  if (missing.length) throw new Error("OPALIS is not configured: " + missing.join(", "))
  return { installationDir: tool.installationDir!, timeoutMs: tool.timeoutMs, workerPython: tool.workerPython! }
}

function runCommand(executable: string, args: string[], cwd: string, timeoutMs: number, operation: "preparation" | "calculation") {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(executable, args, { cwd, detached: process.platform !== "win32", windowsHide: true })
    registerActiveCalculation(cwd, child)
    let output = ""
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unregisterActiveCalculation(cwd, child)
      callback()
    }
    const terminate = () => {
      // The OPALIS worker is Python hosting .NET. On POSIX/WSL, killing only
      // Python can leave the hosted calculation alive, so terminate its group.
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); return } catch { /* fall through */ }
      }
      child.kill("SIGKILL")
    }
    child.stdout.on("data", chunk => { output += String(chunk) })
    child.stderr.on("data", chunk => { output += String(chunk) })
    const timer = setTimeout(() => finish(() => {
      terminate()
      reject(new Error(`OPALIS ${operation} timed out after ${timeoutMs} ms`))
    }), timeoutMs)
    child.once("error", error => finish(() => reject(error)))
    child.once("close", code => {
      finish(() => {
        if (code === 0) resolve(output)
        else reject(new Error(`OPALIS ${operation} failed with code ${code}: ${output.slice(-2_000)}`))
      })
    })
  })
}

export async function opalisRunRoutes(fastify: FastifyInstance, { config }: { config: AppConfig }) {
  fastify.get<{ Querystring: { runPath?: unknown } }>("/api/opalis/results", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveGmatRunDir(path.resolve(root), req.query?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      const result = await loadOpalisResultSummary(runDir)
      if (!result) return reply.status(404).send({ error: "No calculated OPALIS results are available for this GMAT run" })
      return reply.send({ result })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to load OPALIS results") })
    }
  })

  fastify.post<{ Body: RunBody }>("/api/opalis/prepare-scenario", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveGmatRunDir(path.resolve(root), req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      const workflow = await loadRunWorkflowLog(runDir)
      if (workflow.stages.simu_cic.status !== "completed") throw new Error("Run Simu-CIC first. OPALIS requires CIC files generated with the current attitude configuration.")
      const settings = requiredOpalisConfig(config)
      const inputs = await prepareOpalisInputs(path.resolve(root), runDir)
      if (inputs.validation.status !== "ready") {
        throw new Error(opalisInputProblem("prepared", inputs))
      }
      await fs.access(PIPELINE)
      await fs.access(EMPTY_TEMPLATE)
      await fs.access(path.join(settings.installationDir, "lib", "OpalisApi.dll"))
      await snapshotRunArtifacts(runDir, "opalis-preparation", [
        "opalis/03-opalis/02-resultats/prepared-opalis.opalis",
        "opalis/03-opalis/02-resultats/prepared-opalis.json",
      ])
      const outputDir = path.join(runDir, "opalis", "03-opalis")
      const runName = "prepared-opalis"
      const output = await runCommand(settings.workerPython, [
        nativePath(PIPELINE),
        nativePath(EMPTY_TEMPLATE),
        "--parameters-file", nativePath(inputs.outputPath),
        "--ephemeris-dir", nativePath(inputs.cicDirectory),
        "--opalis-dir", nativePath(settings.installationDir),
        "--output-dir", nativePath(outputDir),
        "--name", runName,
        "--no-run",
      ], runDir, settings.timeoutMs, "preparation")
      const scenario = path.join(outputDir, "02-resultats", `${runName}.opalis`)
      const summary = path.join(outputDir, "02-resultats", `${runName}.json`)
      const scenarioStat = await fs.stat(scenario).catch(() => null)
      if (!scenarioStat?.isFile() || scenarioStat.size === 0) throw new Error("OPALIS did not create the prepared scenario")
      return reply.send({
        scenario: path.relative(root, scenario),
        summary: path.relative(root, summary),
        parameters: inputs.output,
        output,
      })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to prepare OPALIS scenario") })
    }
  })

  fastify.post<{ Body: RunBody }>("/api/opalis/run-scenario", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveGmatRunDir(path.resolve(root), req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    let opalisStarted = false
    try {
      const workflow = await loadRunWorkflowLog(runDir)
      if (workflow.stages.simu_cic.status !== "completed") throw new Error("Run Simu-CIC first. OPALIS requires CIC files generated with the current attitude configuration.")
      const settings = requiredOpalisConfig(config)
      const inputs = await prepareOpalisInputs(path.resolve(root), runDir)
      if (inputs.validation.status !== "ready") {
        throw new Error(`${opalisInputProblem("run", inputs)} Run Simu-CIC first to generate the required CIC files.`)
      }
      await beginRunStage(runDir, "opalis", "OPALIS calculation is running using existing Simu-CIC CIC output.")
      opalisStarted = true
      await appendRunConversation(runDir, { answer: "OPALIS calculation started using the existing Simu-CIC CIC output.", askedAt: new Date().toISOString(), channel: "opalis", question: "Run OPALIS calculation" })
      await fs.access(PIPELINE)
      await fs.access(EMPTY_TEMPLATE)
      await fs.access(path.join(settings.installationDir, "lib", "OpalisApi.dll"))
      await snapshotRunArtifacts(runDir, "opalis", [
        "opalis/03-opalis/02-resultats/calculated-opalis.opalis",
        "opalis/03-opalis/02-resultats/calculated-opalis.json",
        "consolidated-run-report.json",
      ])
      const outputDir = path.join(runDir, "opalis", "03-opalis")
      const runName = "calculated-opalis"
      const output = await runCommand(settings.workerPython, [
        nativePath(PIPELINE),
        nativePath(EMPTY_TEMPLATE),
        "--parameters-file", nativePath(inputs.outputPath),
        "--ephemeris-dir", nativePath(inputs.cicDirectory),
        "--opalis-dir", nativePath(settings.installationDir),
        "--output-dir", nativePath(outputDir),
        "--name", runName,
      ], runDir, settings.timeoutMs, "calculation")
      const scenario = path.join(outputDir, "02-resultats", `${runName}.opalis`)
      const summary = path.join(outputDir, "02-resultats", `${runName}.json`)
      const scenarioStat = await fs.stat(scenario).catch(() => null)
      const summaryStat = await fs.stat(summary).catch(() => null)
      if (!scenarioStat?.isFile() || scenarioStat.size === 0 || !summaryStat?.isFile() || summaryStat.size === 0) {
        throw new Error("OPALIS did not create the calculated scenario and summary")
      }
      const result = {
        scenario: path.relative(root, scenario),
        summary: path.relative(root, summary),
        parameters: inputs.output,
        output,
      }
      const consolidated = await writeConsolidatedRunReport(runDir)
      await completeRunStage(runDir, "opalis", "OPALIS calculation completed.")
      await appendRunConversation(runDir, { answer: `OPALIS calculation completed. Results saved to ${result.summary}.`, askedAt: new Date().toISOString(), channel: "opalis", question: "Run OPALIS calculation" })
      return reply.send({ ...result, consolidatedReport: path.relative(root, consolidated.output) })
    } catch (error) {
      if (opalisStarted) await failRunStage(runDir, "opalis", getErrorMessage(error, "failed to run OPALIS scenario")).catch(() => undefined)
      return reply.status(422).send({ error: getErrorMessage(error, "failed to run OPALIS scenario") })
    }
  })

  fastify.post<{ Body: RunBody }>("/api/opalis/open-prepared-scenario", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveGmatRunDir(path.resolve(root), req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      const { installationDir } = requiredOpalisConfig(config)
      const gui = path.join(installationDir, "Opalis.exe")
      const resultsDir = path.join(runDir, "opalis", "03-opalis", "02-resultats")
      const calculatedScenario = path.join(resultsDir, "calculated-opalis.opalis")
      const preparedScenario = path.join(resultsDir, "prepared-opalis.opalis")
      await fs.access(gui)
      const scenario = (await fs.stat(calculatedScenario).catch(() => null))?.isFile()
        ? calculatedScenario
        : preparedScenario
      const stat = await fs.stat(scenario).catch(() => null)
      if (!stat?.isFile() || stat.size === 0) throw new Error("Prepare the OPALIS scenario first for this GMAT run")
      // The backend normally runs under WSL. In that case Node must spawn the
      // Linux-mounted executable path (/mnt/d/...), not its D:\\ equivalent.
      // The Windows conversion remains necessary only when the backend itself
      // is running on Windows.
      const executable = process.platform === "win32" ? nativePath(gui) : gui
      // Opalis.exe is a Windows application even when WSL starts it through
      // interop, so its command-line file argument must always be Windows.
      const scenarioArgument = nativePath(scenario)
      await new Promise<void>((resolve, reject) => {
        const child = spawn(executable, [scenarioArgument], { detached: true, stdio: "ignore", windowsHide: false })
        child.once("error", reject)
        child.once("spawn", () => { child.unref(); resolve() })
      })
      return reply.send({ ok: true, scenario: path.relative(root, scenario) })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to open OPALIS GUI") })
    }
  })
}
