export const GMAT_TEMPLATE_IDS = ["orbit-keeping", "electric-propulsion-transfer", "chemical-hohmann-transfer"] as const
export type GmatTemplateId = typeof GMAT_TEMPLATE_IDS[number]

export type GmatTemplateDefinition = {
  analysisRequestKey: "orbit_keeping" | "electric_propulsion_transfer" | "chemical_hohmann_transfer"
  draftDirectory: string[]
  id: GmatTemplateId
}

const definitions: Record<GmatTemplateId, GmatTemplateDefinition> = {
  "orbit-keeping": { analysisRequestKey: "orbit_keeping", draftDirectory: ["gmat", "drafts"], id: "orbit-keeping" },
  "electric-propulsion-transfer": { analysisRequestKey: "electric_propulsion_transfer", draftDirectory: ["gmat", "electric-propulsion-transfer", "drafts"], id: "electric-propulsion-transfer" },
  "chemical-hohmann-transfer": { analysisRequestKey: "chemical_hohmann_transfer", draftDirectory: ["gmat", "chemical-hohmann-transfer", "drafts"], id: "chemical-hohmann-transfer" },
}

export function gmatTemplateDefinition(template: GmatTemplateId): GmatTemplateDefinition {
  return definitions[template]
}

export function isGmatTemplateId(value: string): value is GmatTemplateId {
  return (GMAT_TEMPLATE_IDS as readonly string[]).includes(value)
}
