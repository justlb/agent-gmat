import path from "node:path"
import { fileURLToPath } from "node:url"

import { renderOrbitKeepingFromValues } from "../src/gmat/orbitKeepingValues.js"

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const referencesDir = path.join(
  backendRoot,
  "workflow_agents",
  "gmat_skills",
  "orbit-keeping-template",
  "references",
)

function readOption(name: string) {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (!value) throw new Error(`${name} requires a path`)
  return path.resolve(value)
}

const valuesPath = readOption("--values") ?? path.join(referencesDir, "orbit_keeping.values.yaml")
const outputPath = readOption("--output") ?? path.join(backendRoot, "output", "mission.script")

const result = await renderOrbitKeepingFromValues({ outputPath, valuesPath })
process.stdout.write(`Wrote ${result.bytesWritten} bytes to ${result.outputPath}\n`)
