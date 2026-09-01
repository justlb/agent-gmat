import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import type { GeneratedFilesTreeCard, GeneratedFileTreeEntry } from '../../workspace/GeneratedFilesTreeCard'
import type { WorkspaceFilePreview } from '../types'
import { WorkspaceFilePreviewPanel } from '../WorkspaceFilePreviewPanel'
import { joinApiPath } from '../../../app/apiBase'
import { type OrbitKeepingDraft } from '../orbitKeepingApi'
import { GMAT_MISSION_TEMPLATES, missionTemplateForChatMode } from '../gmatMissionTemplates'
import { listMissionTemplateFiles, missionTemplateRuntime, type MissionTemplateFile } from '../missionTemplateRuntime'
import { GmatMissionChat, type GmatMissionChatProps } from './GmatMissionChat'

type MissionFile = MissionTemplateFile
export type GmatSavedDraft = OrbitKeepingDraft & { missionType: MissionFile['missionType'] }

type GmatRun = {
  draftId?: string
  files: MissionFile[]
  latestMtimeMs: number
  missionType: MissionFile['missionType']
  runId: string
  runPath: string
}

function runTimestamp(runId: string) {
  const match = /^(\d{2})-(\d{2})-(\d{2})_(\d{2})-(\d{2})(?:_(\d+))?$/u.exec(runId)
  if (!match) return null
  const [, year, month, day, hour, minute, attempt = '0'] = match
  return Date.UTC(2000 + Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(attempt))
}

function compareRunsNewestFirst(left: GmatRun, right: GmatRun) {
  const leftTimestamp = runTimestamp(left.runId)
  const rightTimestamp = runTimestamp(right.runId)
  if (leftTimestamp !== null && rightTimestamp !== null && leftTimestamp !== rightTimestamp) return rightTimestamp - leftTimestamp
  if (leftTimestamp !== null && rightTimestamp === null) return -1
  if (leftTimestamp === null && rightTimestamp !== null) return 1
  if (left.runId !== right.runId) return left.runId < right.runId ? 1 : -1
  return right.latestMtimeMs - left.latestMtimeMs
}

function draftUpdatedAt(draft: OrbitKeepingDraft) {
  return Date.parse(draft.updatedAt ?? draft.createdAt ?? '') || 0
}

type PlanningDiscussion = {
  createdAt: string
  planningRunId: string
  workspaceDir: string
}

function draftTimestamp(draft: OrbitKeepingDraft) {
  const date = new Date(draft.createdAt ?? '')
  if (Number.isNaN(date.getTime())) return draft.draftId
  const twoDigits = (value: number) => String(value).padStart(2, '0')
  return `${twoDigits(date.getFullYear() % 100)}-${twoDigits(date.getMonth() + 1)}-${twoDigits(date.getDate())}_${twoDigits(date.getHours())}-${twoDigits(date.getMinutes())}`
}

function satelliteDigitalThreadDownloadUrl(draft: GmatSavedDraft, workspaceDir?: string | null) {
  const query = new URLSearchParams({ draftId: draft.draftId, template: draft.missionType, ...(workspaceDir ? { workspaceDir } : {}) }).toString()
  return `${joinApiPath(undefined, '/digital-thread/satellite/draft/download')}?${query}`
}

function draftValuesDownloadUrl(draft: GmatSavedDraft, workspaceDir?: string | null) {
  const base = draft.missionType === 'electric-propulsion-transfer'
    ? '/gmat/electric-propulsion-transfer/drafts'
    : '/gmat/orbit-keeping/drafts'
  const file = draft.missionType === 'electric-propulsion-transfer'
    ? 'electric_propulsion_transfer.values.yaml'
    : 'orbit_keeping.values.yaml'
  const query = new URLSearchParams({ file, ...(workspaceDir ? { workspaceDir } : {}) }).toString()
  return `${joinApiPath(undefined, `${base}/${encodeURIComponent(draft.draftId)}/download`)}?${query}`
}

function missionRunFileDownloadUrl(workspaceDir: string, file: string) {
  const query = new URLSearchParams({ file, workspaceDir }).toString()
  return `${joinApiPath(undefined, '/digital-thread/mission-run/download')}?${query}`
}

