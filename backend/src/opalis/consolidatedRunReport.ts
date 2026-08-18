import fs from "node:fs/promises"
import path from "node:path"

import { loadOpalisResultSummary } from "./opalisResults.js"
import { writeRunAnalysisContext } from "../analysis/runAnalysisContext.js"

export async function writeConsolidatedRunReport(runDir: string) {
  const readJson = async (fileName: string) => JSON.parse(await fs.readFile(path.join(runDir, fileName), "utf8").catch(() => "null")) as unknown
  const [manifest, gmatResult, satellite, opalis] = await Promise.all([
    readJson("run_manifest.json"), readJson("gmat_result.json"), readJson("satellite.json"), loadOpalisResultSummary(runDir),
  ])
  const simuCicDefinition = await readJson(path.join("opalis", "02-simu-cic", "simucic.definition.json"))
  const cicRoot = path.join(runDir, "opalis", "02-simu-cic")
  const cicEntries = await fs.readdir(cicRoot, { recursive: true }).catch(() => [])
  const cicFiles = cicEntries
    .filter((entry): entry is string => typeof entry === "string")
    .filter(entry => /\.(?:CIC|sce|txt)$/iu.test(entry))
    .map(entry => path.join("opalis", "02-simu-cic", entry).split(path.sep).join("/"))
  const analysis = await writeRunAnalysisContext(runDir)
  const report = {
    generated_at: new Date().toISOString(),
    schema_version: 1,
    source_of_truth: "satellite.json",
    gmat: gmatResult,
    manifest,
    opalis,
    satellite,
    simu_cic: { definition: simuCicDefinition, generated_files: cicFiles },
    analysis_context: "run-analysis-context.json",
  }
  const output = path.join(runDir, "consolidated-run-report.json")
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  return { output, report, analysisContext: analysis.output }
}
