import fs from "node:fs/promises"
import path from "node:path"

import { appendChemicalHohmannDraftConversation, createChemicalHohmannDraft, loadChemicalHohmannDraft, recordChemicalHohmannDraftRun, setChemicalHohmannDraftValue } from "./chemicalHohmannDraft.js"
import { appendElectricPropulsionDraftConversation, createElectricPropulsionDraft, draftToElectricPropulsionChanges, loadElectricPropulsionDraft, recordElectricPropulsionDraftRun, setElectricPropulsionDraftValue } from "./electricPropulsionDraft.js"
import { appendOrbitKeepingDraftConversation, createOrbitKeepingDraft, draftToOrbitKeepingChanges, loadOrbitKeepingDraft, recordOrbitKeepingDraftRun, setOrbitKeepingDraftValue } from "./orbitKeepingDraft.js"
import { discussChemicalHohmannDraft, confirmChemicalHohmannDraft } from "./chemicalHohmannDraft.js"
import { discussElectricPropulsionDraft, confirmElectricPropulsionDraft } from "./electricPropulsionDraft.js"
import { discussOrbitKeepingDraft, confirmOrbitKeepingDraft } from "./orbitKeepingDraft.js"
import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { generateChemicalHohmannMission, snapshotChemicalHohmannExecution } from "./chemicalHohmann.service.js"
import { generateElectricPropulsionMission } from "./electricPropulsion.service.js"
import { defaultElectricPropulsionTemplatePath } from "./electricPropulsionTemplate.js"
import { extractElectricPropulsionValues } from "./electricPropulsionValues.js"
import { defaultOrbitKeepingValuesPath, generateOrbitKeepingMission } from "./orbitKeeping.service.js"
import { parseOrbitKeepingValues } from "./orbitKeepingValues.js"
import type { GmatTemplateId } from "./templateRegistry.js"
import { appendChemical3dDraftConversation, confirmChemical3dDraft, createChemical3dDraft, discussChemical3dDraft, generateChemical3dMission, loadChemical3dDraft, recordChemical3dDraftRun, setChemical3dDraftValue } from "./chemical3dTransfer.js"
import { appendGeoElectricEndOfLifeDraftConversation, confirmGeoElectricEndOfLifeDraft, createGeoElectricEndOfLifeDraft, discussGeoElectricEndOfLifeDraft, generateGeoElectricEndOfLifeMission, loadGeoElectricEndOfLifeDraft, recordGeoElectricEndOfLifeDraftRun, setGeoElectricEndOfLifeDraftValue } from "./geoElectricEndOfLife.js"
import { appendGeoGsoElectricStationKeepingDraftConversation, confirmGeoGsoElectricStationKeepingDraft, createGeoGsoElectricStationKeepingDraft, discussGeoGsoElectricStationKeepingDraft, generateGeoGsoElectricStationKeepingMission, loadGeoGsoElectricStationKeepingDraft, recordGeoGsoElectricStationKeepingDraftRun, setGeoGsoElectricStationKeepingDraftValue } from "./geoGsoElectricStationKeeping.js"
import { appendGeoGsoOrbitKeepingDraftConversation, confirmGeoGsoOrbitKeepingDraft, createGeoGsoOrbitKeepingDraft, discussGeoGsoOrbitKeepingDraft, generateGeoGsoOrbitKeepingMission, loadGeoGsoOrbitKeepingDraft, recordGeoGsoOrbitKeepingDraftRun, setGeoGsoOrbitKeepingDraftValue } from "./geoGsoOrbitKeeping.js"
import { appendCorrectedScenarioDraftConversation, confirmCorrectedScenarioDraft, correctedScenarios, createCorrectedScenarioDraft, discussCorrectedScenarioDraft, generateCorrectedScenarioMission, loadCorrectedScenarioDraft, recordCorrectedScenarioDraftRun, setCorrectedScenarioDraftValue } from "./correctedScenarioRuntime.js"

