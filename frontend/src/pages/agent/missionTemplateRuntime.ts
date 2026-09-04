import { buildApiUrl, requestApiJson } from '../../app/apiClient'
import { type OrbitKeepingDraft, type OrbitKeepingGenerateResult, type OrbitKeepingProgressEvent } from './orbitKeepingApi'
import { GMAT_MISSION_TEMPLATES, type GmatMissionTemplateId } from './gmatMissionTemplates'

export type MissionTemplateExecutionOptions = {
  onProgress: (event: OrbitKeepingProgressEvent) => void
  workspaceDir?: string | null
}

export type MissionTemplateFile = {
  artifactId: string
  draftId?: string
  fileName: string
  historical?: boolean
  kind: string
  missionType: GmatMissionTemplateId
  mtimeMs: number
  primary?: boolean
  relativePath: string
  runPath?: string
  size: number
}

export type MissionTemplateFrontendRuntime = {
  confirm: (draftId: string, workspaceDir?: string | null) => Promise<OrbitKeepingDraft>
  create: (workspaceDir?: string | null) => Promise<OrbitKeepingDraft>
  discuss: (draftId: string, message: string, workspaceDir?: string | null) => Promise<OrbitKeepingDraft>
  downloadFile: (file: MissionTemplateFile, workspaceDir?: string | null) => string
  execute: (draftId: string, options: MissionTemplateExecutionOptions) => Promise<OrbitKeepingGenerateResult>
  prepare: (draftId: string, workspaceDir?: string | null) => Promise<OrbitKeepingGenerateResult>
  list: (workspaceDir?: string | null) => Promise<OrbitKeepingDraft[]>
  listFiles: (workspaceDir?: string | null) => Promise<MissionTemplateFile[]>
  runFullPipeline: (draftId: string, workspaceDir?: string | null) => Promise<OrbitKeepingGenerateResult>
}

function asMissionDraft(draft: unknown) { return draft as OrbitKeepingDraft }

function requireWorkspace(workspaceDir?: string | null) {
  if (!workspaceDir) throw new Error('Start a dated mission discussion before editing a GMAT draft.')
  return workspaceDir
}

function templateDraftPath(template: GmatMissionTemplateId, suffix = '') {
  return `/gmat/templates/${encodeURIComponent(template)}/drafts${suffix}`
}

function genericRuntime(template: GmatMissionTemplateId): MissionTemplateFrontendRuntime {
  return {
    confirm: async (draftId, workspaceDir) => asMissionDraft(await requestApiJson(templateDraftPath(template, `/${encodeURIComponent(draftId)}/confirm`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir: requireWorkspace(workspaceDir) }),
    })),
    create: async workspaceDir => asMissionDraft(await requestApiJson(templateDraftPath(template), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir: requireWorkspace(workspaceDir) }),
    })),
    discuss: async (draftId, message, workspaceDir) => asMissionDraft(await requestApiJson(templateDraftPath(template, `/${encodeURIComponent(draftId)}/messages`), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message, workspaceDir: requireWorkspace(workspaceDir) }),
    })),
    downloadFile: (file, workspaceDir) => workspaceDir ? buildApiUrl(templateDraftPath(template, '/files/download').replace('/drafts/files', '/files'), { query: { relativePath: file.relativePath, workspaceDir } }) : '#',
    execute: async (draftId, { onProgress, workspaceDir }) => {
      onProgress({ key: 'run_gmat', percent: 0, status: 'running' })
      const execution = await requestApiJson<{
        changes?: OrbitKeepingGenerateResult['changes']
        draft?: OrbitKeepingDraft
        result: OrbitKeepingGenerateResult['result']
        runId: string
        runPath: string
      }>(templateDraftPath(template, `/${encodeURIComponent(draftId)}/execute`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir: requireWorkspace(workspaceDir) }),
      })
      onProgress({ key: 'run_gmat', percent: 100, status: 'completed' })
      return {
        changes: execution.changes ?? [], draftId, latencyMs: execution.result.executionDurationMs ?? 0,
        manifestPath: '', result: execution.result, resultPath: '', runId: execution.runId,
        runPath: execution.runPath, scriptPath: '', timeSeriesPath: '', valuesPath: '',
      }
    },
    prepare: async (draftId, workspaceDir) => {
      const output = await requestApiJson<{ generation: { changes?: OrbitKeepingGenerateResult['changes']; result: OrbitKeepingGenerateResult['result']; runId: string }; runPath: string }>(templateDraftPath(template, `/${encodeURIComponent(draftId)}/prepare`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir: requireWorkspace(workspaceDir) }),
      })
      return { changes: output.generation.changes ?? [], draftId, latencyMs: 0, manifestPath: '', result: output.generation.result, resultPath: '', runId: output.generation.runId, runPath: output.runPath, scriptPath: '', timeSeriesPath: '', valuesPath: '' }
    },
    runFullPipeline: async (draftId, workspaceDir) => {
      const output = await requestApiJson<{ execution: { changes?: OrbitKeepingGenerateResult['changes']; result: OrbitKeepingGenerateResult['result']; runId: string; runPath?: string }; runPath?: string }>(templateDraftPath(template, `/${encodeURIComponent(draftId)}/run-full-pipeline`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir: requireWorkspace(workspaceDir) }),
      })
      return { changes: output.execution.changes ?? [], draftId, latencyMs: output.execution.result.executionDurationMs ?? 0, manifestPath: '', result: output.execution.result, resultPath: '', runId: output.execution.runId, runPath: output.runPath ?? output.execution.runPath ?? '', scriptPath: '', timeSeriesPath: '', valuesPath: '' }
    },
    list: async workspaceDir => {
      if (!workspaceDir) return []
      const payload = await requestApiJson<{ drafts?: unknown[] }>(templateDraftPath(template), { cache: 'no-store', query: { workspaceDir } })
      return Array.isArray(payload.drafts) ? payload.drafts.map(asMissionDraft) : []
    },
    listFiles: async workspaceDir => {
      const payload = await requestApiJson<{ files?: Array<Omit<MissionTemplateFile, 'missionType'>> }>(templateDraftPath(template, '/files').replace('/drafts/files', '/files'), { cache: 'no-store', query: { workspaceDir } })
      return Array.isArray(payload.files) ? payload.files.map(file => ({ ...file, missionType: template })) : []
    },
  }
}

const runtimes = Object.fromEntries(
  Object.values(GMAT_MISSION_TEMPLATES).map(template => [template, genericRuntime(template)]),
) as Record<GmatMissionTemplateId, MissionTemplateFrontendRuntime>

/** Template-specific API differences are isolated here. Mission Studio only
 * consumes this uniform lifecycle. */
export function missionTemplateRuntime(template: GmatMissionTemplateId) { return runtimes[template] }

export async function listMissionTemplateFiles(workspaceDir?: string | null) {
  // A legacy template endpoint must not hide artifacts emitted by another
  // template. Each successful listing contributes independently.
  const listings = await Promise.allSettled(Object.values(runtimes).map(runtime => runtime.listFiles(workspaceDir)))
  return listings.flatMap(listing => listing.status === 'fulfilled' ? listing.value : []).sort((left, right) => right.mtimeMs - left.mtimeMs)
}
