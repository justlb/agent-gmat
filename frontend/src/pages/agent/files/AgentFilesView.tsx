import { useEffect, useState, type ComponentProps } from 'react'
import { GeneratedFilesTreeCard, type GeneratedFileTreeEntry } from '../../workspace/GeneratedFilesTreeCard'
import type { WorkspaceFilePreview } from '../types'
import { WorkspaceFilePreviewPanel } from '../WorkspaceFilePreviewPanel'
import { listOrbitKeepingFiles, orbitKeepingFileDownloadUrl, type OrbitKeepingFile } from '../orbitKeepingApi'

type AgentFilesViewProps = {
  activeGmatRunPath?: string
  activeContext: ComponentProps<typeof GeneratedFilesTreeCard>['activeContext']
  handleSelectFile: (entry: GeneratedFileTreeEntry) => void
  onSelectGmatRun?: (run: { runId: string; runPath: string }) => void
  selectedFileError: string
  selectedFileLoading: boolean
  selectedFilePath: string
  selectedFilePreview: WorkspaceFilePreview | null
  workspaceRefreshNonce?: number
}

export function AgentFilesView({
  activeGmatRunPath,
  activeContext,
  handleSelectFile,
  onSelectGmatRun,
  selectedFileError,
  selectedFileLoading,
  selectedFilePath,
  selectedFilePreview,
  workspaceRefreshNonce = 0,
}: AgentFilesViewProps) {
  const [gmatFiles, setGmatFiles] = useState<OrbitKeepingFile[]>([])
  const [gmatFilesError, setGmatFilesError] = useState('')

  useEffect(() => {
    let cancelled = false
    void listOrbitKeepingFiles()
      .then(files => {
        if (!cancelled) {
          setGmatFiles(files)
          setGmatFilesError('')
        }
      })
      .catch(error => {
        if (!cancelled) setGmatFilesError(error instanceof Error ? error.message : 'Unable to load GMAT files')
      })
    return () => { cancelled = true }
  }, [workspaceRefreshNonce])
  const gmatRuns = Object.values(gmatFiles.reduce<Record<string, { files: OrbitKeepingFile[]; runId: string; runPath: string }>>((groups, file) => {
    const runPath = file.relativePath.replace(/[\\/][^\\/]+$/u, '')
    const runId = runPath.split(/[\\/]/u).at(-1) ?? file.artifactId
    groups[runPath] ??= { files: [], runId, runPath }
    groups[runPath].files.push(file)
    return groups
  }, {}))

  return (
    <div className="agent-file-stage">
      <aside className="agent-file-tree-pane">
        <section className="agent-gmat-files-card">
          <header>
            <div>
              <strong>GMAT Orbit Keeping</strong>
              <span>Generated mission files</span>
            </div>
          </header>
          {gmatFilesError ? <p className="agent-gmat-files-error">{gmatFilesError}</p> : null}
          {gmatRuns.length ? (
            <div className="agent-gmat-files-list">
              {gmatRuns.map(run => (
                <section className={activeGmatRunPath === run.runPath ? 'is-active' : ''} key={run.runPath}>
                  <header>
                    <strong>{run.runId}</strong>
                    {run.files.some(file => file.kind === 'manifest') && run.files.some(file => file.kind === 'result') ? (
                      <button type="button" onClick={() => onSelectGmatRun?.({ runId: run.runId, runPath: run.runPath })}>
                        {activeGmatRunPath === run.runPath ? 'Active conversation' : 'Discuss this run'}
                      </button>
                    ) : <small>Legacy run</small>}
                  </header>
                  {run.files.map(file => (
                    <a href={orbitKeepingFileDownloadUrl(file)} key={file.relativePath}>
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
        {selectedFilePath ? (
          <WorkspaceFilePreviewPanel
            activeContext={activeContext}
            error={selectedFileError}
            file={selectedFilePreview}
            loading={selectedFileLoading}
            selectedPath={selectedFilePath}
          />
        ) : null}
      </div>
    </div>
  )
}
