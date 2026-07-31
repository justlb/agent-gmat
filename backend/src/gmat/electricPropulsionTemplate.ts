import path from "node:path"

export const ELECTRIC_PROPULSION_TRANSFER_TEMPLATE_ID = "electric-propulsion-transfer"

export function defaultElectricPropulsionTemplatePath(projectRoot = process.cwd()) {
  return path.join(
    projectRoot,
    "workflow_agents",
    "gmat_skills",
    "electric-propulsion-transfer-template",
    "references",
    "electric_propulsion_transfer.script",
  )
}
