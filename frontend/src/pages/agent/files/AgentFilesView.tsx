import { useEffect, useState, type ComponentProps, type ReactNode } from 'react'
import type { GeneratedFilesTreeCard, GeneratedFileTreeEntry } from '../../workspace/GeneratedFilesTreeCard'
import type { WorkspaceFilePreview } from '../types'
import { WorkspaceFilePreviewPanel } from '../WorkspaceFilePreviewPanel'
import { joinApiPath } from '../../../app/apiBase'
import { listOrbitKeepingDrafts, listOrbitKeepingFiles, orbitKeepingFileDownloadUrl, type OrbitKeepingDraft, type OrbitKeepingFile } from '../orbitKeepingApi'
import { electricPropulsionFileDownloadUrl, listElectricPropulsionDrafts, listElectricPropulsionFiles, type ElectricPropulsionFile } from '../electricPropulsionApi'
import { GmatMissionChat, type GmatMissionChatProps } from './GmatMissionChat'

type MissionFile = (OrbitKeepingFile | ElectricPropulsionFile) & { missionType: 'electric-propulsion-transfer' | 'orbit-keeping' }
export type GmatSavedDraft = OrbitKeepingDraft & { missionType: MissionFile['missionType'] }

type GmatRun = {
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

function planningDigitalThreadDownloadUrl(planningRun: PlanningDiscussion) {
  const query = new URLSearchParams({ workspaceDir: planningRun.workspaceDir }).toString()
  return `${joinApiPath(undefined, '/digital-thread/satellite/download')}?${query}`
}

type AgentFilesViewProps = {
  activeGmatRunPath?: string
  activeGmatRunId?: GmatMissionChatProps['activeRunId']
  activeContext: ComponentProps<typeof GeneratedFilesTreeCard>['activeContext']
  handleSelectFile: (entry: GeneratedFileTreeEntry) => void
  onSelectGmatDraft?: (draft: GmatSavedDraft) => void
  onSelectGmatRun?: (run: { runId: string; runPath: string }) => void
  gmatMissionChat: Omit<GmatMissionChatProps, 'activeRunId'>
  selectedFileError: string
  selectedFileLoading: boolean
  selectedFilePath: string
  selectedFilePreview: WorkspaceFilePreview | null
  planningDiscussion?: PlanningDiscussion | null
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
  topContent,
  workspaceDir,
  workspaceRefreshNonce = 0,
}: AgentFilesViewProps) {
  const [gmatFiles, setGmatFiles] = useState<MissionFile[]>([])
  const [gmatDrafts, setGmatDrafts] = useState<GmatSavedDraft[]>([])
  const [gmatFilesError, setGmatFilesError] = useState('')

  useEffect(() => {
    let cancelled = false
    void Promise.all([listOrbitKeepingFiles(), listElectricPropulsionFiles(), listOrbitKeepingDrafts(workspaceDir), listElectricPropulsionDrafts(workspaceDir)])
      .then(([orbitKeepingFiles, electricPropulsionFiles, orbitKeepingDrafts, electricPropulsionDrafts]) => {
        if (!cancelled) {
          setGmatFiles([
            ...orbitKeepingFiles.map(file => ({ ...file, missionType: 'orbit-keeping' as const })),
            ...electricPropulsionFiles.map(file => ({ ...file, missionType: 'electric-propulsion-transfer' as const })),
          ].sort((left, right) => right.mtimeMs - left.mtimeMs))
          setGmatDrafts([
            ...orbitKeepingDrafts.map(draft => ({ ...draft, missionType: 'orbit-keeping' as const })),
            ...electricPropulsionDrafts.map(draft => ({ ...draft, missionType: 'electric-propulsion-transfer' as const })),
          ].sort((left, right) => draftUpdatedAt(right) - draftUpdatedAt(left)))
          setGmatFilesError('')
        }
      })
      .catch(error => {
        if (!cancelled) setGmatFilesError(error instanceof Error ? error.message : 'Unable to load GMAT files')
    })
    return () => { cancelled = true }
  }, [gmatMissionChat.draft, workspaceDir, workspaceRefreshNonce])
  // The API list is asynchronous. Merge the active draft so a freshly opened
  // conversation is visible in the Mission Files panel in the same render.
  const activeDraft = gmatMissionChat.draft?.draftId
    ? { ...gmatMissionChat.draft, missionType: gmatMissionChat.chatMode === 'gmat-electric-propulsion' ? 'electric-propulsion-transfer' as const : 'orbit-keeping' as const }
    : null
  const displayedDrafts = activeDraft && !gmatDrafts.some(draft => draft.draftId === activeDraft.draftId && draft.missionType === activeDraft.missionType)
    ? [activeDraft, ...gmatDrafts]
    : gmatDrafts
  const gmatRuns = Object.values(gmatFiles.reduce<Record<string, GmatRun>>((groups, file) => {
    const runPath = file.relativePath.replace(/[\\/][^\\/]+$/u, '')
    const runId = runPath.split(/[\\/]/u).at(-1) ?? file.artifactId
    const groupKey = `${file.missionType}:${runPath}`
    groups[groupKey] ??= { files: [], latestMtimeMs: 0, missionType: file.missionType, runId, runPath }
    groups[groupKey].files.push(file)
    groups[groupKey].latestMtimeMs = Math.max(groups[groupKey].latestMtimeMs, file.mtimeMs)
    return groups
  }, {})).map(run => ({ ...run, files: [...run.files].sort((left, right) => left.mtimeMs - right.mtimeMs || left.fileName.localeCompare(right.fileName)) })).sort(compareRunsNewestFirst)
  const showPlanningDiscussion = Boolean(planningDiscussion)


  return (
    <div className="agent-file-stage">
      <aside className="agent-file-tree-pane">
        <section className="agent-gmat-files-card">
          <header>
            <div>
              <strong>GMAT Mission Files</strong>
              <span>Mission drafts and generated files</span>
            </div>
          </header>
          {gmatFilesError ? <p className="agent-gmat-files-error">{gmatFilesError}</p> : null}
          {gmatRuns.length || displayedDrafts.length || showPlanningDiscussion ? (
            <div className="agent-gmat-files-list">
              {showPlanningDiscussion && planningDiscussion ? (
                <section className="agent-gmat-planning-discussion">
                  <header>
                    <strong>Mission discussion · {draftTimestamp({ createdAt: planningDiscussion.createdAt, draftId: planningDiscussion.planningRunId } as OrbitKeepingDraft)}</strong>
                    <small>Routing the GMAT template</small>
                  </header>
                  <a className="agent-gmat-draft-digital-thread" href={planningDigitalThreadDownloadUrl(planningDiscussion)}>
                    <span>Satellite digital thread</span>
                    <small>satellite.json · This discussion's source of truth · Download</small>
                  </a>
                  <p>Your mission description is being saved. Select a satellite, then continue the discussion to create the matching GMAT draft.</p>
                </section>
              ) : null}
              {gmatRuns.map(run => (
                <section className={activeGmatRunPath === run.runPath ? 'is-active' : ''} key={run.runPath}>
                  <header>
                    <strong>{run.missionType === 'electric-propulsion-transfer' ? 'Electric Transfer' : 'Orbit Keeping'} · {run.runId}</strong>
                    {run.files.some(file => file.kind === 'manifest') && run.files.some(file => file.kind === 'result') ? (
                      <button type="button" onClick={() => onSelectGmatRun?.({ runId: run.runId, runPath: run.runPath })}>
                        {activeGmatRunPath === run.runPath ? 'Active conversation' : 'Discuss this run'}
                      </button>
                    ) : <small>Legacy run</small>}
                  </header>
                  {run.files.map(file => (
                    <a href={file.missionType === 'electric-propulsion-transfer' ? electricPropulsionFileDownloadUrl(file) : orbitKeepingFileDownloadUrl(file)} key={`${file.missionType}:${file.relativePath}`}>
                      <span>{file.fileName}</span>
                      <small>Download</small>
                    </a>
                  ))}
                </section>
              ))}
              {displayedDrafts.map(draft => (
                <section className="agent-gmat-saved-draft" key={`${draft.missionType}:${draft.draftId}`}>
                  <header>
                    <strong>{draft.missionType === 'electric-propulsion-transfer' ? 'Electric Transfer' : 'Orbit Keeping'} · {draftTimestamp(draft)}</strong>
                    <small>{draft.status === 'confirmed' ? 'Ready to run' : draft.status === 'ready' ? 'Ready to confirm' : 'In discussion'}</small>
                    <button type="button" onClick={() => onSelectGmatDraft?.(draft)}>Resume draft</button>
                  </header>
                  <a className="agent-gmat-draft-digital-thread" href={satelliteDigitalThreadDownloadUrl(draft, workspaceDir)}>
                    <span>Satellite digital thread</span>
                    <small>satellite.json · This discussion's source of truth · Download</small>
                  </a>
                  <a className="agent-gmat-draft-file" href={draftValuesDownloadUrl(draft, workspaceDir)}>
                    <span>{draft.missionType === 'electric-propulsion-transfer' ? 'electric_propulsion_transfer.values.yaml' : 'orbit_keeping.values.yaml'}</span>
                    <small>Download</small>
                  </a>
                  <p>{draft.assistantMessage || 'Saved mission draft. Continue the discussion or launch GMAT when it is ready.'}</p>
                </section>
              ))}
            </div>
          ) : <p className="agent-gmat-files-empty">No GMAT mission drafts or files yet.</p>}
        </section>
      </aside>
      <div className="agent-file-log-pane">
        {topContent}
        <GmatMissionChat activeRunId={activeGmatRunId} workspaceDir={workspaceDir} {...gmatMissionChat} />
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
