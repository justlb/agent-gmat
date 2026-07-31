import type { ComponentProps } from 'react'
import type { TFunction } from 'i18next'
import { GncConfigEditor } from '../../../gnc_config/GncConfigEditor'
import { ExecutionFlow } from '../../components/execution-flow/ExecutionFlow'
import MagicRings from '../../components/MagicRings'
import { BomStagePanel } from '../workspace/BomStagePanel'
import { CatchSupportingTableEditor } from '../workspace/CatchSupportingTableEditor'
import { CurrentWorkspaceCard } from '../workspace/CurrentWorkspaceCard'
import { GncDashboardPanel } from '../workspace/GncDashboardPanel'
import { getWorkspaceDisplayName, usesCatchSupportingTable } from '../workspace/workspaceVersion'
import { ComplianceCheckInputConfigEditor } from './ComplianceCheckInputConfigEditor'
import { GmatAnalysisPanel } from './GmatAnalysisPanel'
import type { AgentToolView, AgentWorkspaceView, WorkspaceFilePreview } from './types'
import { AgentFilesView } from './files/AgentFilesView'
import type { GeneratedFileTreeEntry } from '../workspace/GeneratedFilesTreeCard'

type CurrentWorkspaceCardProps = ComponentProps<typeof CurrentWorkspaceCard>
type BomStagePanelProps = ComponentProps<typeof BomStagePanel>
type AgentFilesViewProps = ComponentProps<typeof AgentFilesView>

type AgentWorkspacePanelProps = {
  activeGmatRunPath?: string
  activeGmatRunId?: AgentFilesViewProps['activeGmatRunId']
  activeContext: AgentFilesViewProps['activeContext'] & {
    versionDir?: string | null
    versionId?: string | null
    workspaceName?: string | null
  }
  activeManifestVersion: CurrentWorkspaceCardProps['activeManifestVersion']
  activeTool: AgentToolView
  activeView: AgentWorkspaceView | null
  apiBase?: string
  bomInfo: BomStagePanelProps['bomInfo']
  bomLoading: boolean
  branchManifest: CurrentWorkspaceCardProps['branchManifest']
  cancelDeleteVersion: CurrentWorkspaceCardProps['onCancelDeleteVersion']
  checkoutVersion: CurrentWorkspaceCardProps['onCheckoutVersion']
  confirmDeleteVersion: CurrentWorkspaceCardProps['onConfirmDeleteVersion']
  createChildBranch: CurrentWorkspaceCardProps['onCreateChildBranch']
  createInitialVersion: CurrentWorkspaceCardProps['onCreateInitialVersion']
  createVersionFromInput: CurrentWorkspaceCardProps['onCreateVersionFromInput']
  handleSelectFile: (entry: GeneratedFileTreeEntry) => void
  manifestLoading: boolean
  onSelectGmatRun?: AgentFilesViewProps['onSelectGmatRun']
  gmatMissionChat: AgentFilesViewProps['gmatMissionChat']
  selectedBom: BomStagePanelProps['selectedBom']
  selectedFileError: string
  selectedFileLoading: boolean
  selectedFilePath: string
  selectedFilePreview: WorkspaceFilePreview | null
  setActiveTool: (tool: AgentToolView) => void
  setSelectedBomId: BomStagePanelProps['onSelectBom']
  requestDeleteVersion: CurrentWorkspaceCardProps['onRequestDeleteVersion']
  refreshWorkspaceViews?: () => void
  theme: 'dark' | 'light'
  showComplianceCheckConfig: boolean
  showGncConfig: boolean
  showModelPreview: boolean
  switchActiveWorkspace: CurrentWorkspaceCardProps['onSelectWorkspace']
  t: TFunction
  toolUrls: Partial<Record<AgentToolView, string>>
  versionAction: CurrentWorkspaceCardProps['versionAction']
  versionDeleteTarget: CurrentWorkspaceCardProps['versionDeleteTarget']
  versionError: CurrentWorkspaceCardProps['versionError']
  viewerHref: string
  workspaceChanging: boolean
  workspaceItems: CurrentWorkspaceCardProps['workspaceItems']
  workspaceRefreshNonce?: number
}

