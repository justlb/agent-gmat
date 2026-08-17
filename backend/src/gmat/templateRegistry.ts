import fs from "node:fs"
import path from "node:path"

import { getBackendRoot } from "../config.js"

/** IDs are a compile-time guard for the template adapters. The definition of
 * each template itself comes only from its versioned template.json manifest. */
export const GMAT_TEMPLATE_IDS = ["orbit-keeping", "electric-propulsion-transfer", "chemical-hohmann-transfer", "chemical-3d-transfer"] as const
export type GmatTemplateId = typeof GMAT_TEMPLATE_IDS[number]
export type GmatAnalysisRequestKey = "orbit_keeping" | "electric_propulsion_transfer" | "chemical_hohmann_transfer" | "chemical_3d_transfer"

export type GmatTemplateDefinition = {
  analysisRequestKey: GmatAnalysisRequestKey
  artifacts: Array<{ kind: string; path: string; primary: boolean }>
  chatMode: string
  description: string
  downstreamAnalyses: string[]
  draftDirectory: string[]
  gmatReferenceScript: string
  gmatReferenceValues?: string
  id: GmatTemplateId
  initialStateRepresentation: string
  name: string
  propulsionRequirement: string
  satelliteInputs: string[]
  skillDirectory: string
}

type TemplateManifest = {
  analysis_request_key: string
  artifacts: unknown
  chat_mode: string
  description: string
  downstream_analyses: unknown
  draft_directory: unknown
  gmat_reference_script: string
  gmat_reference_values?: string
  id: string
  initial_state_representation: string
  name: string
  propulsion_requirement: string
  satellite_inputs: unknown
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

function readManifest(template: GmatTemplateId): GmatTemplateDefinition {
  const skillDirectory = path.join(getBackendRoot(), "workflow_agents", "gmat_skills", template === "chemical-3d-transfer" ? template : `${template}-template`)
  const manifestPath = path.join(skillDirectory, "template.json")
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")) as Partial<TemplateManifest>
  if (manifest.id !== template) throw new Error(`template manifest id must be ${template}: ${manifestPath}`)
  for (const property of ["analysis_request_key", "chat_mode", "description", "gmat_reference_script", "initial_state_representation", "name", "propulsion_requirement"] as const) {
    if (typeof manifest[property] !== "string" || !manifest[property].trim()) throw new Error(`missing ${property} in ${manifestPath}`)
  }
  if (manifest.gmat_reference_values !== undefined && (typeof manifest.gmat_reference_values !== "string" || !manifest.gmat_reference_values.trim())) throw new Error(`invalid gmat_reference_values in ${manifestPath}`)
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
    gmatReferenceScript: required.gmat_reference_script,
    gmatReferenceValues: required.gmat_reference_values,
    id: template,
    initialStateRepresentation: required.initial_state_representation,
    name: required.name,
    propulsionRequirement: required.propulsion_requirement,
    satelliteInputs: readStringList(required.satellite_inputs, "satellite_inputs", manifestPath),
    skillDirectory,
  }
}

const definitions = Object.fromEntries(GMAT_TEMPLATE_IDS.map(template => [template, readManifest(template)])) as Record<GmatTemplateId, GmatTemplateDefinition>

export function gmatTemplateDefinition(template: GmatTemplateId): GmatTemplateDefinition { return definitions[template] }
export function allGmatTemplateDefinitions() { return GMAT_TEMPLATE_IDS.map(template => gmatTemplateDefinition(template)) }
export function isGmatTemplateId(value: string): value is GmatTemplateId { return (GMAT_TEMPLATE_IDS as readonly string[]).includes(value) }
