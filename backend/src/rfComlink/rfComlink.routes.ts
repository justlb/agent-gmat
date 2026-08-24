import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { FastifyInstance } from "fastify"

import { toGmatNativePath } from "../gmat/orbitKeepingRunner.js"
import { snapshotRunArtifacts } from "../gmat/artifactHistory.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage } from "../shared/index.js"
import { appendRunConversation } from "../digitalThread/missionConversationStore.js"
import { beginRunStage, completeRunStage, failRunStage } from "../runs/runLifecycle.js"
import { writeRunAnalysisContext } from "../analysis/runAnalysisContext.js"
import { prepareRFComlinkScenario } from "./rfComlinkPreparation.routes.js"
import { resolveMissionRun, relativeToWorkspaceRoot } from "../runs/runWorkspace.js"
import { artifactDefinitionForPath } from "../runs/artifactRegistry.js"

type RunBody = { runPath?: unknown }
const SOURCE_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SOURCE_DIR, "../../..")

/**
 * RF-COMLINK 1.1.1 is a WPF application.  It accepts a single .rfcl file as
 * its startup argument, but has no supported batch interface.  Keeping this
 * launcher here means the web application never asks the user to browse for
 * the generated scenario manually.
 */
function rfComlinkHomeForHost() {
  const configured = process.env.RF_COMLINK_HOME?.trim() || "D:\\STAGE\\APP\\rf-comlink"
  if (process.platform === "win32") return configured
  const normalized = configured.replace(/\\/gu, "/")
  const windowsPath = /^([a-z]):\/(.*)$/iu.exec(normalized)
  return windowsPath ? `/mnt/${windowsPath[1].toLowerCase()}/${windowsPath[2]}` : configured
}

async function resolveScenario(runDir: string) {
  // The generator added in the next RF-COMLINK step will write these exact
  // paths. Prefer the calculated file so reopening an old run restores its
  // latest state, otherwise open its prepared input scenario.
  const candidates = [
    path.join(runDir, "rf-comlink", "03-results", "calculated-rf-comlink.rfcl"),
    path.join(runDir, "rf-comlink", "02-scenario", "prepared-rf-comlink.rfcl"),
  ]
  for (const candidate of candidates) {
    const stat = await fs.stat(candidate).catch(() => null)
    if (stat?.isFile() && stat.size > 0) return candidate
  }
  return null
}

function calculatedScenarioPath(runDir: string) {
  return path.join(runDir, "rf-comlink", "03-results", "calculated-rf-comlink.rfcl")
}

async function sha256(filePath: string) {
  return createHash("sha256").update(await fs.readFile(filePath)).digest("hex")
}

