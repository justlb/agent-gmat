import fs from "node:fs"
import path from "node:path"

const backendRoot = path.resolve(import.meta.dirname, "..")
const skillsRoot = path.join(backendRoot, "workflow_agents", "gmat_skills")
const registrySource = fs.readFileSync(path.join(backendRoot, "src", "gmat", "templateRegistry.ts"), "utf8")
const registryBlock = registrySource.match(/GMAT_MISSION_SCENARIO_IDS\s*=\s*\[([^\]]+)\]/u)?.[1]
if (!registryBlock) throw new Error("Could not locate GMAT_MISSION_SCENARIO_IDS")
const registryIds = [...registryBlock.matchAll(/"([a-z0-9-]+)"/gu)].map(match => match[1])
const satelliteOwned = new Set(["spacecraft.dryMassKg", "spacecraft.dragCoefficient", "spacecraft.reflectivityCoefficient", "spacecraft.dragAreaM2", "spacecraft.srpAreaM2", "propulsion.fuelMassKg", "propulsion.ispSeconds"])
const correctedRuntime = fs.readFileSync(path.join(backendRoot, "src", "gmat", "correctedScenarioRuntime.ts"), "utf8")

function readManifest(id) {
  for (const directory of [`${id}-scenario`, id === "chemical-3d-transfer" ? id : `${id}-template`]) {
    for (const name of ["scenario.json", "template.json"]) {
      const manifest = path.join(skillsRoot, directory, name)
      if (fs.existsSync(manifest)) return { manifest, directory, value: JSON.parse(fs.readFileSync(manifest, "utf8")) }
    }
  }
  return null
}

function issue(severity, code, detail) { return { severity, code, detail } }

const templates = registryIds.map(id => {
  const item = readManifest(id)
  const issues = []
  if (!item) return { id, issues: [issue("error", "missing_manifest", "No scenario.json or template.json found for registered template.")] }
  const fields = item.value.ui?.mission_input_fields
  if (!Array.isArray(fields)) {
    issues.push(issue("error", "missing_ui_fields", "Manifest has no ui.mission_input_fields array."))
  } else {
    const paths = fields.map(field => field.path).filter(Boolean)
    const duplicates = [...new Set(paths.filter((field, index) => paths.indexOf(field) !== index))]
    if (duplicates.length) issues.push(issue("error", "duplicate_field", duplicates.join(", ")))
    const malformed = paths.filter(field => typeof field !== "string" || !field.includes("."))
    if (malformed.length) issues.push(issue("error", "malformed_field_path", [...new Set(malformed)].join(", ")))
    const requiredVehicleFields = fields.filter(field => field.required === true && satelliteOwned.has(field.path))
    if (requiredVehicleFields.length) issues.push(issue("warning", "vehicle_field_required", requiredVehicleFields.map(field => field.path).join(", ")))
    const drag = fields.find(field => field.path === "spacecraft.dragCoefficient")
    if (drag?.required === true) issues.push(issue("error", "drag_is_user_required", "Drag coefficient must be satellite-owned, not required mission input."))
    const hasAltitude = paths.includes("initialOrbit.altitudeKm")
    const hasSma = paths.includes("initialOrbit.smaKm")
    if (!hasAltitude || !hasSma) issues.push(issue("warning", "incomplete_initial_orbit_pair", `altitude=${hasAltitude}, sma=${hasSma}`))
    const optional = fields.filter(field => field.required === false)
    if (!optional.length) issues.push(issue("warning", "no_optional_fields", "No optional fields are declared."))
  }
  const script = typeof item.value.gmat_reference_script === "string" ? path.join(skillsRoot, item.directory, item.value.gmat_reference_script) : null
  if (!script || !fs.existsSync(script)) issues.push(issue("error", "missing_reference_script", String(item.value.gmat_reference_script ?? "unset")))
  if (correctedRuntime.includes(`"${id}": s(`) && !correctedRuntime.includes(`"${id}"`)) issues.push(issue("error", "runtime_unreachable", "Corrected runtime entry is not addressable."))
  return { id, manifest: path.relative(backendRoot, item.manifest).replaceAll("\\", "/"), issues }
})

const summary = {
  generatedAt: new Date().toISOString(),
  templateCount: templates.length,
  errors: templates.reduce((count, template) => count + template.issues.filter(item => item.severity === "error").length, 0),
  warnings: templates.reduce((count, template) => count + template.issues.filter(item => item.severity === "warning").length, 0),
  templates,
}
const output = path.join(backendRoot, "outputs", "gmat-template-audit.json")
fs.mkdirSync(path.dirname(output), { recursive: true })
fs.writeFileSync(output, `${JSON.stringify(summary, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
