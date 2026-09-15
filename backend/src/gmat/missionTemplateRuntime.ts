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
import { generateElectricalLeoOrbitMaintenanceMission } from "./electricalLeoOrbitMaintenance.service.js"
import { defaultElectricPropulsionTemplatePath } from "./electricPropulsionTemplate.js"
import { extractElectricPropulsionValues } from "./electricPropulsionValues.js"
import { generateOrbitKeepingMission } from "./orbitKeeping.service.js"
import { defaultOrbitKeepingTemplatePath } from "./orbitKeepingTemplate.js"
import { extractOrbitKeepingValues } from "./orbitKeepingValues.js"
import type { GmatTemplateId } from "./templateRegistry.js"
import { appendChemical3dDraftConversation, confirmChemical3dDraft, createChemical3dDraft, discussChemical3dDraft, generateChemical3dMission, loadChemical3dDraft, recordChemical3dDraftRun, setChemical3dDraftValue } from "./chemical3dTransfer.js"
import { appendChemicalEscapeDraftConversation, confirmChemicalEscapeDraft, createChemicalEscapeDraft, discussChemicalEscapeDraft, generateChemicalEscapeMission, loadChemicalEscapeDraft, recordChemicalEscapeDraftRun, setChemicalEscapeDraftValue, type ChemicalEscapeDraft } from "./chemicalEscape.js"

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
const runtimes: Record<GmatTemplateId, MissionTemplateRuntime> = {
  "chemical-escape": {
    appendConversation: appendChemicalEscapeDraftConversation,
    confirm: async (workspaceDir, draftId) => confirmChemicalEscapeDraft(workspaceDir, draftId),
    create: async (workspaceDir, initialValues, requiredPaths) => createChemicalEscapeDraft(workspaceDir, initialValues, requiredPaths),
    discuss: async ({ connection, draft, message, workspaceDir }) => discussChemicalEscapeDraft({ connection, draft: draft as ChemicalEscapeDraft, message, workspaceDir }),
    execute: async ({ draft, execution, workspaceDir }) => generateChemicalEscapeMission({ draft: draft as ChemicalEscapeDraft, execution, workspaceDir }),
    load: loadChemicalEscapeDraft,
    recordRun: async ({ draft, execution, runPath, workspaceDir }) => recordChemicalEscapeDraftRun(workspaceDir, draft.draftId, { completedAt: new Date().toISOString(), result: execution.result as ChemicalEscapeDraft["runs"][number]["result"], runId: execution.runId, runPath }),
    setValue: async (workspaceDir, draft, field, value) => setChemicalEscapeDraftValue(workspaceDir, draft as ChemicalEscapeDraft, field, value),
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
      const values = extractOrbitKeepingValues(await fs.readFile(defaultOrbitKeepingTemplatePath(), "utf8"))
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
  "electrical-leo-orbit-maintenance": {
    appendConversation: appendElectricPropulsionDraftConversation,
    confirm: confirmElectricPropulsionDraft,
    create: async (workspaceDir, initialValues, requiredPaths) => createElectricPropulsionDraft(workspaceDir, initialValues, requiredPaths),
    discuss: async ({ connection, draft, message, workspaceDir }) => discussElectricPropulsionDraft({ connection, draft: draft as unknown as Awaited<ReturnType<typeof loadElectricPropulsionDraft>>, message, workspaceDir }),
    execute: async ({ draft, execution, workspaceDir }) => {
      const electricDraft = draft as unknown as Awaited<ReturnType<typeof loadElectricPropulsionDraft>>
      const result = await generateElectricalLeoOrbitMaintenanceMission({ changes: draftToElectricPropulsionChanges(electricDraft, extractElectricPropulsionValues(await fs.readFile(defaultElectricPropulsionTemplatePath(), "utf8"))), execution, missionValues: electricDraft.values, request: `Confirmed electrical LEO orbit-maintenance draft ${draft.draftId}`, workspaceDir })
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
  return runtimes[template]
}

export function appendMissionTemplateDraftConversation(template: GmatTemplateId, workspaceDir: string, draftId: string, turn: { assistant: string; user: string }) {
  return missionTemplateRuntime(template).appendConversation(workspaceDir, draftId, turn)
}
