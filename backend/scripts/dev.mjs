import { spawn } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const tsxCli = path.join(backendRoot, "node_modules", "tsx", "dist", "cli.mjs")

// Codex can edit files from Windows while the application runs in WSL.
// Polling makes backend reloads as reliable as the Vite frontend watcher.
const child = spawn(process.execPath, [tsxCli, "watch", "src/index.ts"], {
  cwd: backendRoot,
  env: {
    ...process.env,
    CHOKIDAR_INTERVAL: process.env.CHOKIDAR_INTERVAL ?? "500",
    CHOKIDAR_USEPOLLING: "1",
  },
  stdio: "inherit",
})

child.once("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0)
})

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal))
}
