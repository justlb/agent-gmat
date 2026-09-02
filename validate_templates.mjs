import fs from "node:fs/promises"
import path from "node:path"

const SKILLS = "/mnt/d/STAGE/agent-gmat-main/backend/workflow_agents/gmat_skills"
const dirs = (await fs.readdir(SKILLS, { withFileTypes: true })).filter(d => d.isDirectory() && d.name.endsWith("-v2-template"))
let allOk = true
for (const dir of dirs) {
  const file = path.join(SKILLS, dir.name, "template.json")
  try {
    const text = await fs.readFile(file, "utf8")
    const json = JSON.parse(text)
    const hasCr = (json.ui?.mission_input_fields ?? []).some(f => f.path === "spacecraft.cr")
    const hasSrp = (json.ui?.mission_input_fields ?? []).some(f => f.path === "spacecraft.srpAreaM2")
    const satInputs = json.satellite_inputs ?? []
    const hasCrInput = satInputs.includes("satellite.bus.physical.cr")
    const hasSrpInput = satInputs.includes("satellite.bus.physical.srp_area_m2")
    const targetFields = (json.ui?.mission_input_fields ?? []).filter(f => (f.path ?? "").startsWith("targetOrbit."))
    const status = []
    if (hasCr) status.push("!! Cr in UI")
    if (hasSrp) status.push("!! SRP in UI")
    if (!hasCrInput) status.push("!! missing cr satInput")
    if (!hasSrpInput) status.push("!! missing srp satInput")
    if (targetFields.length > 0) status.push(`targetOrbit: ${targetFields.map(f => f.path).join(", ")}`)
    if (status.length === 0) status.push("OK")
    if (status.some(s => s.startsWith("!!"))) allOk = false
    console.log(`${dir.name.replace("-template", "")}: ${status.join(" | ")}`)
  } catch (e) {
    allOk = false
    console.log(`${dir.name}: !! INVALID JSON: ${e.message}`)
  }
}
console.log(allOk ? "\nAll templates valid" : "\nSome templates have issues")
