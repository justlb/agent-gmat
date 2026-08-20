import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { adaptDigitalThreadToGmat, syncDigitalThreadFromGmatDraft } from "../src/digitalThread/gmatDigitalThreadAdapter.js"
import { captureDigitalThreadSnapshot, createPlanningRun, draftDigitalThreadWorkspaceDir, loadOrCreateDigitalThread, saveDigitalThread, setAtPath } from "../src/digitalThread/digitalThreadStore.js"
import { listSatelliteDefinitions, selectSatelliteDefinition } from "../src/digitalThread/satelliteLibrary.js"
import { finalizeMissionRun } from "../src/gmat/missionRunLifecycle.js"
import { missionTemplateRuntime } from "../src/gmat/missionTemplateRuntime.js"
import { allGmatTemplateDefinitions, type GmatTemplateId } from "../src/gmat/templateRegistry.js"
import { getProjectRoot, loadConfig } from "../src/config.js"

export type WorkflowStageStatus = "blocked" | "environment_unavailable" | "not_run" | "passed" | "rendered"
export type WorkflowStage = { detail: string; status: WorkflowStageStatus }

export type CampaignCase = {
  adapterGuards: Array<{ code: string; message: string; path: string }>
  declaredCompatible: boolean
  draftMissing: string[]
  error?: string
  render: "blocked" | "passed" | "failed"
  values: Record<string, string | number>
  workflow: {
    gmat: WorkflowStage
    simuCic: WorkflowStage
    opalis: WorkflowStage
    rfComlink: WorkflowStage
  }
  satellite: { id: string; name: string; version: string }
  template: GmatTemplateId
}

export type CampaignReport = {
  generatedAt: string
  mode: "render" | "workflow"
  summary: { blocked: number; failed: number; passed: number; total: number }
  cases: CampaignCase[]
}

function markdownCell(value: string) { return value.replaceAll("|", "\\|").replace(/\s+/gu, " ").trim() }

export function formatCampaignReport(report: CampaignReport) {
  const lines = [
    "# GMAT workflow compatibility campaign",
    "",
    `Generated: ${report.generatedAt}`,
    `Mode: ${report.mode}`,
    "",
    `- Total combinations: ${report.summary.total}`,
    `- Compatible drafts rendered: ${report.summary.passed}`,
    `- Rejected by propulsion/input guards: ${report.summary.blocked}`,
    `- Draft/render failures: ${report.summary.failed}`,
    "",
    "| Satellite | Template | Draft | GMAT | Simu-CIC | OPALIS | RF-COMLINK |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...report.cases.map(item => `| ${markdownCell(item.satellite.name)} | ${item.template} | ${item.render} | ${item.workflow.gmat.status} | ${item.workflow.simuCic.status} | ${item.workflow.opalis.status} | ${item.workflow.rfComlink.status} |`),
    "",
    "## Details",
    "",
    ...report.cases.map(item => [
      `### ${item.satellite.name} / ${item.template}`,
      "",
      `- Declared compatible: ${item.declaredCompatible ? "yes" : "no"}`,
      `- GMAT: ${item.workflow.gmat.status} - ${item.workflow.gmat.detail}`,
      `- Simu-CIC: ${item.workflow.simuCic.status} - ${item.workflow.simuCic.detail}`,
      `- OPALIS: ${item.workflow.opalis.status} - ${item.workflow.opalis.detail}`,
      `- RF-COMLINK: ${item.workflow.rfComlink.status} - ${item.workflow.rfComlink.detail}`,
      `- Values: ${Object.entries(item.values).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`,
      "",
    ].join("\n")),
  ]
  return `${lines.join("\n")}\n`
}

