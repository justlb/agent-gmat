import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { stringify } from "yaml"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { editOrbitKeepingValuesWithLlm, type OrbitKeepingLlmEditResult } from "./orbitKeepingLlmEdit.js"
import { defaultOrbitKeepingTemplatePath } from "./orbitKeepingTemplate.js"
import { parseOrbitKeepingValues, renderOrbitKeepingValues } from "./orbitKeepingValues.js"

export type GenerateOrbitKeepingMissionResult = Pick<OrbitKeepingLlmEditResult, "changes" | "latencyMs"> & {
  scriptPath: string
  valuesPath: string
}

function defaultOrbitKeepingValuesPath(projectRoot = process.cwd()) {
  return path.join(
    projectRoot,
    "workflow_agents",
    "gmat_skills",
    "orbit-keeping-template",
    "references",
    "orbit_keeping.values.yaml",
  )
}

/**
 * Generates GMAT artefacts from the immutable Keplerian template.
 *
 * The only non-deterministic operation is the single LLM request.  Files are
 * materialised only after that request and all deterministic validation pass.
 */
export async function generateOrbitKeepingMission({
  connection,
  request,
  workspaceDir,
  fetchImpl,
  templatePath = defaultOrbitKeepingTemplatePath(),
  valuesPath = defaultOrbitKeepingValuesPath(),
  artifactId = randomUUID(),
}: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">
  request: string
  workspaceDir: string
  fetchImpl?: typeof fetch
  templatePath?: string
  valuesPath?: string
  artifactId?: string
}): Promise<GenerateOrbitKeepingMissionResult> {
  if (!workspaceDir.trim()) throw new Error("workspace directory must not be empty")
  if (!/^[A-Za-z0-9_-]+$/u.test(artifactId)) throw new Error("artifact id contains unsupported characters")

  const [template, valuesSource] = await Promise.all([
    fs.readFile(templatePath, "utf8"),
    fs.readFile(valuesPath, "utf8"),
  ])
  const sourceValues = parseOrbitKeepingValues(valuesSource)
  const edit = await editOrbitKeepingValuesWithLlm({ connection, request, values: sourceValues, fetchImpl })
  const renderedScript = renderOrbitKeepingValues(template, edit.values)
  const renderedValues = stringify(edit.values)

  const outputDir = path.join(path.resolve(workspaceDir), "gmat", "orbit-keeping")
  const outputValuesPath = path.join(outputDir, `${artifactId}.values.yaml`)
  const outputScriptPath = path.join(outputDir, `${artifactId}.script`)
  await fs.mkdir(outputDir, { recursive: true })
  await Promise.all([
    fs.writeFile(outputValuesPath, renderedValues, "utf8"),
    fs.writeFile(outputScriptPath, renderedScript, "utf8"),
  ])

  return {
    changes: edit.changes,
    latencyMs: edit.latencyMs,
    scriptPath: outputScriptPath,
    valuesPath: outputValuesPath,
  }
}
