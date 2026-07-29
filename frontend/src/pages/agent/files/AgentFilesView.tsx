import { useEffect, useState, type ComponentProps } from 'react'
import { GeneratedFilesTreeCard, type GeneratedFileTreeEntry } from '../../workspace/GeneratedFilesTreeCard'
import type { WorkspaceFilePreview } from '../types'
import { WorkspaceFilePreviewPanel } from '../WorkspaceFilePreviewPanel'
import { listOrbitKeepingFiles, orbitKeepingFileDownloadUrl, type OrbitKeepingFile } from '../orbitKeepingApi'

type AgentFilesViewProps = {
  activeContext: ComponentProps<typeof GeneratedFilesTreeCard>['activeContext']
  handleSelectFile: (entry: GeneratedFileTreeEntry) => void
  selectedFileError: string
  selectedFileLoading: boolean
  selectedFilePath: string
  selectedFilePreview: WorkspaceFilePreview | null
  workspaceRefreshNonce?: number
}

export function AgentFilesView({
  activeContext,
  handleSelectFile,
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
          {gmatFiles.length ? (
            <div className="agent-gmat-files-list">
              {gmatFiles.map(file => (
                <a href={orbitKeepingFileDownloadUrl(file)} key={file.relativePath}>
                  <span>{file.fileName}</span>
                  <small>Download</small>
                </a>
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
