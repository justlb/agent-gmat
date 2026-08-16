import fs from "node:fs/promises"
import path from "node:path"
import { getBackendRoot } from "../config.js"

export const ORBIT_KEEPING_TEMPLATE_ID = "orbit-keeping"

export function defaultOrbitKeepingTemplatePath(projectRoot = getBackendRoot()) {
  return path.join(
    projectRoot,
    "workflow_agents",
    "gmat_skills",
    "orbit-keeping-template",
    "references",
    "orbit_keeping.script",
  )
}

/**
 * MVP-2 baseline renderer. It materializes the immutable GMAT reference
 * template without interpreting a mission request or calling an LLM.
 */
export async function renderOrbitKeepingBaseline({
  outputPath,
  templatePath = defaultOrbitKeepingTemplatePath(),
}: {
  outputPath: string
  templatePath?: string
}) {
  const script = await fs.readFile(templatePath, "utf8")
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, script, "utf8")
  return { outputPath, templatePath, bytesWritten: Buffer.byteLength(script, "utf8") }
}
