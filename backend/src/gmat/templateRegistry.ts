import fs from "node:fs"
import path from "node:path"

import { getBackendRoot } from "../config.js"

/** IDs are a compile-time guard for the template adapters. The definition of
 * each template itself comes only from its versioned template.json manifest. */
// Only maintained scenarios are registered at startup.  Chemical 3D transfer
// was intentionally removed with its skill directory, so it must not be
// loaded merely because legacy source files still mention its historical ID.
export const GMAT_TEMPLATE_IDS = ["orbit-keeping", "electric-propulsion-transfer", "electrical-leo-orbit-maintenance", "chemical-hohmann-transfer"] as const
export type GmatTemplateId = typeof GMAT_TEMPLATE_IDS[number] | "chemical-3d-transfer"
type RegisteredGmatTemplateId = typeof GMAT_TEMPLATE_IDS[number]
export type GmatAnalysisRequestKey = "orbit_keeping" | "electric_propulsion_transfer" | "electrical_leo_orbit_maintenance" | "chemical_hohmann_transfer" | "chemical_3d_transfer"

export type GmatTemplateMissionInput = {
  derived?: "initialAltitude"
  label: string
  path: string
  unit?: string
  valueTransform?: "earth-radius"
}

export type GmatTemplateUiDefinition = {
  missionInputFields: GmatTemplateMissionInput[]
  objective: string
  outputs: string[]
  satelliteRequirements: string[]
  summary: string
}

export type GmatTemplateDefinition = {
  analysisRequestKey: GmatAnalysisRequestKey
  artifacts: Array<{ kind: string; path: string; primary: boolean }>
  chatMode: string
  description: string
  downstreamAnalyses: string[]
  draftDirectory: string[]
  gmatExampleScript?: string
  gmatReferenceScript: string
  gmatReferenceValues?: string
  id: GmatTemplateId
  initialStateRepresentation: string
  name: string
  propulsionRequirement: string
  satelliteInputs: string[]
  skillDirectory: string
  ui: GmatTemplateUiDefinition
}

type TemplateManifest = {
  analysis_request_key: string
  artifacts: unknown
  chat_mode: string
  description: string
  downstream_analyses: unknown
  draft_directory: unknown
  gmat_reference_script: string
  gmat_example_script?: string
  gmat_reference_values?: string
  id: string
  initial_state_representation: string
  name: string
  propulsion_requirement: string
  satellite_inputs: unknown
  ui: unknown
}

function readStringList(value: unknown, property: string, manifestPath: string) {
  if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item.trim())) throw new Error(`invalid ${property} in ${manifestPath}`)
  return value
}

function readArtifacts(value: unknown, manifestPath: string) {
  if (!Array.isArray(value) || !value.length) throw new Error(`missing artifacts in ${manifestPath}`)
  return value.map((item, index) => {
    const artifact = item as { kind?: unknown; path?: unknown; primary?: unknown } | null
    if (!artifact || typeof artifact.kind !== "string" || !artifact.kind.trim() || typeof artifact.path !== "string" || !artifact.path.trim()) throw new Error(`invalid artifacts[${index}] in ${manifestPath}`)
    const normalized = artifact.path.replace(/\\/gu, "/")
    if (path.isAbsolute(normalized) || normalized.split("/").some(segment => !segment || segment === "." || segment === "..")) throw new Error(`unsafe artifacts[${index}].path in ${manifestPath}`)
    if (artifact.primary !== undefined && typeof artifact.primary !== "boolean") throw new Error(`invalid artifacts[${index}].primary in ${manifestPath}`)
    return { kind: artifact.kind.trim(), path: normalized, primary: artifact.primary === true }
  })
}

