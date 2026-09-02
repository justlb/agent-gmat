import fs from "node:fs/promises"
import path from "node:path"

const SKILLS = "/mnt/d/STAGE/agent-gmat-main/backend/workflow_agents/gmat_skills"

function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") }

const scriptPath = path.join(SKILLS, "chemical-2d-transfer-v2-template", "references", "chemical_2D_transfer.script")
const script = await fs.readFile(scriptPath, "utf8")

// Check line endings
const hasCRLF = script.includes("\r\n")
console.log("Has CRLF:", hasCRLF)

// Find the SMA line
const lines = script.split("\n")
const smaLine = lines.find(l => l.includes("DefaultSC.SMA"))
console.log("SMA line repr:", JSON.stringify(smaLine))

// Test regex
const property = "DefaultSC.SMA"
const matcher = new RegExp(`^(\\s*${escapeRegExp(property)}\\s*=\\s*)[^;]+;\\s*$`, "mu")
console.log("Regex:", matcher.source)
console.log("Test result:", matcher.test(script))

// Try without $ 
const matcher2 = new RegExp(`^(\\s*${escapeRegExp(property)}\\s*=\\s*)[^;]+;`, "mu")
console.log("Test without $:", matcher2.test(script))

// Try with explicit \r
const matcher3 = new RegExp(`^(\\s*${escapeRegExp(property)}\\s*=\\s*)[^;]+;\\r?\\n`, "mu")
console.log("Test with \\r?\\n:", matcher3.test(script))

// Show the actual match if any
const match3 = script.match(matcher3)
if (match3) console.log("Match:", JSON.stringify(match3[0]))