export type MissionDraftValue = string | number | null

/** Common minimum contract used by the Mission Studio. Individual template
 * modules may keep additional data, but the workflow never depends on it. */
export type MissionTemplateDraft = {
  assistantMessage?: string
  confirmed: boolean
  draftId: string
  missing: string[]
  templateId: string
  updatedAt: string
  values: Record<string, MissionDraftValue>
}

export type MissionTemplateExecution = {
  changes: unknown[]
  result: { error?: string; executionDurationMs?: number; status: string; warnings?: string[] }
  runDir: string
  runId: string
}

type MissionTemplateRuntime = {
  appendConversation: (workspaceDir: string, draftId: string, turn: { assistant: string; user: string }) => Promise<MissionTemplateDraft>
  create: (workspaceDir: string, initialValues?: Record<string, MissionDraftValue>, requiredPaths?: string[]) => Promise<MissionTemplateDraft>
  confirm: (workspaceDir: string, draftId: string, authoritativeValues?: Record<string, MissionDraftValue>) => Promise<MissionTemplateDraft>
  discuss: (input: { connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">; draft: MissionTemplateDraft; message: string; workspaceDir: string }) => Promise<MissionTemplateDraft>
  execute: (input: { connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">; draft: MissionTemplateDraft; execution?: { bin: string; timeoutMs: number }; workspaceDir: string }) => Promise<MissionTemplateExecution>
  load: (workspaceDir: string, draftId: string) => Promise<MissionTemplateDraft>
  recordRun: (input: { draft: MissionTemplateDraft; execution: MissionTemplateExecution; runPath: string; workspaceDir: string }) => Promise<MissionTemplateDraft>
  setValue: (workspaceDir: string, draft: MissionTemplateDraft, path: string, value: string) => Promise<MissionTemplateDraft>
}

/* This is the only explicit mapping needed when a new template is introduced.
 * Its GMAT generator remains template-specific, while shared HTTP/UI workflow
 * operations use this uniform contract. */
const correctedRuntimes = Object.fromEntries(Object.keys(correctedScenarios).map(id => [id, { appendConversation: (w: string, d: string, turn: { assistant: string; user: string }) => appendCorrectedScenarioDraftConversation(id as GmatTemplateId, w, d, turn), confirm: (w: string, d: string) => confirmCorrectedScenarioDraft(id as GmatTemplateId, w, d), create: (w: string, v?: Record<string, MissionDraftValue>, p?: string[]) => createCorrectedScenarioDraft(id as GmatTemplateId, w, v, p), discuss: ({ draft, message, workspaceDir }: { draft: MissionTemplateDraft; message: string; workspaceDir: string }) => discussCorrectedScenarioDraft(id as GmatTemplateId, workspaceDir, draft as never, message), execute: ({ draft, execution, workspaceDir }: { draft: MissionTemplateDraft; execution?: { bin: string; timeoutMs: number }; workspaceDir: string }) => generateCorrectedScenarioMission(id as GmatTemplateId, { draft: draft as never, execution, workspaceDir }), load: (w: string, d: string) => loadCorrectedScenarioDraft(id as GmatTemplateId, w, d), recordRun: ({ draft, execution, runPath, workspaceDir }: { draft: MissionTemplateDraft; execution: MissionTemplateExecution; runPath: string; workspaceDir: string }) => recordCorrectedScenarioDraftRun(id as GmatTemplateId, workspaceDir, draft as never, execution as never, runPath), setValue: (w: string, d: MissionTemplateDraft, f: string, v: string) => setCorrectedScenarioDraftValue(id as GmatTemplateId, w, d as never, f, v) }])) as Partial<Record<GmatTemplateId, MissionTemplateRuntime>>

const runtimes: Partial<Record<GmatTemplateId, MissionTemplateRuntime>> = {
  "geo-electric-end-of-life": { appendConversation: appendGeoElectricEndOfLifeDraftConversation, confirm: async (w,d,a) => confirmGeoElectricEndOfLifeDraft(w,d,a), create: async (w,v,p) => createGeoElectricEndOfLifeDraft(w,v,p), discuss: async ({ draft, message, workspaceDir }) => discussGeoElectricEndOfLifeDraft({ draft: draft as Awaited<ReturnType<typeof loadGeoElectricEndOfLifeDraft>>, message, workspaceDir }), execute: async ({ draft, execution, workspaceDir }) => generateGeoElectricEndOfLifeMission({ draft: draft as Awaited<ReturnType<typeof loadGeoElectricEndOfLifeDraft>>, execution, workspaceDir }), load: loadGeoElectricEndOfLifeDraft, recordRun: async ({ draft, execution, runPath, workspaceDir }) => recordGeoElectricEndOfLifeDraftRun({ draft: draft as Awaited<ReturnType<typeof loadGeoElectricEndOfLifeDraft>>, execution: execution as Awaited<ReturnType<typeof generateGeoElectricEndOfLifeMission>>, runPath, workspaceDir }), setValue: async (w,d,f,v) => setGeoElectricEndOfLifeDraftValue(w,d as Awaited<ReturnType<typeof loadGeoElectricEndOfLifeDraft>>,f,v) },
  "geo-gso-electric-station-keeping": {
    appendConversation: appendGeoGsoElectricStationKeepingDraftConversation,
    confirm: async (workspaceDir, draftId, authoritative) => confirmGeoGsoElectricStationKeepingDraft(workspaceDir, draftId, authoritative),
    create: async (workspaceDir, initialValues, requiredPaths) => createGeoGsoElectricStationKeepingDraft(workspaceDir, initialValues, requiredPaths),
    discuss: async ({ draft, message, workspaceDir }) => discussGeoGsoElectricStationKeepingDraft({ draft: draft as Awaited<ReturnType<typeof loadGeoGsoElectricStationKeepingDraft>>, message, workspaceDir }),
    execute: async ({ draft, execution, workspaceDir }) => generateGeoGsoElectricStationKeepingMission({ draft: draft as Awaited<ReturnType<typeof loadGeoGsoElectricStationKeepingDraft>>, execution, workspaceDir }),
    load: loadGeoGsoElectricStationKeepingDraft,
    recordRun: async ({ draft, execution, runPath, workspaceDir }) => recordGeoGsoElectricStationKeepingDraftRun({ draft: draft as Awaited<ReturnType<typeof loadGeoGsoElectricStationKeepingDraft>>, execution: execution as Awaited<ReturnType<typeof generateGeoGsoElectricStationKeepingMission>>, runPath, workspaceDir }),
    setValue: async (workspaceDir, draft, field, value) => setGeoGsoElectricStationKeepingDraftValue(workspaceDir, draft as Awaited<ReturnType<typeof loadGeoGsoElectricStationKeepingDraft>>, field, value),
  },  "geo-gso-orbit-keeping": {
    appendConversation: appendGeoGsoOrbitKeepingDraftConversation,
    confirm: async (workspaceDir, draftId, authoritative) => confirmGeoGsoOrbitKeepingDraft(workspaceDir, draftId, authoritative),
    create: async (workspaceDir, initialValues, requiredPaths) => createGeoGsoOrbitKeepingDraft(workspaceDir, initialValues, requiredPaths),
    discuss: async ({ draft, message, workspaceDir }) => discussGeoGsoOrbitKeepingDraft({ draft: draft as Awaited<ReturnType<typeof loadGeoGsoOrbitKeepingDraft>>, message, workspaceDir }),
    execute: async ({ draft, execution, workspaceDir }) => generateGeoGsoOrbitKeepingMission({ draft: draft as Awaited<ReturnType<typeof loadGeoGsoOrbitKeepingDraft>>, execution, workspaceDir }),
    load: loadGeoGsoOrbitKeepingDraft,
    recordRun: async ({ draft, execution, runPath, workspaceDir }) => recordGeoGsoOrbitKeepingDraftRun({ draft: draft as Awaited<ReturnType<typeof loadGeoGsoOrbitKeepingDraft>>, execution: execution as Awaited<ReturnType<typeof generateGeoGsoOrbitKeepingMission>>, runPath, workspaceDir }),
    setValue: async (workspaceDir, draft, field, value) => setGeoGsoOrbitKeepingDraftValue(workspaceDir, draft as Awaited<ReturnType<typeof loadGeoGsoOrbitKeepingDraft>>, field, value),
  },
  "chemical-3d-transfer": {
    appendConversation: appendChemical3dDraftConversation,
    confirm: confirmChemical3dDraft,
    create: createChemical3dDraft,
    discuss: async ({ connection, draft, message, workspaceDir }) => discussChemical3dDraft({ connection, draft: draft as Awaited<ReturnType<typeof loadChemical3dDraft>>, message, workspaceDir }),
    execute: async ({ draft, execution, workspaceDir }) => generateChemical3dMission({ draft: draft as Awaited<ReturnType<typeof loadChemical3dDraft>>, execution, workspaceDir }),
    load: loadChemical3dDraft,
    recordRun: async ({ draft, execution, runPath, workspaceDir }) => recordChemical3dDraftRun({ draft: draft as Awaited<ReturnType<typeof loadChemical3dDraft>>, execution: execution as Awaited<ReturnType<typeof generateChemical3dMission>>, runPath, workspaceDir }),
    setValue: async (workspaceDir, draft, field, value) => setChemical3dDraftValue(workspaceDir, draft as Awaited<ReturnType<typeof loadChemical3dDraft>>, field, value),
  },
  "orbit-keeping": {
    appendConversation: appendOrbitKeepingDraftConversation,
    confirm: confirmOrbitKeepingDraft,
    create: async (workspaceDir, initialValues, requiredPaths) => createOrbitKeepingDraft(workspaceDir, initialValues, requiredPaths),
    discuss: async ({ connection, draft, message, workspaceDir }) => discussOrbitKeepingDraft({ connection, draft: draft as unknown as Awaited<ReturnType<typeof loadOrbitKeepingDraft>>, message, workspaceDir }),
    execute: async ({ connection, draft, execution, workspaceDir }) => {
      const values = parseOrbitKeepingValues(await fs.readFile(defaultOrbitKeepingValuesPath(), "utf8"))
      const result = await generateOrbitKeepingMission({ changes: draftToOrbitKeepingChanges(draft as unknown as Awaited<ReturnType<typeof loadOrbitKeepingDraft>>, values), connection, execution, request: `Confirmed GMAT mission draft ${draft.draftId}`, workspaceDir })
      return { changes: result.changes, result: result.result, runDir: result.runDir, runId: result.runId }
    },
    load: loadOrbitKeepingDraft,
    recordRun: async ({ draft, execution, runPath, workspaceDir }) => recordOrbitKeepingDraftRun(workspaceDir, draft.draftId, { changes: execution.changes as Parameters<typeof recordOrbitKeepingDraftRun>[2]["changes"], completedAt: new Date().toISOString(), result: execution.result as Parameters<typeof recordOrbitKeepingDraftRun>[2]["result"], runId: execution.runId, runPath }),
    setValue: async (workspaceDir, draft, path, value) => setOrbitKeepingDraftValue(workspaceDir, draft as unknown as Awaited<ReturnType<typeof loadOrbitKeepingDraft>>, path, value),
  },
  "electric-propulsion-transfer": {
    appendConversation: appendElectricPropulsionDraftConversation,
    confirm: confirmElectricPropulsionDraft,
    create: async (workspaceDir, initialValues, requiredPaths) => createElectricPropulsionDraft(workspaceDir, initialValues, requiredPaths),
    discuss: async ({ connection, draft, message, workspaceDir }) => discussElectricPropulsionDraft({ connection, draft: draft as unknown as Awaited<ReturnType<typeof loadElectricPropulsionDraft>>, message, workspaceDir }),
    execute: async ({ draft, execution, workspaceDir }) => {
      const values = extractElectricPropulsionValues(await fs.readFile(defaultElectricPropulsionTemplatePath(), "utf8"))
      const result = await generateElectricPropulsionMission({ changes: draftToElectricPropulsionChanges(draft as unknown as Awaited<ReturnType<typeof loadElectricPropulsionDraft>>, values), execution, request: `Confirmed GMAT electric-propulsion draft ${draft.draftId}`, workspaceDir })
      return { changes: result.changes, result: result.result, runDir: result.runDir, runId: result.runId }
    },
    load: loadElectricPropulsionDraft,
    recordRun: async ({ draft, execution, runPath, workspaceDir }) => recordElectricPropulsionDraftRun(workspaceDir, draft.draftId, { changes: execution.changes as Parameters<typeof recordElectricPropulsionDraftRun>[2]["changes"], completedAt: new Date().toISOString(), result: execution.result as Parameters<typeof recordElectricPropulsionDraftRun>[2]["result"], runId: execution.runId, runPath }),
    setValue: async (workspaceDir, draft, path, value) => setElectricPropulsionDraftValue(workspaceDir, draft as unknown as Awaited<ReturnType<typeof loadElectricPropulsionDraft>>, path, value),
  },
  "chemical-hohmann-transfer": {
    appendConversation: appendChemicalHohmannDraftConversation,
    confirm: async (workspaceDir, draftId) => confirmChemicalHohmannDraft(workspaceDir, draftId),
    create: async (workspaceDir, initialValues, requiredPaths) => createChemicalHohmannDraft(workspaceDir, initialValues, requiredPaths),
    discuss: async ({ connection, draft, message, workspaceDir }) => discussChemicalHohmannDraft({ connection, draft: draft as unknown as Awaited<ReturnType<typeof loadChemicalHohmannDraft>>, message, workspaceDir }),
    execute: async ({ draft, execution, workspaceDir }) => {
      const result = await generateChemicalHohmannMission({ draft: draft as unknown as Awaited<ReturnType<typeof loadChemicalHohmannDraft>>, execution, workspaceDir })
      return { changes: [], result: result.result, runDir: result.runDir, runId: result.runId }
    },
    load: loadChemicalHohmannDraft,
    recordRun: async ({ draft, execution, workspaceDir }) => {
      const snapshotDir = await snapshotChemicalHohmannExecution(execution.runDir)
      if (!snapshotDir) throw new Error("chemical Hohmann execution did not produce artifacts to preserve")
      return recordChemicalHohmannDraftRun(workspaceDir, draft.draftId, { completedAt: new Date().toISOString(), result: execution.result as Parameters<typeof recordChemicalHohmannDraftRun>[2]["result"], runId: path.basename(snapshotDir), runPath: path.relative(workspaceDir, snapshotDir).split(path.sep).join("/") })
    },
    setValue: async (workspaceDir, draft, path, value) => setChemicalHohmannDraftValue(workspaceDir, draft as unknown as Awaited<ReturnType<typeof loadChemicalHohmannDraft>>, path, value),
  },
}

export function missionTemplateRuntime(template: GmatTemplateId): MissionTemplateRuntime {
  const runtime = correctedRuntimes[template] ?? runtimes[template]
  if (!runtime) throw new Error(`unsupported GMAT mission runtime: ${template}`)
  return runtime
}

export function appendMissionTemplateDraftConversation(template: GmatTemplateId, workspaceDir: string, draftId: string, turn: { assistant: string; user: string }) {
  return missionTemplateRuntime(template).appendConversation(workspaceDir, draftId, turn)
}

