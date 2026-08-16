import fs from "node:fs/promises"
import path from "node:path"

import type { FastifyInstance } from "fastify"

import { loadRunDigitalThreadSnapshot } from "../digitalThread/digitalThreadStore.js"
import { getRequestUserWorkspaceRoot } from "../server/requestContext.js"
import { getErrorMessage, isPathInside } from "../shared/index.js"
import { adaptDigitalThreadToOpalis } from "./opalisDigitalThreadAdapter.js"

type RunBody = { runPath?: unknown }

const REQUIRED_CIC_FILES = [
  "Sat_SUN_ANGLE_SA_1.TXT", "Sat_SATELLITE_ECLIPSE.TXT", "Sat_EARTH_ANGLE_SA_1.TXT", "Sat_SATELLITE_ALTITUDE.TXT",
  "Sat_EARTH_DIRECTION-SATELLITE_FRAME.TXT", "Sat_GEOGRAPHICAL_COORDINATES.TXT",
] as const

function resolveGmatRunDir(root: string, candidate: unknown) {
  if (typeof candidate !== "string" || !candidate.trim()) return null
  const runDir = path.resolve(root, candidate)
  const normalized = runDir.split(path.sep).join("/")
  return isPathInside(root, runDir) && /\/gmat\/(?:orbit-keeping|electric-propulsion-transfer|mission-runs)\/[^/]+$/u.test(normalized) ? runDir : null
}

async function cicValidation(runDir: string) {
  const cicDirectory = path.join(runDir, "opalis", "02-simu-cic", "02-fichiers-cic", "Sat")
  const entries = await fs.readdir(cicDirectory, { withFileTypes: true }).catch(() => [])
  const names = new Set(entries.filter(entry => entry.isFile()).map(entry => entry.name))
  const missing: string[] = REQUIRED_CIC_FILES.filter(name => !names.has(name))
  const hasSunDirection = names.has("Sat_SUN_DIRECTION-SATELLITE_FRAME.TXT") || names.has("Sat_SUN_DIRECTION-ORBITAL_FRAME.TXT")
  if (!hasSunDirection) missing.push("Sat_SUN_DIRECTION-SATELLITE_FRAME.TXT or Sat_SUN_DIRECTION-ORBITAL_FRAME.TXT")
  return { cicDirectory, missing }
}

export async function prepareOpalisInputs(root: string, runDir: string) {
  const staticInputs = adaptDigitalThreadToOpalis(await loadRunDigitalThreadSnapshot(runDir))
  const cic = await cicValidation(runDir)
  const validation = {
    missing: [...staticInputs.validation.missing, ...cic.missing.map(name => `CIC/Sat/${name}`)],
    status: staticInputs.validation.status === "ready" && !cic.missing.length ? "ready" as const : "blocked" as const,
    warnings: staticInputs.validation.warnings,
  }
  const output = {
    ...staticInputs,
    source_cic_directory: path.relative(runDir, cic.cicDirectory).split(path.sep).join("/"),
    validation,
  }
  const outputPath = path.join(runDir, "opalis", "02-opalis-input", "opalis-parameters.json")
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8")
  return { ...output, output: path.relative(root, outputPath), outputPath, cicDirectory: cic.cicDirectory }
}

export async function opalisPreparationRoutes(fastify: FastifyInstance) {
  fastify.post<{ Body: RunBody }>("/api/opalis/prepare", async (req, reply) => {
    const root = getRequestUserWorkspaceRoot()
    const runDir = root ? resolveGmatRunDir(path.resolve(root), req.body?.runPath) : null
    if (!root) return reply.status(500).send({ error: "user workspace is unavailable" })
    if (!runDir) return reply.status(400).send({ error: "invalid GMAT run path" })
    try {
      return reply.send(await prepareOpalisInputs(path.resolve(root), runDir))
    } catch (error) {
      return reply.status(422).send({ error: getErrorMessage(error, "failed to prepare OPALIS inputs") })
    }
  })
}