async function seedReferenceMission(workspaceDir: string, template: GmatTemplateId) {
  const document = await loadOrCreateDigitalThread(workspaceDir)
  const values: Record<string, string | number> = {
    "satellite.orbit.reference_epoch_tai_mod_julian": "31258.66709490726",
    "satellite.orbit.keplerian_elements.semi_major_axis_km": 6678.1363,
    "satellite.orbit.keplerian_elements.eccentricity": 0,
    "satellite.orbit.keplerian_elements.inclination_deg": 28.5,
    "satellite.orbit.keplerian_elements.raan_deg": 67,
    "satellite.orbit.keplerian_elements.arg_of_perigee_deg": 355,
    "satellite.orbit.keplerian_elements.true_anomaly_deg": 250,
  }
  const root = `analysis_requests.gmat.${template === "orbit-keeping" ? "orbit_keeping" : template.replace(/-/gu, "_")}`
  if (template === "orbit-keeping") values[`${root}.minimum_reboost_altitude_km`] = 180
  if (template === "electric-propulsion-transfer") values[`${root}.target_final_altitude_km`] = 550
  if (template === "chemical-hohmann-transfer") values[`${root}.target_orbit.radius_km`] = 7378.1363
  if (template === "chemical-3d-transfer") {
    const gmat = document.analysis_requests.gmat as Record<string, unknown>
    gmat.chemical_3d_transfer = { final_altitude_km: 35786, final_inclination_deg: 0 }
  }
  document.analysis_requests.simu_cic = {
    attitude_mode: "ground_station_tracking",
    ground_station_ids: ["kourou"],
    simultaneous_visibility_policy: "first_visible_station_wins",
  }
  document.analysis_requests.rf_comlink = { selected_ground_station_id: "kourou" }
  for (const [field, value] of Object.entries(values)) setAtPath(document, field, value)
  await saveDigitalThread(workspaceDir, document)
}

function workflowStages(detail: string): CampaignCase["workflow"] {
  return {
    gmat: { status: "not_run", detail },
    simuCic: { status: "not_run", detail: "Waiting for a completed GMAT OEM ephemeris." },
    opalis: { status: "not_run", detail: "Waiting for Simu-CIC CIC output." },
    rfComlink: { status: "not_run", detail: "Waiting for Simu-CIC CIC output; RF-COMLINK calculation remains GUI/manual." },
  }
}

