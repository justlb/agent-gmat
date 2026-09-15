import path from "node:path"
import { gmatTemplateDefinition } from "./templateRegistry.js"

export function defaultChemicalEscapeTemplatePath() {
  const template = gmatTemplateDefinition("chemical-escape")
  return path.resolve(template.skillDirectory, template.gmatReferenceScript)
}