function isPrimaryMissionFile(file: string) {
  // The digital thread and the consolidated analysis context are the only
  // user-facing documents. All source scripts, YAML, tool reports and logs
  // remain available, but are implementation artifacts.
  return file === 'satellite.json' || file === 'run-analysis-context.json'
}

function isPrimaryRunFile(file: MissionFile) {
  return file.fileName === 'satellite.json' || file.fileName === 'run-analysis-context.json'
}

function missionLabel(missionType: MissionFile['missionType']) {
  return missionType.replace(/-/gu, ' ')
}

function missionFileDownloadUrl(file: MissionFile, workspaceDir?: string | null) { return missionTemplateRuntime(file.missionType).downloadFile(file, workspaceDir) }

async function listMissionRunFiles(workspaceDir: string) {
  const query = new URLSearchParams({ workspaceDir }).toString()
  const response = await fetch(`${joinApiPath(undefined, '/digital-thread/mission-run/files')}?${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Unable to load mission-run files')
  const payload = await response.json() as { files?: Array<{ fileName: string }> }
  return Array.isArray(payload.files) ? payload.files.map(file => file.fileName) : []
}

type AgentFilesViewProps = {
  activeGmatRunPath?: string
  activeGmatRunId?: GmatMissionChatProps['activeRunId']
  activeContext: ComponentProps<typeof GeneratedFilesTreeCard>['activeContext']
  handleSelectFile: (entry: GeneratedFileTreeEntry) => void
  onSelectGmatDraft?: (draft: GmatSavedDraft) => void
  onSelectGmatRun?: (run: { draftId?: string; missionType: MissionFile['missionType']; runId: string; runPath: string }) => void
  gmatMissionChat: Omit<GmatMissionChatProps, 'activeRunId'>
  selectedFileError: string
  selectedFileLoading: boolean
  selectedFilePath: string
  selectedFilePreview: WorkspaceFilePreview | null
  planningDiscussion?: PlanningDiscussion | null
  missionContent?: ReactNode
  topContent?: ReactNode
  workspaceDir?: string | null
  workspaceRefreshNonce?: number
}

export function AgentFilesView({
  activeGmatRunPath,
  activeGmatRunId,
  activeContext,
  onSelectGmatDraft,
  onSelectGmatRun,
  gmatMissionChat,
  selectedFileError,
  selectedFileLoading,
  selectedFilePath,
  selectedFilePreview,
  planningDiscussion,
  missionContent,
  topContent,
  workspaceDir,
  workspaceRefreshNonce = 0,
}: AgentFilesViewProps) {
  const [gmatFiles, setGmatFiles] = useState<MissionFile[]>([])
  const [gmatDrafts, setGmatDrafts] = useState<GmatSavedDraft[]>([])
  const [gmatFilesError, setGmatFilesError] = useState('')
  const [missionRunFiles, setMissionRunFiles] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      listMissionTemplateFiles(workspaceDir).catch(() => []),
      ...Object.values(GMAT_MISSION_TEMPLATES).map(template => missionTemplateRuntime(template).list(workspaceDir).then(drafts => ({ drafts, template })).catch(() => ({ drafts: [], template }))),
    ])
      .then(([files, ...draftGroups]) => {
        if (!cancelled) {
          setGmatFiles(files)
          setGmatDrafts(draftGroups.flatMap(group => group.drafts.map(draft => ({ ...draft, missionType: group.template }))).sort((left, right) => draftUpdatedAt(right) - draftUpdatedAt(left)))
          setGmatFilesError('')
        }
      })
      .catch(() => { if (!cancelled) setGmatFilesError('Unable to load GMAT files') })
    return () => { cancelled = true }
  }, [gmatMissionChat.draft, workspaceDir, workspaceRefreshNonce])
  useEffect(() => {
    let cancelled = false
    const runWorkspaceDir = activeGmatRunPath ?? planningDiscussion?.workspaceDir
    if (!runWorkspaceDir) { setMissionRunFiles([]); return () => { cancelled = true } }
    void listMissionRunFiles(runWorkspaceDir).then(files => { if (!cancelled) setMissionRunFiles(files) }).catch(() => { if (!cancelled) setMissionRunFiles([]) })
    return () => { cancelled = true }
  }, [activeGmatRunPath, gmatMissionChat.draft, planningDiscussion?.workspaceDir, workspaceRefreshNonce])
  // The API list is asynchronous. Merge the active draft so a freshly opened
  // conversation is visible in the Mission Files panel in the same render.
  const activeDraft = gmatMissionChat.draft?.draftId
    ? { ...gmatMissionChat.draft, missionType: gmatMissionChat.chatMode === 'general' ? 'orbit-keeping' : missionTemplateForChatMode(gmatMissionChat.chatMode) } as unknown as GmatSavedDraft
    : null
  const displayedDrafts = activeDraft && !gmatDrafts.some(draft => draft.draftId === activeDraft.draftId && draft.missionType === activeDraft.missionType)
    ? [activeDraft, ...gmatDrafts]
    : gmatDrafts
  // A planning run records the discussion context, not the editable draft.
  // Keep the active draft visible after a refresh so it can be resumed.
  const visibleDrafts = displayedDrafts
  const gmatRuns = Object.values(gmatFiles.reduce<Record<string, GmatRun>>((groups, file) => {
    const runPath = file.runPath ?? file.relativePath.replace(/[\\/][^\\/]+$/u, '')
    const runId = runPath.split(/[\\/]/u).at(-1) ?? file.artifactId
    const groupKey = `${file.missionType}:${runPath}`
    groups[groupKey] ??= { ...(file.draftId ? { draftId: file.draftId } : {}), files: [], latestMtimeMs: 0, missionType: file.missionType, runId, runPath }
    if (!groups[groupKey].draftId && file.draftId) groups[groupKey].draftId = file.draftId
    groups[groupKey].files.push(file)
    groups[groupKey].latestMtimeMs = Math.max(groups[groupKey].latestMtimeMs, file.mtimeMs)
    return groups
  }, {})).map(run => ({ ...run, files: [...run.files].sort((left, right) => left.mtimeMs - right.mtimeMs || left.fileName.localeCompare(right.fileName)) })).sort(compareRunsNewestFirst)
  const showPlanningDiscussion = Boolean(planningDiscussion)
  const primaryMissionRunFiles = missionRunFiles.filter(isPrimaryMissionFile)


  return (
    <div className="agent-file-stage">
      <aside className="agent-file-tree-pane">
        <section className="agent-gmat-files-card">
          <header>
            <div>
              <strong>GMAT Mission Files</strong>
              <span>Mission drafts, run history and generated files</span>
            </div>
          </header>
          {gmatFilesError ? <p className="agent-gmat-files-error">{gmatFilesError}</p> : null}
          {gmatRuns.length || visibleDrafts.length || showPlanningDiscussion ? (
            <div className="agent-gmat-files-list">
              {showPlanningDiscussion && planningDiscussion ? (
                <section className="agent-gmat-saved-draft agent-gmat-planning-discussion">
                  <header>
                    <strong>Mission discussion · {draftTimestamp({ createdAt: planningDiscussion.createdAt, draftId: planningDiscussion.planningRunId } as OrbitKeepingDraft)}</strong>
                    <small>Routing the GMAT mission scenario</small>
                  </header>
                  {primaryMissionRunFiles.map(file => <a className="agent-gmat-draft-file" href={missionRunFileDownloadUrl(activeGmatRunPath ?? planningDiscussion.workspaceDir, file)} key={file}><span>{file}</span><small>Download</small></a>)}
                  {missionRunFiles.some(file => !isPrimaryMissionFile(file)) ? (
                    <details className="agent-gmat-technical-files">
                      <summary>Technical files ({missionRunFiles.filter(file => !isPrimaryMissionFile(file)).length})</summary>
                      {missionRunFiles.filter(file => !isPrimaryMissionFile(file)).map(file => <a className="agent-gmat-draft-file" href={missionRunFileDownloadUrl(activeGmatRunPath ?? planningDiscussion.workspaceDir, file)} key={file}><span>{file}</span><small>Download</small></a>)}
                    </details>
                  ) : null}
                </section>
              ) : null}
              {gmatRuns.map(run => (
                <section className={activeGmatRunPath === run.runPath ? 'is-active' : ''} key={run.runPath}>
                  <header>
                    <strong>{run.files.some(file => file.historical) ? `Archived ${missionLabel(run.missionType)} · ${run.runId}` : `${missionLabel(run.missionType)} · ${run.runId}`}</strong>
                    {!run.files.some(file => file.historical) && run.files.some(file => file.kind === 'script') ? (
                      <button type="button" onClick={() => onSelectGmatRun?.({ ...(run.draftId ? { draftId: run.draftId } : {}), missionType: run.missionType, runId: run.runId, runPath: run.runPath })}>
                        {activeGmatRunPath === run.runPath ? 'Active conversation' : 'Discuss this run'}
                      </button>
                    ) : <small>{run.files.some(file => file.historical) ? 'Immutable artifact version' : 'Legacy run'}</small>}
                  </header>
                  {run.files.filter(isPrimaryRunFile).map(file => (
                    <a href={missionFileDownloadUrl(file, run.runPath)} key={`${file.missionType}:${file.relativePath}`}>
                      <span>{file.fileName}</span>
                      <small>Download</small>
                    </a>
                  ))}
                  {run.files.some(file => !isPrimaryRunFile(file)) ? (
                    <details className="agent-gmat-technical-files">
                      <summary>Technical files ({run.files.filter(file => !isPrimaryRunFile(file)).length})</summary>
                      {run.files.filter(file => !isPrimaryRunFile(file)).map(file => (
                        <a href={missionFileDownloadUrl(file, run.runPath)} key={`${file.missionType}:${file.relativePath}`}>
                          <span>{file.fileName}</span><small>Download</small>
                        </a>
                      ))}
                    </details>
                  ) : null}
                </section>
              ))}
              {visibleDrafts.map(draft => (
                <section className="agent-gmat-saved-draft" key={`${draft.missionType}:${draft.draftId}`}>
                  <header>
                    <strong>{missionLabel(draft.missionType)} · {draftTimestamp(draft)}</strong>
                    <small>{draft.status === 'confirmed' ? 'Ready to run' : draft.status === 'ready' ? 'Ready to confirm' : 'In discussion'}</small>
                    <button type="button" onClick={() => onSelectGmatDraft?.(draft)}>Resume draft</button>
                  </header>
                  <a className="agent-gmat-draft-digital-thread" href={satelliteDigitalThreadDownloadUrl(draft, workspaceDir)}>
                    <span>Satellite digital thread</span>
                    <small>satellite.json · This discussion's source of truth · Download</small>
                  </a>
                  {['electric-propulsion-transfer', 'orbit-keeping'].includes(draft.missionType) ? <details className="agent-gmat-technical-files"><summary>Technical files (1)</summary><a className="agent-gmat-draft-file" href={draftValuesDownloadUrl(draft, workspaceDir)}>
                    <span>{draft.missionType === 'electric-propulsion-transfer' ? 'electric_propulsion_transfer.values.yaml' : 'orbit_keeping.values.yaml'}</span><small>Download</small>
                  </a></details> : null}
                  <p>{draft.assistantMessage || 'Saved mission draft. Continue the discussion or launch GMAT when it is ready.'}</p>
                </section>
              ))}
            </div>
          ) : <p className="agent-gmat-files-empty">No GMAT mission drafts or files yet.</p>}
        </section>
      </aside>
      <div className="agent-file-log-pane">
        {missionContent ?? <GmatMissionChat {...gmatMissionChat} activeRunId={activeGmatRunId} contextContent={topContent} workspaceDir={activeGmatRunPath ?? workspaceDir} />}
        {selectedFilePath ? <details className="agent-file-preview-details">
          <summary>Preview selected workspace file</summary>
          <WorkspaceFilePreviewPanel
            activeContext={activeContext}
            error={selectedFileError}
            file={selectedFilePreview}
            loading={selectedFileLoading}
            selectedPath={selectedFilePath}
          />
        </details> : null}
      </div>
    </div>
  )
}
