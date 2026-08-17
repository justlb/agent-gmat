import fs from "node:fs/promises"
import path from "node:path"
import { gmatTemplateDefinition } from "./templateRegistry.js"

export const CHEMICAL_HOHMANN_TRANSFER_TEMPLATE_ID = "chemical-hohmann-transfer"

export function defaultChemicalHohmannTemplatePath() {
  const template = gmatTemplateDefinition(CHEMICAL_HOHMANN_TRANSFER_TEMPLATE_ID)
  return path.join(template.skillDirectory, template.gmatReferenceScript)
}

/** Materialises the immutable GMAT tutorial reference without interpretation. */
export async function renderChemicalHohmannBaseline({ outputPath, templatePath = defaultChemicalHohmannTemplatePath() }: { outputPath: string; templatePath?: string }) {
  const script = await fs.readFile(templatePath, "utf8")
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, script, "utf8")
  return { outputPath, templatePath, bytesWritten: Buffer.byteLength(script, "utf8") }
}