function readUi(value: unknown, manifestPath: string): GmatTemplateUiDefinition {
  const ui = value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
  if (!ui) throw new Error(`missing ui in ${manifestPath}`)
  for (const property of ["objective", "summary"] as const) {
    if (typeof ui[property] !== "string" || !ui[property].trim()) throw new Error(`invalid ui.${property} in ${manifestPath}`)
  }
  const missionInputFields: GmatTemplateMissionInput[] | null = Array.isArray(ui.mission_input_fields) ? ui.mission_input_fields.map((item, index): GmatTemplateMissionInput => {
    const field = item !== null && typeof item === "object" && !Array.isArray(item) ? item as Record<string, unknown> : null
    if (!field || typeof field.label !== "string" || !field.label.trim() || typeof field.path !== "string" || !field.path.trim()) throw new Error(`invalid ui.mission_input_fields[${index}] in ${manifestPath}`)
    if (field.unit !== undefined && typeof field.unit !== "string") throw new Error(`invalid ui.mission_input_fields[${index}].unit in ${manifestPath}`)
    if (field.derived !== undefined && field.derived !== "initialAltitude") throw new Error(`invalid ui.mission_input_fields[${index}].derived in ${manifestPath}`)
    if (field.value_transform !== undefined && field.value_transform !== "earth-radius") throw new Error(`invalid ui.mission_input_fields[${index}].value_transform in ${manifestPath}`)
    return {
      ...(field.derived === "initialAltitude" ? { derived: "initialAltitude" as const } : {}),
      label: field.label.trim(),
      path: field.path.trim(),
      ...(typeof field.unit === "string" ? { unit: field.unit } : {}),
      ...(field.value_transform === "earth-radius" ? { valueTransform: "earth-radius" as const } : {}),
    }
  }) : null
  if (!missionInputFields?.length) throw new Error(`missing ui.mission_input_fields in ${manifestPath}`)
  return {
    missionInputFields,
    objective: ui.objective as string,
    outputs: readStringList(ui.outputs, "ui.outputs", manifestPath),
    satelliteRequirements: readStringList(ui.satellite_requirements, "ui.satellite_requirements", manifestPath),
    summary: ui.summary as string,
  }
}

function readManifest(template: GmatTemplateId): GmatTemplateDefinition {
  const skillDirectory = path.join(getBackendRoot(), "workflow_agents", "gmat_skills", template === "chemical-3d-transfer" ? template : `${template}-template`)
  const manifestPath = path.join(skillDirectory, "template.json")
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Partial<TemplateManifest>
  if (manifest.id !== template) throw new Error(`template manifest id must be ${template}: ${manifestPath}`)
  for (const property of ["analysis_request_key", "chat_mode", "description", "gmat_reference_script", "initial_state_representation", "name", "propulsion_requirement"] as const) {
    if (typeof manifest[property] !== "string" || !manifest[property].trim()) throw new Error(`missing ${property} in ${manifestPath}`)
  }
  if (manifest.gmat_reference_values !== undefined && (typeof manifest.gmat_reference_values !== "string" || !manifest.gmat_reference_values.trim())) throw new Error(`invalid gmat_reference_values in ${manifestPath}`)
  if (manifest.gmat_example_script !== undefined && (typeof manifest.gmat_example_script !== "string" || !manifest.gmat_example_script.trim())) throw new Error(`invalid gmat_example_script in ${manifestPath}`)
  const draftDirectory = readStringList(manifest.draft_directory, "draft_directory", manifestPath)
  if (draftDirectory.some(segment => segment === "." || segment === ".." || segment.includes("/") || segment.includes("\\"))) throw new Error(`unsafe draft_directory in ${manifestPath}`)
  const required = manifest as TemplateManifest
  return {
    analysisRequestKey: required.analysis_request_key as GmatAnalysisRequestKey,
    artifacts: readArtifacts(required.artifacts, manifestPath),
    chatMode: required.chat_mode,
    description: required.description,
    downstreamAnalyses: readStringList(required.downstream_analyses, "downstream_analyses", manifestPath),
    draftDirectory,
    gmatExampleScript: required.gmat_example_script,
    gmatReferenceScript: required.gmat_reference_script,
    gmatReferenceValues: required.gmat_reference_values,
    id: template,
    initialStateRepresentation: required.initial_state_representation,
    name: required.name,
    propulsionRequirement: required.propulsion_requirement,
    satelliteInputs: readStringList(required.satellite_inputs, "satellite_inputs", manifestPath),
    skillDirectory,
    ui: readUi(required.ui, manifestPath),
  }
}

const definitions = Object.fromEntries(GMAT_TEMPLATE_IDS.map(template => [template, readManifest(template)])) as Record<RegisteredGmatTemplateId, GmatTemplateDefinition>

export function gmatTemplateDefinition(template: GmatTemplateId): GmatTemplateDefinition {
  const definition = definitions[template as RegisteredGmatTemplateId]
  if (!definition) throw new Error(`GMAT mission scenario is no longer maintained: ${template}`)
  return definition
}
export function allGmatTemplateDefinitions() { return GMAT_TEMPLATE_IDS.map(template => gmatTemplateDefinition(template)) }
export function isGmatTemplateId(value: string): value is GmatTemplateId { return (GMAT_TEMPLATE_IDS as readonly string[]).includes(value) }
