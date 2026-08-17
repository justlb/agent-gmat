import fs from "node:fs/promises"
import path from "node:path"
import { gmatTemplateDefinition } from "./templateRegistry.js"

export const ORBIT_KEEPING_TEMPLATE_ID = "orbit-keeping"

export function defaultOrbitKeepingTemplatePath() {
  const template = gmatTemplateDefinition(ORBIT_KEEPING_TEMPLATE_ID)
  return path.join(template.skillDirectory, template.gmatReferenceScript)
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
