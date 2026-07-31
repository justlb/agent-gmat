import { useEffect, useState, type ComponentProps } from 'react'
import { GeneratedFilesTreeCard, type GeneratedFileTreeEntry } from '../../workspace/GeneratedFilesTreeCard'
import type { WorkspaceFilePreview } from '../types'
import { WorkspaceFilePreviewPanel } from '../WorkspaceFilePreviewPanel'
import { listOrbitKeepingFiles, orbitKeepingFileDownloadUrl, type OrbitKeepingFile } from '../orbitKeepingApi'
import { electricPropulsionFileDownloadUrl, listElectricPropulsionFiles, type ElectricPropulsionFile } from '../electricPropulsionApi'
import { GmatMissionChat, type GmatMissionChatProps } from './GmatMissionChat'

type MissionFile = (OrbitKeepingFile | ElectricPropulsionFile) & { missionType: 'electric-propulsion-transfer' | 'orbit-keeping' }

type AgentFilesViewProps = {
  activeGmatRunPath?: string
  activeGmatRunId?: GmatMissionChatProps['activeRunId']
  activeContext: ComponentProps<typeof GeneratedFilesTreeCard>['activeContext']
  handleSelectFile: (entry: GeneratedFileTreeEntry) => void
  onSelectGmatRun?: (run: { runId: string; runPath: string }) => void
  gmatMissionChat: Omit<GmatMissionChatProps, 'activeRunId'>
  selectedFileError: string
  selectedFileLoading: boolean
  selectedFilePath: string
  selectedFilePreview: WorkspaceFilePreview | null
  workspaceRefreshNonce?: number
}

export function AgentFilesView({
  activeGmatRunPath,
  activeGmatRunId,
  activeContext,
  handleSelectFile,
  onSelectGmatRun,
  gmatMissionChat,
  selectedFileError,
  selectedFileLoading,
  selectedFilePath,
  selectedFilePreview,
  workspaceRefreshNonce = 0,
}: AgentFilesViewProps) {
  const [gmatFiles, setGmatFiles] = useState<MissionFile[]>([])
  const [gmatFilesError, setGmatFilesError] = useState('')

  useEffect(() => {
    let cancelled = false
    void Promise.all([listOrbitKeepingFiles(), listElectricPropulsionFiles()])
      .then(([orbitKeepingFiles, electricPropulsionFiles]) => {
        if (!cancelled) {
          setGmatFiles([
            ...orbitKeepingFiles.map(file => ({ ...file, missionType: 'orbit-keeping' as const })),
            ...electricPropulsionFiles.map(file => ({ ...file, missionType: 'electric-propulsion-transfer' as const })),
          ].sort((left, right) => right.mtimeMs - left.mtimeMs))
          setGmatFilesError('')
        }
      })
      .catch(error => {
        if (!cancelled) setGmatFilesError(error instanceof Error ? error.message : 'Unable to load GMAT files')
      })
    return () => { cancelled = true }
  }, [workspaceRefreshNonce])
  const gmatRuns = Object.values(gmatFiles.reduce<Record<string, { files: MissionFile[]; missionType: MissionFile['missionType']; runId: string; runPath: string }>>((groups, file) => {
    const runPath = file.relativePath.replace(/[\\/][^\\/]+$/u, '')
    const runId = runPath.split(/[\\/]/u).at(-1) ?? file.artifactId
    const groupKey = `${file.missionType}:${runPath}`
    groups[groupKey] ??= { files: [], missionType: file.missionType, runId, runPath }
    groups[groupKey].files.push(file)
    return groups
  }, {}))

  return (
    <div className="agent-file-stage">
      <aside className="agent-file-tree-pane">
        <section className="agent-gmat-files-card">
          <header>
            <div>
              <strong>GMAT Mission Files</strong>
              <span>Generated mission files</span>
            </div>
          </header>
          {gmatFilesError ? <p className="agent-gmat-files-error">{gmatFilesError}</p> : null}
          {gmatRuns.length ? (
            <div className="agent-gmat-files-list">
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
            </div>
          ) : <p className="agent-gmat-files-empty">No GMAT files generated yet.</p>}
        </section>
        <GeneratedFilesTreeCard
          activeContext={activeContext}
          onSelectFile={handleSelectFile}
          refreshNonce={workspaceRefreshNonce}
          selectedFilePath={selectedFilePath}
        />
      </aside>
      <div className="agent-file-log-pane">
        <GmatMissionChat activeRunId={activeGmatRunId} {...gmatMissionChat} />
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