export async function runGmatCompatibilityCampaign({ execute = false }: { execute?: boolean } = {}): Promise<CampaignReport> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "gmat-compatibility-campaign-"))
  const cases: CampaignCase[] = []
  try {
    const [satellites, templates] = await Promise.all([listSatelliteDefinitions(), Promise.resolve(allGmatTemplateDefinitions())])
    const config = execute ? (() => { try { return loadConfig() } catch { return null } })() : null
    for (const satellite of satellites) for (const template of templates) {
      const caseRoot = path.join(root, satellite.id, template.id)
      const planning = await createPlanningRun(caseRoot)
      await selectSatelliteDefinition(planning.workspaceDir, satellite.id, satellite.version)
      await seedReferenceMission(planning.workspaceDir, template.id)
      const adapted = adaptDigitalThreadToGmat(await loadOrCreateDigitalThread(planning.workspaceDir), template.id)
      const item: CampaignCase = {
        adapterGuards: adapted.guards,
        declaredCompatible: satellite.mission_templates.includes(template.id),
        draftMissing: [],
        render: "blocked",
        satellite: { id: satellite.id, name: satellite.name, version: satellite.version },
        template: template.id,
        values: {},
        workflow: workflowStages(execute ? "Awaiting GMAT execution." : "GMAT script rendered; executable run was not requested."),
      }
      if (adapted.guards.length) {
        const reason = adapted.guards.map(guard => guard.message).join(" ")
        item.workflow = {
          gmat: { status: "blocked", detail: reason },
          simuCic: { status: "blocked", detail: "No compatible GMAT mission." },
          opalis: { status: "blocked", detail: "No compatible GMAT mission." },
          rfComlink: { status: "blocked", detail: "No compatible GMAT mission." },
        }
        cases.push(item); continue
      }
      try {
        const runtime = missionTemplateRuntime(template.id)
        const created = await runtime.create(planning.workspaceDir, adapted.values, adapted.requiredDraftPaths)
        item.draftMissing = created.missing
        if (created.missing.length) { cases.push(item); continue }
        const confirmed = await runtime.confirm(planning.workspaceDir, created.draftId)
        item.values = Object.fromEntries(Object.entries(confirmed.values).filter(([, value]): value is string | number => typeof value === "string" || typeof value === "number"))
        const draftWorkspace = draftDigitalThreadWorkspaceDir(planning.workspaceDir, template.id, confirmed.draftId)
        await syncDigitalThreadFromGmatDraft(draftWorkspace, confirmed)
        await syncDigitalThreadFromGmatDraft(planning.workspaceDir, confirmed)
        const external = config?.tools.gmat.bin ? { bin: config.tools.gmat.bin, timeoutMs: config.tools.gmat.timeoutMs } : undefined
        const execution = await runtime.execute({ connection: { apiKey: "campaign", baseUrl: "http://campaign.invalid", model: "campaign" }, draft: confirmed, execution: external, workspaceDir: planning.workspaceDir })
        const snapshot = await captureDigitalThreadSnapshot(draftWorkspace)
        await finalizeMissionRun({ digitalThreadSnapshot: snapshot, draftConversation: [], result: execution.result, root, runDir: execution.runDir, workspaceDir: planning.workspaceDir })
        item.render = "passed"
        if (!execute) item.workflow.gmat = { status: "rendered", detail: "Script and run manifest generated; GMAT executable was not invoked." }
        else if (!config?.tools.gmat.bin) item.workflow.gmat = { status: "environment_unavailable", detail: "tools.gmat.bin is not configured or application configuration could not be loaded." }
        else if (execution.result.status === "completed") item.workflow.gmat = { status: "passed", detail: "GMAT completed. Downstream execution requires a non-empty OEM ephemeris." }
        else {
          const log = await fs.readFile(path.join(execution.runDir, "gmat.log"), "utf8").catch(() => "")
          const diagnostic = log.trim().slice(-2_000).replace(/\s+/gu, " ")
          item.workflow.gmat = { status: "blocked", detail: diagnostic || execution.result.error || `GMAT ended with ${execution.result.status}.` }
        }
        if (item.workflow.gmat.status !== "passed") item.workflow.simuCic = { status: "blocked", detail: "GMAT must complete and provide an OEM ephemeris first." }
      } catch (error) {
        item.render = "failed"
        item.error = error instanceof Error ? error.message : String(error)
      }
      cases.push(item)
    }
  } finally { await fs.rm(root, { force: true, recursive: true }) }
  const summary = { blocked: cases.filter(item => item.render === "blocked").length, failed: cases.filter(item => item.render === "failed").length, passed: cases.filter(item => item.render === "passed").length, total: cases.length }
  return { cases, generatedAt: new Date().toISOString(), mode: execute ? "workflow" : "render", summary }
}

async function main() {
  const execute = process.argv.includes("--execute")
  const report = await runGmatCompatibilityCampaign({ execute })
  const argument = process.argv.find(value => value.startsWith("--output="))?.slice("--output=".length)
  const output = path.resolve(argument || path.join(getProjectRoot(), "reports", `gmat-compatibility-${report.generatedAt.replace(/[:.]/gu, "-")}.json`))
  await fs.mkdir(path.dirname(output), { recursive: true })
  await fs.writeFile(output, `${JSON.stringify(report, null, 2)}\n`)
  const markdownOutput = output.replace(/\.json$/u, ".md")
  await fs.writeFile(markdownOutput, formatCampaignReport(report))
  process.stdout.write(`GMAT compatibility campaign (${report.mode}): ${report.summary.passed} rendered, ${report.summary.blocked} blocked, ${report.summary.failed} failed (${report.summary.total} total)\n${output}\n${markdownOutput}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) void main()
