import { spawn } from "node:child_process"

import { registerActiveCalculation, unregisterActiveCalculation } from "./activeCalculationRegistry.js"

export async function runManagedProcess({ args, command, cwd, timeoutMs }: { args: string[]; command: string; cwd: string; timeoutMs: number }) {
  const chunks: Buffer[] = []
  let timedOut = false
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    const child = spawn(command, args, { cwd, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
    registerActiveCalculation(cwd, child)
    let settled = false
    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      unregisterActiveCalculation(cwd, child)
      callback()
    }
    const terminate = () => {
      if (process.platform !== "win32" && child.pid) {
        try { process.kill(-child.pid, "SIGKILL"); return } catch { /* fall through */ }
      }
      child.kill("SIGKILL")
    }
    child.stdout?.on("data", chunk => chunks.push(Buffer.from(chunk)))
    child.stderr?.on("data", chunk => chunks.push(Buffer.from(chunk)))
    const timer = setTimeout(() => {
      timedOut = true
      finish(() => { terminate(); resolve(null) })
    }, timeoutMs)
    child.once("error", error => finish(() => reject(error)))
    child.once("close", code => finish(() => resolve(code)))
  }).catch(error => { chunks.push(Buffer.from(error instanceof Error ? error.stack ?? error.message : String(error))); return null })
  return { exitCode, output: Buffer.concat(chunks), timedOut }
}