function getWorkspacePanelTitle(activeView: AgentWorkspaceView | null, showComplianceCheckConfig: boolean, showGncConfig: boolean) {
  if (activeView === 'workspace') return 'Workspace'
  if (activeView === 'bom' && showComplianceCheckConfig) return 'Config'
  if (activeView === 'bom') return showGncConfig ? 'GNC Config' : 'Config'
  if (activeView === 'model') return 'Preview'
  if (activeView === 'tools') return showGncConfig ? 'GNC Tools' : 'Simulation Tools'
  if (activeView === 'log') return 'Workspace Files'
  return 'Voice chat'
}

export function AgentWorkspacePanel({
  activeGmatRunPath,
  activeGmatRunId,
  activeContext,
  activeManifestVersion,
  activeTool,
  activeView,
  apiBase,
  bomInfo,
  bomLoading,
  branchManifest,
  cancelDeleteVersion,
  checkoutVersion,
  confirmDeleteVersion,
  createChildBranch,
  createInitialVersion,
  createVersionFromInput,
  handleSelectFile,
  manifestLoading,
  onSelectGmatRun,
  gmatMissionChat,
  selectedBom,
  selectedFileError,
  selectedFileLoading,
  selectedFilePath,
  selectedFilePreview,
  setActiveTool,
  setSelectedBomId,
  requestDeleteVersion,
  refreshWorkspaceViews,
  theme,
  showComplianceCheckConfig,
  showGncConfig,
  showModelPreview,
  switchActiveWorkspace,
  t,
  toolUrls,
  versionAction,
  versionDeleteTarget,
  versionError,
  viewerHref,
  workspaceChanging,
  workspaceItems,
  workspaceRefreshNonce = 0,
}: AgentWorkspacePanelProps) {
  const panelClassName = [
    'agent-workspace-panel',
    activeView ? 'is-open' : 'is-collapsed',
    activeView ? `is-${activeView}-view` : '',
  ].filter(Boolean).join(' ')
  const toolTabs: AgentToolView[] = showGncConfig
    ? ['gnc-dashboard', 'gnc']
    : ['gmat-analysis', 'cad', 'paraview', 'comsol']
  const toolLabel = (tool: AgentToolView) => {
    if (tool === 'cad') return 'CAD'
    if (tool === 'paraview') return 'ParaView'
    if (tool === 'comsol') return 'COMSOL'
    if (tool === 'gnc-dashboard') return 'GNC Dashboard'
    if (tool === 'gmat-analysis') return 'GMAT Analysis'
    return 'GNC'
  }
  const thermalConfigContent = usesCatchSupportingTable(activeContext) ? (
    <CatchSupportingTableEditor
      activeContext={activeContext}
      apiBase={apiBase}
      onSaved={refreshWorkspaceViews}
    />
  ) : (
    <BomStagePanel
      bomInfo={bomInfo}
      bomLoading={bomLoading}
      onSelectBom={setSelectedBomId}
      selectedBom={selectedBom}
      t={t}
    />
  )

  return (
    <section className={panelClassName}>
      {!activeView && (
        <>
          <MagicRings
            color="#558ef7"
            colorTwo="#6366F1"
            ringCount={6}
            speed={1}
            attenuation={10}
            lineThickness={2}
            baseRadius={0.35}
            radiusStep={0.1}
            scaleRate={0.1}
            opacity={1}
            blur={0}
            noiseAmount={0.1}
            rotation={0}
            ringGap={1.5}
            fadeIn={0.7}
            fadeOut={0.5}
            followMouse={false}
            mouseInfluence={0.2}
            hoverScale={1.2}
            parallax={0.05}
            clickBurst={false}
          />
          <span className="agent-collapsed-wave" />
        </>
      )}
      <div className="agent-workspace-header">
        <div>
          <strong>{getWorkspacePanelTitle(activeView, showComplianceCheckConfig, showGncConfig)}</strong>
          <span>{activeView ? `${getWorkspaceDisplayName(activeContext.workspaceName)}${activeContext.versionId ? ` · ${activeContext.versionId}` : ''}` : 'Choose a section from the left navigation'}</span>
        </div>
        {activeView === 'tools' && (
          <div className="agent-tool-tabs">
            {toolTabs.map(tool => (
              <button
                key={tool}
                type="button"
                className={activeTool === tool ? 'active' : undefined}
                onClick={() => setActiveTool(tool)}
              >
                {toolLabel(tool)}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="agent-workspace-body">
        {!activeView ? (
          <div className="agent-empty-state">The workspace is collapsed. Select a section from the left navigation.</div>
        ) : activeView === 'workspace' ? (
          <CurrentWorkspaceCard
            activeManifestVersion={activeManifestVersion}
            branchManifest={branchManifest}
            currentWorkspaceName={activeContext.workspaceName ?? 'Current workspace'}
            manifestLoading={manifestLoading}
            onCheckoutVersion={checkoutVersion}
            onCancelDeleteVersion={cancelDeleteVersion}
            onConfirmDeleteVersion={confirmDeleteVersion}
            onCreateChildBranch={createChildBranch}
            onCreateInitialVersion={createInitialVersion}
            onCreateVersionFromInput={createVersionFromInput}
            onRequestDeleteVersion={requestDeleteVersion}
            onSelectWorkspace={switchActiveWorkspace}
            versionAction={versionAction}
            versionDeleteTarget={versionDeleteTarget}
            versionError={versionError}
            workspaceChanging={workspaceChanging}
            workspaceItems={workspaceItems}
          />
        ) : activeView === 'bom' && showComplianceCheckConfig ? (
          <ComplianceCheckInputConfigEditor activeContext={activeContext} />
        ) : activeView === 'bom' && showGncConfig ? (
          <GncConfigEditor activeContext={activeContext} />
        ) : activeView === 'bom' ? (
          <div className="agent-thermal-config">
            <section className="agent-thermal-flow-panel">
              <ExecutionFlow
                className="execution-flow-embedded"
                height={360}
                showThemeSwitch={false}
                theme={theme}
                versionId={activeContext.versionId ?? undefined}
                workspaceDir={activeContext.versionDir ?? undefined}
                workspaceId={activeContext.workspaceId ?? undefined}
              />
            </section>
            {thermalConfigContent}
          </div>
        ) : activeView === 'model' && showModelPreview ? (
          activeContext.versionDir ? (
            <iframe className="agent-embed-frame" title="Results preview" src={viewerHref} />
          ) : (
            <div className="agent-empty-state">Waiting for this task to generate a preview.</div>
          )
        ) : activeView === 'model' ? (
          <div className="agent-empty-state">This task has no 3D preview.</div>
        ) : activeView === 'tools' && activeTool === 'gnc-dashboard' && showGncConfig ? (
          <GncDashboardPanel activeContext={activeContext} />
        ) : activeView === 'tools' && activeTool === 'gmat-analysis' ? (
          <GmatAnalysisPanel runPath={activeGmatRunPath} />
        ) : activeView === 'tools' ? (
          toolUrls[activeTool] ? (
            <iframe className="agent-embed-frame" title={activeTool} src={toolUrls[activeTool]} />
          ) : (
            <div className="agent-empty-state">This simulation tool has no remote window available.</div>
          )
        ) : (
          <AgentFilesView
            activeGmatRunPath={activeGmatRunPath}
            activeGmatRunId={activeGmatRunId}
            activeContext={activeContext}
            handleSelectFile={handleSelectFile}
            onSelectGmatRun={onSelectGmatRun}
            gmatMissionChat={gmatMissionChat}
            selectedFileError={selectedFileError}
            selectedFileLoading={selectedFileLoading}
            selectedFilePath={selectedFilePath}
            selectedFilePreview={selectedFilePreview}
            workspaceRefreshNonce={workspaceRefreshNonce}
          />
        )}
      </div>
    </section>
  )
}
