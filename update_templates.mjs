// One-shot migration of the v2 template manifests:
//  - drop the Cr / SRP Area mission-input fields (satellite-owned values)
//  - declare target-orbit inputs for the transfer scenarios
//  - declare the satellite Cr / SRP-area inputs in satellite_inputs and ui
// The files keep their original formatting: edits are text-based, and every
// file is re-parsed afterwards to guarantee valid JSON.
import fs from "node:fs/promises"
import path from "node:path"

const SKILLS = "/mnt/d/STAGE/agent-gmat-main/backend/workflow_agents/gmat_skills"

const TRANSFER_FIELDS = {
  "chemical-2d-transfer-v2": [
    ["Target SMA", "targetOrbit.smaKm", "km"],
    ["Target ECC", "targetOrbit.eccentricity", null],
  ],
  "chemical-3d-transfer-v2": [
    ["Target SMA", "targetOrbit.smaKm", "km"],
    ["Target INC", "targetOrbit.inclinationDeg", "deg"],
  ],
  "electrical-2d-transfer-v2": [
    ["Target SMA", "targetOrbit.smaKm", "km"],
  ],
  "electrical-3d-transfer-v2": [
    ["Target SMA", "targetOrbit.smaKm", "km"],
    ["Target INC", "targetOrbit.inclinationDeg", "deg"],
  ],
}

function fieldBlock(indent, label, fieldPath, unit) {
  const props = [`"label":  "${label}"`, `"path":  "${fieldPath}"`]
  if (unit) props.push(`"unit":  "${unit}"`)
  return `${indent}{\n${props.map(prop => `${indent}    ${prop}`).join(",\n")}\n${indent}}`
}

const dirs = (await fs.readdir(SKILLS, { withFileTypes: true })).filter(entry => entry.isDirectory() && entry.name.endsWith("-v2-template"))
for (const dir of dirs) {
  const templateId = dir.name.replace(/-template$/u, "")
  const file = path.join(SKILLS, dir.name, "template.json")
  let text = await fs.readFile(file, "utf8")
  const original = text
  const notes = []

  // 1. Remove the Cr / SRP Area mission-input entries.
  text = text.replace(/[ \t]*\{\s*"path":\s*"spacecraft\.cr",\s*"label":\s*"Cr"\s*\},[ \t]*\n/u, () => (notes.push("removed Cr"), ""))
  text = text.replace(/[ \t]*\{\s*"label":\s*"SRP Area",\s*"path":\s*"spacecraft\.srpAreaM2",\s*"unit":\s*"m2"\s*\},[ \t]*\n/u, () => (notes.push("removed SRP Area"), ""))

  // 2. Insert the target-orbit fields after the True Anomaly entry.
  const fields = TRANSFER_FIELDS[templateId]
  if (fields) {
    const anchor = /^([ \t]*)\{[^\{\}]*"path":\s*"initialOrbit\.trueAnomalyDeg"[^\{\}]*\},[ \t]*\n/mu
    const match = text.match(anchor)
    if (!match) notes.push("!! no trueAnomaly anchor")
    else {
      const indent = match[1]
      const blocks = fields.map(([label, fieldPath, unit]) => fieldBlock(indent, label, fieldPath, unit)).join(",\n") + ",\n"
      text = text.replace(anchor, line => line + blocks)
      notes.push("added target fields")
    }
    // 3. mission_inputs.required documents the requested inputs.
    text = text.replace(/("required":\s*\[\s*"initial_epoch",\s*"initial_orbit")/u, '$1, "target_orbit"')
  }

  // 4. satellite_inputs: declare the satellite-owned Cr / SRP-area sources.
  if (!text.includes("satellite.bus.physical.cr")) {
    const inputsMatch = text.match(/^[ \t]*"satellite\.bus\.propulsion_subsystem\.specific_impulse_seconds",?[ \t]*$/mu)
    if (!inputsMatch) notes.push("!! no satellite_inputs anchor")
    else {
      const line = inputsMatch[0]
      const indent = line.match(/^[ \t]*/u)[0] + "    "
      const hadComma = line.trimEnd().endsWith(",")
      const replacement = `${hadComma ? line : `${line},`}\n${indent}"satellite.bus.physical.cr",\n${indent}"satellite.bus.physical.srp_area_m2"`
      text = text.replace(line, replacement)
      notes.push("added satellite_inputs")
    }
  }

  // 5. ui.satellite_requirements: document the new required properties.
  if (!text.includes("Reflectivity coefficient (Cr)")) {
    const reqMatch = text.match(/^([ \t]*)"Drag area and coefficient"([ \t]*),?[ \t]*$/mu)
    if (!reqMatch) notes.push("!! no satellite_requirements anchor")
    else {
      const line = reqMatch[0]
      const indent = reqMatch[1]
      const hadComma = line.trimEnd().endsWith(",")
      const replacement = `${hadComma ? line : `${line},`}\n${indent}"Reflectivity coefficient (Cr)",\n${indent}"SRP area"`
      text = text.replace(line, replacement)
      notes.push("added satellite_requirements")
    }
  }

  if (text === original) notes.push("UNCHANGED")
  let valid = true
  try {
    JSON.parse(text)
    notes.push("json OK")
  } catch (error) {
    valid = false
    notes.push(`!! INVALID JSON: ${error.message}`)
  }
  if (text !== original && valid && !notes.some(note => note.startsWith("!!"))) await fs.writeFile(file, text, "utf8")
  console.log(`${templateId}: ${notes.join(" | ")}`)
}
