import fs from "node:fs/promises"
import path from "node:path"

const SKILLS = "/mnt/d/STAGE/agent-gmat-main/backend/workflow_agents/gmat_skills"

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") }

function replaceSingleAssignment(script, property, value) {
  const matcher = new RegExp(`^(\\s*${escapeRegExp(property)}\\s*=\\s*)[^;]+;\\s*$`, "mu")
  if (!matcher.test(script)) return script
  return script.replace(matcher, `$1${value};`)
}

const V2_SPACECRAFT = ["DefaultSC", "geoSat", "Electric3DSC"]
const spacecraftProperty = (property) => V2_SPACECRAFT.map(name => `${name}.${property}`)

const DRAFT_TO_GMAT_MAP = {
  "initialOrbit.epoch": spacecraftProperty("Epoch"),
  "initialOrbit.smaKm": spacecraftProperty("SMA"),
  "initialOrbit.eccentricity": spacecraftProperty("ECC"),
  "initialOrbit.inclinationDeg": spacecraftProperty("INC"),
  "initialOrbit.raanDeg": spacecraftProperty("RAAN"),
  "initialOrbit.argPeriapsisDeg": spacecraftProperty("AOP"),
  "initialOrbit.trueAnomalyDeg": spacecraftProperty("TA"),
  "spacecraft.cr": spacecraftProperty("Cr"),
  "spacecraft.srpAreaM2": spacecraftProperty("SRPArea"),
  "targetOrbit.smaKm": ["targetFinalSmaKm"],
  "targetOrbit.eccentricity": ["targetFinalEcc"],
  "targetOrbit.inclinationDeg": ["targetFinalInclinationDeg"],
}

function renderV2Script(template, values) {
  let rendered = template
  for (const [draftPath, gmatProperties] of Object.entries(DRAFT_TO_GMAT_MAP)) {
    const value = values[draftPath]
    if (value === null || value === undefined || value === "") continue
    const formattedValue = typeof value === "string" && value !== "true" && value !== "false" ? `'${value}'` : String(value)
    for (const property of gmatProperties) {
      rendered = replaceSingleAssignment(rendered, property, formattedValue)
    }
  }
  return rendered
}

const scriptPath = path.join(SKILLS, "chemical-2d-transfer-v2-template", "references", "chemical_2D_transfer.script")
const script = await fs.readFile(scriptPath, "utf8")
const values = {
  "initialOrbit.epoch": "21545",
  "initialOrbit.smaKm": 7000,
  "initialOrbit.eccentricity": 0.01,
  "initialOrbit.inclinationDeg": 28.5,
  "initialOrbit.raanDeg": 60,
  "initialOrbit.argPeriapsisDeg": 0,
  "initialOrbit.trueAnomalyDeg": 30,
  "spacecraft.cr": 1.5,
  "spacecraft.srpAreaM2": 0.5,
  "targetOrbit.smaKm": 42164,
  "targetOrbit.eccentricity": 0.001,
}
const rendered = renderV2Script(script, values)

// Use regex to verify values are set correctly
const checks = [
  [/DefaultSC\.SMA\s+=\s+7000;/, "SMA"],
  [/DefaultSC\.Cr\s+=\s+1\.5;/, "Cr"],
  [/DefaultSC\.SRPArea\s+=\s+0\.5;/, "SRPArea"],
  [/targetFinalSmaKm\s+=\s+42164;/, "targetFinalSmaKm"],
  [/targetFinalEcc\s+=\s+0\.001;/, "targetFinalEcc"],
  [/DefaultSC\.Epoch\s+=\s+'21545';/, "Epoch"],
  [/DefaultSC\.TA\s+=\s+30;/, "TA"],
]
let allOk = true
for (const [re, label] of checks) {
  if (!re.test(rendered)) {
    console.log(`!! MISSING: ${label}`)
    allOk = false
  } else {
    console.log(`OK: ${label}`)
  }
}
console.log(allOk ? "\nAll render checks passed" : "\nSome checks failed")
