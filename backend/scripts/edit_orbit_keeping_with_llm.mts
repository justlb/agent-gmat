import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { stringify } from "yaml"

import { loadConfig } from "../src/config.js"
import { editOrbitKeepingValuesWithLlm } from "../src/gmat/orbitKeepingLlmEdit.js"
import { parseOrbitKeepingValues, renderOrbitKeepingFromValues } from "../src/gmat/orbitKeepingValues.js"
import { resolveModelBackend } from "../src/modelBackends/modelBackends.js"

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const projectRoot = path.resolve(backendRoot, "..")
const referencesDir = path.join(backendRoot, "workflow_agents", "gmat_skills", "orbit-keeping-template", "references")
const outputDir = path.join(projectRoot, "data", "output_data")

function readOption(name: string, required = false) {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    if (required) throw new Error(`${name} is required`)
    return undefined
  }
  const value = process.argv[index + 1]
  if (!value) throw new Error(`${name} requires a value`)
  return value
}

const request = readOption("--request", true)!
const sourceValuesPath = path.resolve(readOption("--values") ?? path.join(referencesDir, "orbit_keeping.values.yaml"))
const outputValuesPath = path.resolve(readOption("--output-values") ?? path.join(outputDir, "orbit_keeping.values.modified.yaml"))
const outputScriptPath = path.resolve(readOption("--output-script") ?? path.join(outputDir, "mission.script"))

const values = parseOrbitKeepingValues(await fs.readFile(sourceValuesPath, "utf8"))
const connection = resolveModelBackend(loadConfig(), "chatModel")
const result = await editOrbitKeepingValuesWithLlm({ connection, request, values })

await fs.mkdir(path.dirname(outputValuesPath), { recursive: true })
await fs.writeFile(outputValuesPath, stringify(result.values), "utf8")
await renderOrbitKeepingFromValues({ valuesPath: outputValuesPath, outputPath: outputScriptPath })

process.stdout.write(`${JSON.stringify({ changes: result.changes, latencyMs: result.latencyMs, outputScriptPath, outputValuesPath }, null, 2)}\n`)
