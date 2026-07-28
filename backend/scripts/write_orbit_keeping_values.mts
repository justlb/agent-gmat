import path from "node:path"
import { fileURLToPath } from "node:url"

import { writeDefaultOrbitKeepingValues } from "../src/gmat/orbitKeepingValues.js"

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const outputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(
      backendRoot,
      "workflow_agents",
      "gmat_skills",
      "orbit-keeping-template",
      "references",
      "orbit_keeping.values.yaml",
    )

const values = await writeDefaultOrbitKeepingValues({ outputPath })
process.stdout.write(`Wrote ${values.slots.length} orbit-keeping value slots to ${outputPath}\n`)
