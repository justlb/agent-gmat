/**
 * Role: Creates the declarative starting files for one new GMAT mission
 * scenario without registering or executing it.
 * Usage: npm run scenario:create -- --id <kebab-id> --name "Display name"
 * Dependencies: Node.js filesystem only.
 *
 * The generated scenario remains intentionally inert until its validated GMAT
 * reference, runtime adapter and registry entry are supplied. This prevents a
 * partially described scenario from appearing in Mission Studio.
 */
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const args = process.argv.slice(2)
const option = name => {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}
const id = option("--id")?.trim()
const name = option("--name")?.trim()
const dryRun = args.includes("--dry-run")

if (!id || !name || !/^[a-z][a-z0-9-]*$/u.test(id)) {
  console.error('Usage: npm run scenario:create -- --id <lowercase-kebab-id> --name "Display name" [--dry-run]')
  process.exitCode = 1
} else {
  const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const scenarioDir = path.join(backendRoot, "workflow_agents", "gmat_skills", `${id}-scenario`)
  const files = [
    path.join(scenarioDir, "scenario.json"),
    path.join(scenarioDir, "references", `${id}.script`),
    path.join(scenarioDir, "references", `${id}.values.yaml`),
    path.join(scenarioDir, "README.md"),
  ]
  if (dryRun) {
    console.log(JSON.stringify({ action: "create-mission-scenario", files: files.map(file => path.relative(backendRoot, file).split(path.sep).join("/")), id, name }, null, 2))
  } else {
    try {
      await fs.mkdir(scenarioDir, { recursive: false })
      await fs.mkdir(path.join(scenarioDir, "references"))
      const manifest = {
        id,
        name,
        description: "Describe the deterministic GMAT mission scenario.",
        analysis_request_key: "replace_with_digital_thread_key",
        draft_directory: ["gmat", `${id}-scenario`, "drafts"],
        chat_mode: "replace_with_chat_mode",
        gmat_reference_script: `references/${id}.script`,
        gmat_reference_values: `references/${id}.values.yaml`,
        artifacts: [
          { path: `${id}.script`, kind: "script", primary: true },
          { path: `${id}.values.yaml`, kind: "values" },
          { path: "satellite.json", kind: "digital-thread", primary: true },
          { path: "run_manifest.json", kind: "manifest" },
          { path: "gmat.log", kind: "log" },
        ],
        propulsion_requirement: "replace_with_requirement",
        initial_state_representation: "Keplerian",
        ui: {
          objective: "Describe the engineering objective.",
          summary: "Describe the scenario in one sentence.",
          outputs: ["GMAT script and values", "Run-local satellite.json"],
          satellite_requirements: ["List required satellite capabilities"],
          mission_input_fields: [{ label: "Initial epoch", path: "initialOrbit.epoch" }],
        },
        mission_inputs: { required: ["initial_epoch"], defaults: {} },
        satellite_inputs: ["satellite.bus.physical.mass_kg.dry"],
        downstream_analyses: [],
      }
      await Promise.all([
        fs.writeFile(files[0], `${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
        fs.writeFile(files[1], "% Add the manually validated GMAT reference script here.\n", "utf8"),
        fs.writeFile(files[2], "# Add the rendered value slots required by this scenario.\n", "utf8"),
        fs.writeFile(files[3], `# ${name}\n\n## Completion checklist\n\n1. Replace every placeholder in \`scenario.json\`.\n2. Copy a manually validated reference script into \`references/${id}.script\`.\n3. Implement the scenario-specific draft/runtime adapter.\n4. Add the ID to \`GMAT_MISSION_SCENARIO_IDS\` and its runtime mapping.\n5. Add a render test and an end-to-end digital-thread test.\n6. Register only the artifacts truly produced by the scenario.\n`, "utf8"),
      ])
      console.log(`Created mission-scenario kit at ${scenarioDir}`)
    } catch (error) {
      if (error?.code === "EEXIST") console.error(`Mission scenario already exists: ${scenarioDir}`)
      else console.error(error instanceof Error ? error.message : String(error))
      process.exitCode = 1
    }
  }
}
