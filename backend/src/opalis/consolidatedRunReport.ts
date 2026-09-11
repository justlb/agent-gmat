import fs from "node:fs/promises"
import path from "node:path"

import { loadOpalisResultSummary } from "./opalisResults.js"
import { loadSimuCicResultSummary } from "./simuCicResults.js"
import { loadRFComlinkResultSummary } from "../rfComlink/rfComlinkResults.js"
import { writeRunAnalysisContext } from "../analysis/runAnalysisContext.js"
import { loadRunWorkflowLog } from "./workflowRunLog.js"

export async function writeConsolidatedRunReport(runDir: string) {
  const readJson = async (fileName: string) => JSON.parse(await fs.readFile(path.join(runDir, fileName), "utf8").catch(() => "null")) as unknown
  const [manifest, gmatResult, satellite, opalis, simuCic, rfComlink, workflow] = await Promise.all([
    readJson("run_manifest.json"),
    readJson("gmat_result.json"),
    readJson("satellite.json"),
    loadOpalisResultSummary(runDir),
    loadSimuCicResultSummary(runDir),
    loadRFComlinkResultSummary(runDir),
    loadRunWorkflowLog(runDir),
  ])
  const analysis = await writeRunAnalysisContext(runDir)
  const report = {
    generated_at: new Date().toISOString(),
    schema_version: 2,
    source_of_truth: "satellite.json",
    gmat: gmatResult,
    manifest,
    opalis,
    // Keep the consolidated export compact. The raw, extracted RF reports are
    // still available in rf-comlink-results.json for independent review.
    rf_comlink: rfComlink && {
      ...rfComlink,
      reports: rfComlink.reports.map(report => ({ character_count: report.text.length, path: report.path })),
    },
    satellite,
    simu_cic: simuCic,
    workflow,
    analysis_context: "run-analysis-context.json",
  }
  const output = path.join(runDir, "consolidated-run-report.json")
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  return { output, report, analysisContext: analysis.output }
}