function runProcess(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", chunk => { stdout += chunk })
    child.stderr.on("data", chunk => { stderr += chunk })
    child.once("error", reject)
    child.once("close", code => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code ?? "unknown"}`)))
  })
}

function powerShellExecutable() {
  return process.platform === "win32" ? "powershell.exe" : "powershell.exe"
}

async function openScenario(executable: string, scenario: string) {
  const child = spawn(executable, [toGmatNativePath(scenario)], { detached: true, stdio: "ignore", windowsHide: false })
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject)
    child.once("spawn", () => { child.unref(); resolve() })
  })
}

export async function rfComlinkRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: RunBody }>("/api/rf-comlink/open-gui", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const run = root ? resolveMissionRun(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!run) return reply.status(400).send({ error: "invalid GMAT run path" })

    try {
      const scenario = await resolveScenario(run.runDir)
      if (!scenario) {
        throw new Error("Prepare the RF-COMLINK scenario first for this GMAT run")
      }
      const executable = path.join(rfComlinkHomeForHost(), "rf-comlink.exe")
      await fs.access(executable)

      // WSL starts the Windows executable through interop, but RF-COMLINK
      // itself requires the input path in native Windows notation.
      await openScenario(executable, scenario)
      return reply.send({ ok: true, scenario: relativeToWorkspaceRoot(root, scenario) })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to open RF-COMLINK GUI") })
    }
  })

  fastify.post<{ Body: RunBody }>("/api/rf-comlink/start-calculation", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const run = root ? resolveMissionRun(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!run) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      const prepared = path.join(run.runDir, "rf-comlink", "02-scenario", "prepared-rf-comlink.rfcl")
      await fs.access(prepared)
      const calculated = calculatedScenarioPath(run.runDir)
      await snapshotRunArtifacts(run.runDir, "rf-comlink", [
        "rf-comlink/03-results/calculated-rf-comlink.rfcl",
        "rf-comlink/03-results/rf-comlink-results.json",
      ])
      await fs.mkdir(path.dirname(calculated), { recursive: true })
      await fs.copyFile(prepared, calculated)
      const executable = path.join(rfComlinkHomeForHost(), "rf-comlink.exe")
      await fs.access(executable)
      await openScenario(executable, calculated)
      await beginRunStage(run.runDir, "rf_comlink", "RF-COMLINK calculation opened. Calculate, then save the scenario before recording its results.")
      return reply.send({ ok: true, scenario: relativeToWorkspaceRoot(root, calculated) })
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to start RF-COMLINK calculation") })
    }
  })

  /**
   * One deterministic RF-COMLINK action for the active run.  It deliberately
   * creates a run-local working copy, saves the calculated package there, and
   * immediately extracts the reports for the mission assistant.
   */
  fastify.post<{ Body: RunBody }>("/api/rf-comlink/run", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const run = root ? resolveMissionRun(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!run) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      const prepared = await prepareRFComlinkScenario(run.root, run.runDir)
      const calculated = calculatedScenarioPath(run.runDir)
      const resultDir = path.dirname(calculated)
      const logPath = path.join(resultDir, "rf-comlink-calculation.log")
      await snapshotRunArtifacts(run.runDir, "rf-comlink", [
        "rf-comlink/03-results/calculated-rf-comlink.rfcl",
        "rf-comlink/03-results/rf-comlink-results.json",
        "rf-comlink/03-results/rf-comlink-calculation.log",
      ])
      await fs.mkdir(resultDir, { recursive: true })
      await fs.copyFile(prepared.scenarioPath, calculated)
      const executable = path.join(rfComlinkHomeForHost(), "rf-comlink.exe")
      await fs.access(executable)
      const automation = path.join(PROJECT_ROOT, "tools", "workflow_RF-COMLINK", "04-run-calculation", "run_rfcomlink_calculation.ps1")
      const waitSeconds = Math.max(1, Number.parseInt(process.env.RF_COMLINK_WAIT_SECONDS ?? "5", 10) || 5)
      await beginRunStage(run.runDir, "rf_comlink", "RF-COMLINK calculation is running for this mission run.")
      let output = ""
      try {
        output = await runProcess(powerShellExecutable(), ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", toGmatNativePath(automation), "-CasePath", toGmatNativePath(calculated), "-ApplicationPath", toGmatNativePath(executable), "-WaitSeconds", String(waitSeconds)])
      } catch (error) {
        await fs.writeFile(logPath, `RF-COMLINK automation failed.\n${getErrorMessage(error, "unknown error")}\n`, "utf8")
        throw error
      }
      await fs.writeFile(logPath, output || "RF-COMLINK completed without console output.\n", "utf8")
      const summaryPath = path.join(resultDir, "rf-comlink-results.json")
      const extractScript = path.join(PROJECT_ROOT, "tools", "workflow_RF-COMLINK", "03-save-results", "extract_rf_comlink_results.py")
      const python = process.env.RF_COMLINK_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3")
      await runProcess(python, [extractScript, "--scenario", calculated, "--output", summaryPath])
      const summary = JSON.parse(await fs.readFile(summaryPath, "utf8")) as { reports?: unknown[] }
      const reportCount = Array.isArray(summary.reports) ? summary.reports.length : 0
      await completeRunStage(run.runDir, "rf_comlink", `RF-COMLINK completed with ${reportCount} report(s).`)
      await appendRunConversation(run.runDir, { answer: `RF-COMLINK completed for this run. ${reportCount} report(s) were extracted and the raw calculated .rfcl package is saved in Technical files.`, askedAt: new Date().toISOString(), channel: "rf-comlink", question: "Run RF-COMLINK" })
      await writeRunAnalysisContext(run.runDir)
      return reply.send({ ok: true, reportCount, scenario: relativeToWorkspaceRoot(root, calculated), summary: relativeToWorkspaceRoot(root, summaryPath), artifacts: ["rf-comlink/03-results/calculated-rf-comlink.rfcl", "rf-comlink/03-results/rf-comlink-results.json", "rf-comlink/03-results/rf-comlink-calculation.log"].map(artifactDefinitionForPath).filter(Boolean) })
    } catch (error) {
      const message = getErrorMessage(error, "failed to run RF-COMLINK")
      await failRunStage(run.runDir, "rf_comlink", message).catch(() => undefined)
      return reply.status(422).send({ error: message })
    }
  })

  fastify.post<{ Body: RunBody }>("/api/rf-comlink/save-results", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const run = root ? resolveMissionRun(root, req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!run) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      const prepared = path.join(run.runDir, "rf-comlink", "02-scenario", "prepared-rf-comlink.rfcl")
      const calculated = calculatedScenarioPath(run.runDir)
      const [preparedHash, calculatedHash] = await Promise.all([sha256(prepared), sha256(calculated)])
      if (preparedHash === calculatedHash) throw new Error("RF-COMLINK results have not been saved yet. Run the calculation in RF-COMLINK and save the opened scenario first.")
      const summaryPath = path.join(run.runDir, "rf-comlink", "03-results", "rf-comlink-results.json")
      const script = path.join(PROJECT_ROOT, "tools", "workflow_RF-COMLINK", "03-save-results", "extract_rf_comlink_results.py")
      const python = process.env.RF_COMLINK_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3")
      await runProcess(python, [script, "--scenario", calculated, "--output", summaryPath])
      const summary = JSON.parse(await fs.readFile(summaryPath, "utf8")) as { reports?: unknown[] }
      const reportCount = Array.isArray(summary.reports) ? summary.reports.length : 0
      await completeRunStage(run.runDir, "rf_comlink", `Saved RF-COMLINK calculation with ${reportCount} report(s).`)
      await appendRunConversation(run.runDir, { answer: `RF-COMLINK results were saved with ${reportCount} report(s). You can now ask about link budget, availability, telemetry, or telecommand results.`, askedAt: new Date().toISOString(), channel: "rf-comlink", question: "Save RF-COMLINK results" })
      await writeRunAnalysisContext(run.runDir)
      return reply.send({ ok: true, reportCount, summary: relativeToWorkspaceRoot(root, summaryPath) })
    } catch (error) {
      const message = getErrorMessage(error, "failed to save RF-COMLINK results")
      return reply.status(422).send({ error: message })
    }
  })
}
