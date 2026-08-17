import path from "node:path"
import { gmatTemplateDefinition } from "./templateRegistry.js"

export const ELECTRIC_PROPULSION_TRANSFER_TEMPLATE_ID = "electric-propulsion-transfer"

export function defaultElectricPropulsionTemplatePath() {
  const template = gmatTemplateDefinition(ELECTRIC_PROPULSION_TRANSFER_TEMPLATE_ID)
  return path.join(template.skillDirectory, template.gmatReferenceScript)
}
