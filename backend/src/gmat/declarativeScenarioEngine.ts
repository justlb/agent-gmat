/** Strict declarative GMAT renderer shared by the corrected mission scenarios. */
export type ScenarioValue = string | number | boolean | null
export type ScenarioValues = Record<string, ScenarioValue>
export type GmatBinding = { path: string; properties: string[]; required?: boolean; quote?: boolean }

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") }

function format(value: ScenarioValue, quote: boolean | undefined) {
  if (value === null) throw new Error("null cannot be rendered into GMAT")
  if (typeof value === "boolean") return value ? "true" : "false"
  return typeof value === "string" && quote ? `'${value.replace(/'/gu, "''")}'` : String(value)
}

export function mergeScenarioValues(defaults: ScenarioValues, overrides: ScenarioValues = {}) {
  return { ...defaults, ...Object.fromEntries(Object.entries(overrides).filter(([, value]) => value !== null && value !== undefined)) }
}

export function renderGmatTemplate(template: string, values: ScenarioValues, bindings: GmatBinding[]) {
  let rendered = template
  for (const binding of bindings) {
    const value = values[binding.path]
    if (value === null || value === undefined || value === "") {
      if (binding.required) throw new Error(`missing required scenario value: ${binding.path}`)
      continue
    }
    let replacements = 0
    for (const property of binding.properties) {
      const formatted = format(value, binding.quote)
      // Prefer a complete GMAT assignment line. This is required for list
      // values such as `{Sun, Luna}`: a scalar regex stops at the comma and
      // used to produce invalid values such as `{Sun}, Luna}`.
      const directAssignment = new RegExp(`^(\\s*${escapeRegExp(property)}\\s*=\\s*).*(;\\s*)$`, "gmu")
      if (directAssignment.test(rendered)) {
        rendered = rendered.replace(directAssignment, `$1${formatted}$2`)
        replacements += 1
        continue
      }
      // Qualified properties may also appear inside Target/Achieve commands.
      // Never use an unqualified name here: `ECC =` can occur inside the
      // quoted command label and corrupt GMAT syntax.
      if (property.includes(".")) {
        const embeddedAssignment = new RegExp(`(${escapeRegExp(property)}\\s*=\\s*)[^,;\\)\\}]+(?=[,;\\)\\}])`, "gu")
        if (embeddedAssignment.test(rendered)) { rendered = rendered.replace(embeddedAssignment, `$1${formatted}`); replacements += 1 }
      }
    }
    if (binding.required && replacements === 0) throw new Error(`template does not expose required GMAT binding: ${binding.path}`)
  }
  return rendered
}

export function renderPropagation(template: string, values: ScenarioValues, forceModel: string, maneuverObjects: string[]) {
  const includeSun = values["propagation.includeSun"] !== false
  const includeLuna = values["propagation.includeLuna"] !== false
  const pointMasses = [includeSun ? "Sun" : null, includeLuna ? "Luna" : null].filter(Boolean).join(", ")
  const atmosphere = values["propagation.atmosphereModel"] ?? "None"
  const relativistic = values["propagation.relativisticCorrection"] === true
  let rendered = renderGmatTemplate(template, { "propagation.pointMasses": `{${pointMasses}}`, "propagation.drag": atmosphere === "None" ? "None" : "On", "propagation.relativistic": relativistic ? "On" : "Off" }, [
    { path: "propagation.pointMasses", properties: [`${forceModel}.PointMasses`] },
    { path: "propagation.drag", properties: [`${forceModel}.Drag`] },
    { path: "propagation.relativistic", properties: [`${forceModel}.RelativisticCorrection`] },
  ])
  const decrement = values["propagation.decrementMass"] !== false
  rendered = renderGmatTemplate(rendered, { "propagation.decrementMass": decrement }, [{ path: "propagation.decrementMass", properties: maneuverObjects.map(name => `${name}.DecrementMass`) }])
  if (atmosphere !== "None") {
    const dragLine = new RegExp(`^(${escapeRegExp(`${forceModel}.Drag`)}\\s*=\\s*On;)$`, "mu")
    if (!dragLine.test(rendered)) throw new Error(`template does not expose drag setting for ${forceModel}`)
    rendered = rendered.replace(dragLine, `$1\n${forceModel}.Drag.AtmosphereModel = ${atmosphere};`)
  }
  return rendered
}

