import fs from "node:fs/promises"
import path from "node:path"
import { getBackendRoot } from "../config.js"

export const CHEMICAL_HOHMANN_TRANSFER_TEMPLATE_ID = "chemical-hohmann-transfer"

export function defaultChemicalHohmannTemplatePath(projectRoot = getBackendRoot()) {
  return path.join(projectRoot, "workflow_agents", "gmat_skills", "chemical-hohmann-transfer-template", "references", "chemical_hohmann_transfer.script")
}

/** Materialises the immutable GMAT tutorial reference without interpretation. */
export async function renderChemicalHohmannBaseline({ outputPath, templatePath = defaultChemicalHohmannTemplatePath() }: { outputPath: string; templatePath?: string }) {
  const script = await fs.readFile(templatePath, "utf8")
  await fs.mkdir(path.dirname(outputPath), { recursive: true })
  await fs.writeFile(outputPath, script, "utf8")
  return { outputPath, templatePath, bytesWritten: Buffer.byteLength(script, "utf8") }
}
