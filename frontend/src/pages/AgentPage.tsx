import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { joinApiPath } from '../app/apiBase'
import { getGncToolUrl, getRemoteToolUrl } from '../app/runtimeConfig'
import { useBomInfo } from '../hooks/useBomInfo'
import { useWorkspaceAppState } from '../hooks/useWorkspaceAppState'
import { formatProgressUpdatedAt, type WorkflowLoopProgressEntry, type WorkflowProgressVariant } from './workspace/progressUtils'
import { useWorkspaceRuntimeData } from './workspace/useWorkspaceRuntimeData'
import { useWorkspaceVersionState } from './workspace/useWorkspaceVersionState'
import { getWorkspaceDisplayName, isThermalCadWorkspace } from './workspace/workspaceVersion'
import { getVisibleWorkspaceSessionState } from './workspace/workspaceSessionVisibility'
import { AgentProgressRail } from './agent/AgentProgressRail'
import { AgentConversationPopover } from './agent/AgentConversationPopover'
import { AgentRecorderControl } from './agent/AgentRecorderControl'
import { AgentSideNav } from './agent/AgentSideNav'
import { AgentTopbar, type RemoteToolPortSummary } from './agent/AgentTopbar'
import { AgentWorkspacePanel } from './agent/AgentWorkspacePanel'
import type { GmatSavedDraft } from './agent/files/AgentFilesView'
import { cancelManagedCodex, getLatestManagedCodexStatus, summarizeManagedCodex, type ManagedModelBackend } from './agent/managedRun'
import { confirmElectricPropulsionDraft, createElectricPropulsionDraft, discussElectricPropulsionDraft, executeElectricPropulsionDraftWithProgress, getElectricPropulsionRunConversation, listElectricPropulsionDrafts, openElectricPropulsionRunInGui } from './agent/electricPropulsionApi'
import { confirmOrbitKeepingDraft, createOrbitKeepingDraft, discussOrbitKeepingDraft, executeOrbitKeepingDraftWithProgress, getOrbitKeepingRunConversation, listOrbitKeepingDrafts, openOrbitKeepingRunInGui, type OrbitKeepingDraft, type OrbitKeepingGenerateResult, type OrbitKeepingRunConversationTurn } from './agent/orbitKeepingApi'
import { routeMissionMessage } from './agent/missionRoutingApi'
import { askMissionAssistant } from './agent/missionAssistantApi'
import { cancelGmatCalculations, getRunWorkflowLog, openPreparedOpalisScenario, openSimuCicGui, runOpalisScenario, runSimuCic, type RunWorkflowLog } from './agent/simuCicApi'
import { createPlanningRun, type PlanningRun } from './agent/planningRunApi'
import {
  AGENT_HOME_PATH,
  NAV_ITEMS,
  NAV_VIEWS,
  WORKSPACE_GEOMETRY_AFTER_GLB_PATH,
} from './agent/constants'
import type {
  AgentToolView,
  AgentWorkspaceView,
  ViewerComponentMessage,
} from './agent/types'
import { useAgentSpeech } from './agent/useAgentSpeech'
import { getRecorderStatusText, useAgentRecorder } from './agent/useAgentRecorder'
import { useLatestManagedStatus } from './agent/useLatestManagedStatus'
import { useManagedAgentRun } from './agent/useManagedAgentRun'
import { useWorkspaceFilePreview } from './agent/useWorkspaceFilePreview'
import './AgentPage.css'

type AgentInputMode = 'voice' | 'text'
type AgentTheme = 'dark' | 'light'
type ChatMode = 'general' | 'gmat-orbit-keeping' | 'gmat-electric-propulsion'
type PendingGmatMessage = {
  error?: string
  kind: 'draft' | 'run'
  message: string
  status: 'sending' | 'failed'
}

const GMAT_WORKFLOW_LABELS: Record<'draft_llm' | 'run_gmat' | 'run_simucic' | 'prepare_opalis' | 'run_opalis', string> = {
  draft_llm: 'LLM mission discussion',
  run_gmat: 'Run GMAT simulation',
  run_simucic: 'Run Simu-CIC simulation',
  prepare_opalis: 'Prepare OPALIS scenario',
  run_opalis: 'Run OPALIS calculation',
}

function newGmatWorkflow(): WorkflowLoopProgressEntry[] {
  return (Object.keys(GMAT_WORKFLOW_LABELS) as Array<keyof typeof GMAT_WORKFLOW_LABELS>).map(key => ({
    completed: false, key, label: GMAT_WORKFLOW_LABELS[key], percent: 0, rawStatus: 'pending', status: 'pending', statusLabel: 'Pending', updatedAt: null,
  }))
}

function setGmatWorkflowStatus(entries: WorkflowLoopProgressEntry[], key: string, status: WorkflowLoopProgressEntry['status']) {
  return entries.map(entry => entry.key === key ? {
    ...entry, completed: status === 'completed', rawStatus: status, status, statusLabel: status === 'completed' ? 'Completed' : status === 'running' ? 'Running' : status === 'failed' ? 'Failed' : 'Pending', updatedAt: new Date().toISOString(),
  } : entry)
}

function newSimuCicWorkflow() {
  return setGmatWorkflowStatus(
    setGmatWorkflowStatus(
      setGmatWorkflowStatus(newGmatWorkflow(), 'draft_llm', 'completed'),
      'run_gmat',
      'completed',
    ),
    'run_simucic',
    'running',
  )
}

function newOpalisRunWorkflow() {
  return setGmatWorkflowStatus(
    setGmatWorkflowStatus(
      setGmatWorkflowStatus(
        setGmatWorkflowStatus(
          setGmatWorkflowStatus(newGmatWorkflow(), 'draft_llm', 'completed'),
          'run_gmat',
          'completed',
        ),
        'run_simucic',
        'running',
      ),
      'prepare_opalis',
      'pending',
    ),
    'run_opalis',
    'pending',
  )
}

function workflowForSavedRun(log: RunWorkflowLog) {
  const status = (value: RunWorkflowLog['stages']['simu_cic']['status']) => value === 'not_started' ? 'pending' : value
  let entries = setGmatWorkflowStatus(setGmatWorkflowStatus(newGmatWorkflow(), 'draft_llm', 'completed'), 'run_gmat', 'completed')
  entries = setGmatWorkflowStatus(entries, 'run_simucic', status(log.stages.simu_cic.status))
  if (log.stages.opalis.status !== 'not_started') {
    entries = setGmatWorkflowStatus(entries, 'prepare_opalis', log.stages.opalis.status === 'running' ? 'running' : 'completed')
  }
  return setGmatWorkflowStatus(entries, 'run_opalis', status(log.stages.opalis.status))
}

const AGENT_THEME_STORAGE_KEY = 'agent-theme'

function getInitialAgentTheme(): AgentTheme {
  if (typeof window === 'undefined') return 'dark'
  return window.localStorage.getItem(AGENT_THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark'
}

export default function AgentPage() {
  const { t } = useTranslation()
  const [agentTheme, setAgentTheme] = useState<AgentTheme>(() => getInitialAgentTheme())
  const [activeView, setActiveView] = useState<AgentWorkspaceView | null>(null)
  const [activeTool, setActiveTool] = useState<AgentToolView>('cad')
  const [conversationPanelOpen, setConversationPanelOpen] = useState(false)
  const [progressPanelOpen, setProgressPanelOpen] = useState(false)
  const [workspaceRefreshNonce, setWorkspaceRefreshNonce] = useState(0)
  const [satelliteRefreshNonce, setSatelliteRefreshNonce] = useState(0)
  const [progressRefreshNonce, setProgressRefreshNonce] = useState(0)
  const [inputMode, setInputMode] = useState<AgentInputMode>('text')
  const [chatMode, setChatMode] = useState<ChatMode>('general')
  const [modelBackend, setModelBackend] = useState<ManagedModelBackend>('chatModel')
  const [textInput, setTextInput] = useState('')
  const [textInputDisplay, setTextInputDisplay] = useState('')
  const [managedRunError, setManagedRunError] = useState('')
  const [gmatGenerating, setGmatGenerating] = useState(false)
  const [gmatGuiOpening, setGmatGuiOpening] = useState(false)
  const [simuCicConversation, setSimuCicConversation] = useState<OrbitKeepingRunConversationTurn[]>([])
  const [simuCicGuiOpening, setSimuCicGuiOpening] = useState(false)
  const [simuCicRunning, setSimuCicRunning] = useState(false)
  const [opalisRunning, setOpalisRunning] = useState(false)
  // OPALIS preparation is now performed as part of the single Run OPALIS
  // action in Mission discussion. Keep this compatibility value false while
  // older progress-panel call sites are being phased out.
  const opalisPreparing = false
  const [opalisGuiOpening, setOpalisGuiOpening] = useState(false)
  const [pendingGmatMessage, setPendingGmatMessage] = useState<PendingGmatMessage | null>(null)
  const [activeGmatDraft, setActiveGmatDraft] = useState<OrbitKeepingDraft | null>(null)
  const [activeGmatRun, setActiveGmatRun] = useState<{ conversation: OrbitKeepingRunConversationTurn[]; draftId?: string; result?: OrbitKeepingGenerateResult['result']; runId: string; runPath: string; template?: 'electric-propulsion-transfer' | 'orbit-keeping' } | null>(null)
  const [activePlanningRun, setActivePlanningRun] = useState<PlanningRun | null>(null)
  const [gmatWorkflowEntries, setGmatWorkflowEntries] = useState<WorkflowLoopProgressEntry[] | null>(null)
  const [stopSummaryPending, setStopSummaryPending] = useState(false)
  const [remoteToolPortStatus, setRemoteToolPortStatus] = useState<RemoteToolPortSummary | null>(null)
  const [remoteToolPortError, setRemoteToolPortError] = useState('')
  const [remoteToolPortLoading, setRemoteToolPortLoading] = useState(false)
  const [selectedBomId, setSelectedBomId] = useState('')
  const resetProgressDataRef = useRef<(() => void) | null>(null)
  const remoteToolHost = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const workspaceAppState = useWorkspaceAppState({ homePath: AGENT_HOME_PATH })

  const refreshWorkspaceViews = useCallback(() => {
    setSelectedBomId('')
    setWorkspaceRefreshNonce(value => value + 1)
    setProgressRefreshNonce(value => value + 1)
    setSatelliteRefreshNonce(value => value + 1)
  }, [])
  const versionState = useWorkspaceVersionState({
    fallbackWorkspaceName: 'Current workspace',
    onRefreshWorkspaceViews: refreshWorkspaceViews,
    onReloadSessions: () => {},
    workspaceRefreshNonce,
  })
  const {
    activeContext,
    activeManifestVersion,
    branchManifest,
    cancelDeleteVersion,
    checkoutVersion,
    confirmDeleteVersion,
    createChildBranch,
    createInitialVersion,
    createVersionFromInput,
    manifestLoading,
    requestDeleteVersion,
    switchActiveWorkspace,
    versionAction,
    versionDeleteTarget,
    versionError,
    workspaceChanging,
    workspaceItems,
    workspaces,
  } = versionState
  const gmatWorkspaceDir = activePlanningRun?.workspaceDir ?? activeContext.versionDir
  const { bomInfo, loading: bomLoading } = useBomInfo(workspaceRefreshNonce, {
    enabled: !!activeContext.versionDir,
    versionDir: activeContext.versionDir,
    versionId: activeContext.versionId,
    workspaceId: activeContext.workspaceId,
  })
  const selectedBom = bomInfo.components.find(component => component.componentId === selectedBomId) ?? bomInfo.components[0]
  const activeSession = workspaceAppState.sortedSessions.find(session => session.id === workspaceAppState.activeSessionId)
  const {
    sessionStatus,
    visibleCurrentEvents,
    visibleRunning,
    visibleTurns,
  } = getVisibleWorkspaceSessionState({
    activeContext,
    activeSession,
    currentEvents: workspaceAppState.currentEvents,
    currentPrompt: workspaceAppState.currentPrompt,
    pendingAskUser: workspaceAppState.pendingAskUser,
    running: workspaceAppState.running,
    runningWorkspace: workspaceAppState.runningWorkspace,
    turns: workspaceAppState.turns,
  })
  const toolUrls = useMemo(() => ({
    cad: getRemoteToolUrl('cad', remoteToolHost),
    paraview: getRemoteToolUrl('paraview', remoteToolHost),
    comsol: getRemoteToolUrl('comsol', remoteToolHost),
    gnc: getGncToolUrl(),
  }), [remoteToolHost])
  const refreshRemoteToolPortStatus = useCallback((options?: { force?: boolean }) => {
    setRemoteToolPortLoading(true)
    const suffix = options?.force ? '?force=1' : ''
    return fetch(joinApiPath(undefined, `/remote-tools/interface-status${suffix}`), { cache: 'no-store' })
      .then(async response => {
        const data = await response.json().catch(() => null) as RemoteToolPortSummary | null
        if (!data || !Array.isArray(data.results)) {
          throw new Error('Invalid interface status response')
        }
        setRemoteToolPortStatus(data)
        setRemoteToolPortError('')
      })
      .catch(error => {
        setRemoteToolPortError(error instanceof Error ? error.message : 'Unable to load interface status')
      })
      .finally(() => {
        setRemoteToolPortLoading(false)
      })
  }, [])
  const progressVariant = useMemo<WorkflowProgressVariant>(() => {
    const marker = [
      activeContext.workspaceName,
      activeContext.workspaceId,
      activeContext.workspaceKey,
      activeContext.versionDir,
    ].filter(Boolean).join("\n").toLowerCase()
    if (/derating|降额/.test(marker)) return "check"
    if (/gnc|aignc|adcs|region/.test(marker)) return "gnc"
    return "thermal"
  }, [activeContext.versionDir, activeContext.workspaceId, activeContext.workspaceKey, activeContext.workspaceName])
  const lockViewerToComplianceCheck = useMemo(() => {
    const marker = [
      activeContext.workspaceName,
      activeContext.workspaceId,
      activeContext.workspaceKey,
      activeContext.versionDir,
    ].filter(Boolean).join("\n").toLowerCase()
    return /derating|降额/.test(marker)
  }, [activeContext.versionDir, activeContext.workspaceId, activeContext.workspaceKey, activeContext.workspaceName])
  const canUseDefaultModelPreview = isThermalCadWorkspace(activeContext)
  const showModelPreview = canUseDefaultModelPreview || lockViewerToComplianceCheck
  const viewerHref = useMemo(() => {
    if (!showModelPreview) return ''
    const params = new URLSearchParams()
    if (canUseDefaultModelPreview) params.set('glbPath', WORKSPACE_GEOMETRY_AFTER_GLB_PATH)
    params.set('theme', agentTheme)
    if (activeContext.workspaceKey) params.set('workspaceKey', activeContext.workspaceKey)
    if (activeContext.workspaceId) params.set('workspaceId', activeContext.workspaceId)
    if (activeContext.versionId) params.set('versionId', activeContext.versionId)
    if (activeContext.versionDir) params.set('workspaceDir', activeContext.versionDir)
    if (lockViewerToComplianceCheck) {
      params.set('mode', 'derating')
      params.set('lockMode', 'derating')
    }
    if (workspaceRefreshNonce > 0) params.set('workspaceVersion', String(workspaceRefreshNonce))
    return `/viewer?${params.toString()}`
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, activeContext.workspaceKey, agentTheme, canUseDefaultModelPreview, lockViewerToComplianceCheck, showModelPreview, workspaceRefreshNonce])
  const showGncConfig = progressVariant === "gnc"
  const navItems = useMemo(() => {
    if (progressVariant === 'check') {
      return NAV_ITEMS
        .filter(item => item.href !== '#tools')
        .map(item => item.href === '#bom' ? { ...item, label: 'Config', meta: 'Config' } : item)
    }
    if (!showGncConfig) {
      return NAV_ITEMS
        .filter(item => showModelPreview || item.href !== '#model')
        .map(item => item.href === '#bom' ? { ...item, label: 'Config', meta: 'Config' } : item)
    }
    return NAV_ITEMS
      .filter(item => item.href !== '#model')
      .map(item => (
        item.href === '#bom'
          ? { ...item, label: 'GNC Config', meta: 'Config' }
          : item
      ))
  }, [progressVariant, showGncConfig, showModelPreview])
  const {
    handleSelectFile,
    selectedFileError,
    selectedFileLoading,
    selectedFilePath,
    selectedFilePreview,
  } = useWorkspaceFilePreview(activeContext)
  const {
    agentSpeechError,
    agentSpeechPlaying,
    agentSpeechState,
    clearAgentSpeechDisplay,
    showSpeechText,
    speakText,
    stopAgentSpeechPlayback,
    visibleAgentResponse,
  } = useAgentSpeech()
  const {
    activeWorkspaceSpeechKey,
    invalidateManagedRun,
    managedVoiceRunning,
    runCodex,
    setManagedVoiceRunning,
  } = useManagedAgentRun({
    activeContext,
    modelBackend,
    refreshWorkspaceViews,
    resetProgressDataRef,
    setBranchManifest: versionState.setBranchManifest,
    setProgressRefreshNonce,
    showRunError: setManagedRunError,
    showSpeechText,
    speakText,
    periodicSummarySpeechBusy: agentSpeechPlaying || agentSpeechState === 'synthesizing',
    workspaceAppState,
    workspaces,
  })
  const {
    latestManagedStatus,
    setLatestManagedStatus,
  } = useLatestManagedStatus({ activeContext, managedVoiceRunning })
  const handleStopAndSummarize = useCallback(async () => {
    if (stopSummaryPending) return
    let stoppedSessionId = workspaceAppState.runningSessionId ?? workspaceAppState.activeSessionId ?? null
    setStopSummaryPending(true)
    try {
      const refreshedStatus = latestManagedStatus?.status === 'running'
        ? latestManagedStatus
        : await getLatestManagedCodexStatus({
            versionId: activeContext.versionId,
            workspaceDir: activeContext.versionDir,
            workspaceId: activeContext.workspaceId,
          }).catch(() => null)
      const runningManagedStatus = refreshedStatus?.status === 'running' ? refreshedStatus : null
      if (refreshedStatus && refreshedStatus.status !== 'none') setLatestManagedStatus(refreshedStatus)
      const sessionId = runningManagedStatus?.sessionId ?? workspaceAppState.runningSessionId ?? workspaceAppState.activeSessionId
      const threadId = runningManagedStatus?.threadId ?? activeSession?.threadId ?? null
      stoppedSessionId = sessionId

      workspaceAppState.abort(sessionId)
      const result = runningManagedStatus?.managedRunId
        ? await cancelManagedCodex(runningManagedStatus.managedRunId)
        : await summarizeManagedCodex({
            input: '请总结当前或刚才停止的 Codex 任务已经完成的进度和结果。',
            modelBackend,
            sessionId,
            threadId,
            workspace: {
              workspaceDir: activeContext.versionDir,
              workspaceId: activeContext.workspaceId,
              workspaceName: activeContext.workspaceName,
              versionId: activeContext.versionId,
            },
          })
      const speechText = result.spokenSummary || result.summary || '任务已停止，当前进度已总结。'
      showSpeechText(speechText)
      void speakText(speechText, `agent-stop-summary:${sessionId ?? 'workspace'}:${Date.now()}`)
      await workspaceAppState.reloadSessions().catch(() => null)
      const latestStatus = await getLatestManagedCodexStatus({
        versionId: activeContext.versionId,
        workspaceDir: activeContext.versionDir,
        workspaceId: activeContext.workspaceId,
      }).catch(() => null)
      setLatestManagedStatus(latestStatus && latestStatus.status !== 'none' ? latestStatus : null)
      setManagedVoiceRunning(false)
      setProgressRefreshNonce(value => value + 1)
      refreshWorkspaceViews()
    } catch {
      const fallback = '任务已停止，但总结生成失败。'
      showSpeechText(fallback)
      void speakText(fallback, `agent-stop-summary-error:${stoppedSessionId ?? 'workspace'}:${Date.now()}`)
    } finally {
      setStopSummaryPending(false)
    }
  }, [activeContext.versionDir, activeContext.versionId, activeContext.workspaceId, activeContext.workspaceName, activeSession?.threadId, latestManagedStatus, modelBackend, refreshWorkspaceViews, showSpeechText, speakText, stopSummaryPending, workspaceAppState])
  const {
    cancelRecording,
    clearRecorderDisplay,
    error,
    startRecording,
    state,
    stopRecording,
    text,
  } = useAgentRecorder({
    clearAgentSpeechDisplay: () => {
      setManagedRunError('')
      clearAgentSpeechDisplay()
    },
    runCodex,
    running: visibleRunning || workspaceAppState.running || managedVoiceRunning,
  })
  const conversationLogSessionId = latestManagedStatus?.status === 'running'
    ? latestManagedStatus.sessionId
    : workspaceAppState.runningSessionId ?? workspaceAppState.activeSessionId
  const {
    conversationLogs,
    progressData,
    resetProgressData,
    workflowLoopProgressEntries,
    workflowProgressSummary,
  } = useWorkspaceRuntimeData({
    activeContext,
    enableConversationLogs: conversationPanelOpen,
    enableConversationLogRefresh: conversationPanelOpen && (visibleRunning || managedVoiceRunning || latestManagedStatus?.status === 'running'),
    enableRunLogEntries: false,
    enableStageLogs: false,
    progressRefreshNonce,
    progressVariant,
    running: visibleRunning || managedVoiceRunning || state === 'transcribing',
    t,
    visibleCurrentEvents,
    visibleTurns,
    workspaceRefreshNonce,
    sessionId: conversationLogSessionId,
  })
  resetProgressDataRef.current = resetProgressData
  const recorderStatusText = getRecorderStatusText(
    state,
    visibleRunning || managedVoiceRunning,
    agentSpeechPlaying || agentSpeechState === 'synthesizing',
  )

  useEffect(() => {
    invalidateManagedRun()
    clearAgentSpeechDisplay()
    clearRecorderDisplay()
    setTextInput('')
    setTextInputDisplay('')
    setLatestManagedStatus(null)
  }, [activeWorkspaceSpeechKey, clearAgentSpeechDisplay, clearRecorderDisplay, invalidateManagedRun, setLatestManagedStatus])

  useEffect(() => {
    resetProgressData()
  }, [activeContext.versionDir, activeContext.versionId, resetProgressData])

  useEffect(() => {
    refreshRemoteToolPortStatus().catch(() => {})
  }, [refreshRemoteToolPortStatus])

  useEffect(() => {
    if (state === 'done') {
      setProgressRefreshNonce(value => value + 1)
    }
  }, [state])

  useEffect(() => {
    if (activeView !== 'tools') return
    if (showGncConfig) return
    if (progressVariant === 'check') return

    fetch(joinApiPath(undefined, '/remote-tools/ensure-desktops'), { method: 'POST' })
      .then(response => {
        if (!response.ok) {
          console.warn('Failed to ensure remote desktop mappings', response.status)
        }
      })
      .catch(error => {
        console.warn('Failed to ensure remote desktop mappings', error)
      })
  }, [activeView, progressVariant, showGncConfig])

  useEffect(() => {
    if (progressVariant === 'check' && activeTool !== 'cad') setActiveTool('cad')
    if (showGncConfig && (activeTool === 'cad' || activeTool === 'paraview' || activeTool === 'comsol')) setActiveTool('gnc-dashboard')
    if (!showGncConfig && (activeTool === 'gnc' || activeTool === 'gnc-dashboard')) setActiveTool('cad')
  }, [activeTool, progressVariant, showGncConfig])

  useEffect(() => {
    if (!activeView) return
    if (navItems.some(item => item.href === `#${activeView}`)) return
    setActiveView('workspace')
  }, [activeView, navItems])

  useEffect(() => {
    const handleViewerMessage = (event: MessageEvent<ViewerComponentMessage>) => {
      if (event.origin !== window.location.origin) return
      if (event.data?.type !== 'viewer3d:component-selected') return
      if (typeof event.data.componentId !== 'string') return
      const semanticName = typeof event.data.semanticName === 'string' ? event.data.semanticName : ''
      const matchedComponent = bomInfo.components.find(component =>
        component.componentId === event.data.componentId ||
        (!!semanticName && component.semanticName === semanticName),
      )
      setSelectedBomId(matchedComponent?.componentId ?? event.data.componentId)
    }

    window.addEventListener('message', handleViewerMessage)
    return () => window.removeEventListener('message', handleViewerMessage)
  }, [bomInfo.components])

  const handleButtonClick = useCallback(() => {
    if (agentSpeechPlaying || agentSpeechState === 'synthesizing') {
      stopAgentSpeechPlayback()
      return
    }
    if (state === 'recording') {
      stopRecording()
    } else if (state !== 'transcribing') {
      void startRecording()
    }
  }, [agentSpeechPlaying, agentSpeechState, startRecording, state, stopAgentSpeechPlayback, stopRecording])

  const handleInputModeChange = useCallback((nextMode: AgentInputMode) => {
    if (nextMode === inputMode) return
    if (state === 'recording') cancelRecording()
    if (agentSpeechPlaying || agentSpeechState === 'synthesizing') stopAgentSpeechPlayback()
    clearAgentSpeechDisplay()
    clearRecorderDisplay()
    setManagedRunError('')
    setTextInputDisplay('')
    setInputMode(nextMode)
  }, [agentSpeechPlaying, agentSpeechState, cancelRecording, clearAgentSpeechDisplay, clearRecorderDisplay, inputMode, state, stopAgentSpeechPlayback])

  const handleNavSelect = useCallback((item: (typeof NAV_ITEMS)[number], _index: number, event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    const nextView = NAV_VIEWS.find(view => item.href === `#${view}`) ?? 'workspace'
    setActiveView(current => current === nextView ? null : nextView)
  }, [])
  const visibleActiveView = activeView === 'model' && !showModelPreview ? 'workspace' : activeView
  const activeNavIndex = visibleActiveView ? navItems.findIndex(item => item.href === `#${visibleActiveView}`) : -1
  const progressUpdatedAt = formatProgressUpdatedAt(progressData, navigator.language || 'zh-CN', t)
  const gmatActiveEntry = gmatWorkflowEntries?.find(entry => entry.status === 'running') ?? gmatWorkflowEntries?.find(entry => entry.status === 'failed')
  const progressPercent = gmatWorkflowEntries ? undefined : workflowProgressSummary.percentage
  const progressStatusLabel = gmatWorkflowEntries ? `Mission workflow: ${gmatActiveEntry?.label ?? 'completed'}` : workflowProgressSummary.statusLabel || progressUpdatedAt
  const displayedProgressUpdatedAt = gmatWorkflowEntries?.find(entry => entry.status === 'running')?.updatedAt ?? progressUpdatedAt
  const displayedProgressTitle = gmatWorkflowEntries ? 'Mission workflow' : t('workspace.inspector.progressTitle')
  const displayedProgressEntries = gmatWorkflowEntries ?? workflowLoopProgressEntries
  const recordButtonBusy = agentSpeechState === 'synthesizing' || agentSpeechPlaying
  const recordButtonDisabled = state === 'transcribing'
  const textComposerBusy = recordButtonBusy || state === 'transcribing' || gmatGenerating
  const textRecorderStatusText = textComposerBusy
    ? recorderStatusText
    : 'Text mode'
  const handleTextSubmit = useCallback((submittedText?: string, forcedMode?: ChatMode) => {
    const prompt = (submittedText ?? textInput).trim()
    if (!prompt || textComposerBusy) return
    clearAgentSpeechDisplay()
    setManagedRunError('')
    setTextInput('')
    setTextInputDisplay(prompt)
    const selectedMode = forcedMode ?? chatMode
    const isSimuCicPrompt = /simu\s*-?\s*cic|ground\s+(?:station|sat+ion)s?|station\s+au\s+sol|attitude|point(?:age|ing)|nadir|\b(?:follow|track|suiv\w*)\b/i.test(prompt)
    if (selectedMode === 'general' || isSimuCicPrompt) {
      setGmatGenerating(true)
      setPendingGmatMessage({ kind: 'draft', message: prompt, status: 'sending' })
      setGmatWorkflowEntries(setGmatWorkflowStatus(newGmatWorkflow(), 'draft_llm', 'running'))
      // The first message in Mission discussion starts an isolated planning
      // run. The router will then create the matching GMAT draft in this
      // workspace, so it immediately appears in GMAT Mission Files.
      const planningRunPromise = activePlanningRun
        ? Promise.resolve(activePlanningRun)
        : createPlanningRun(activeContext.versionDir).then(planningRun => {
            setActivePlanningRun(planningRun)
            return planningRun
          })
      void planningRunPromise
        .then(planningRun => routeMissionMessage(
          prompt,
          planningRun.workspaceDir,
          activeGmatRun?.runPath,
          activeGmatDraft?.draftId,
          chatMode === 'gmat-electric-propulsion' ? 'electric-propulsion-transfer' : chatMode === 'gmat-orbit-keeping' ? 'orbit-keeping' : undefined,
        ))
        .then(result => {
          setPendingGmatMessage(null)
          if (result.kind === 'mission') {
            setChatMode(result.template === 'electric-propulsion-transfer' ? 'gmat-electric-propulsion' : 'gmat-orbit-keeping')
            setActiveGmatDraft(result.draft)
            refreshWorkspaceViews()
            showSpeechText(result.draft.assistantMessage || result.message)
            setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(setGmatWorkflowStatus(entries, 'draft_llm', 'completed'), 'validate_draft', 'completed') : entries)
            return
          }
          if (result.kind === 'general') {
            if (result.draft) setActiveGmatDraft(result.draft)
            // Keep the first Mission Studio exchange attached to its newly
            // created planning run. A non-mission question must not switch to
            // the unrelated general assistant and make the dated card vanish.
            const askedAt = new Date().toISOString()
            setSimuCicConversation(current => [...current, { answer: result.message, askedAt, question: prompt }])
            showSpeechText(result.message)
            setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'draft_llm', 'completed') : entries)
            return
          }
          if (result.kind === 'simu-cic') {
            const askedAt = new Date().toISOString()
            if (result.draft) setActiveGmatDraft(result.draft)
            else setSimuCicConversation(current => [...current, { answer: result.message, askedAt, question: prompt }])
            setActiveGmatRun(current => current ? { ...current, conversation: [...current.conversation, { answer: result.message, askedAt, question: prompt }] } : current)
            setSatelliteRefreshNonce(value => value + 1)
            showSpeechText(result.message)
            setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'draft_llm', 'completed') : entries)
            return
          }
          if (result.kind === 'clarify') {
            // A rejected mission request (for example an electric transfer
            // with a chemical-propulsion satellite) is still a meaningful
            // conversation turn. Keep it visible instead of clearing the
            // pending user message and leaving an empty chat.
            const askedAt = new Date().toISOString()
            if (result.draft) setActiveGmatDraft(result.draft)
            else setSimuCicConversation(current => [...current, { answer: result.message, askedAt, question: prompt }])
            setActiveGmatRun(current => current ? { ...current, conversation: [...current.conversation, { answer: result.message, askedAt, question: prompt }] } : current)
            showSpeechText(result.message)
            setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'draft_llm', 'completed') : entries)
            return
          }
          showSpeechText(result.message)
          setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'draft_llm', 'completed') : entries)
        })
        .catch(reason => {
          const message = reason instanceof Error ? reason.message : 'Mission routing failed'
          setManagedRunError(message)
          setPendingGmatMessage(current => current?.message === prompt ? { ...current, error: message, status: 'failed' } : current)
          setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'draft_llm', 'failed') : entries)
        })
        .finally(() => setGmatGenerating(false))
      return
    }
    setGmatGenerating(true)
    const pendingKind: PendingGmatMessage['kind'] = activeGmatRun ? 'run' : 'draft'
    setPendingGmatMessage({ kind: pendingKind, message: prompt, status: 'sending' })
    setProgressPanelOpen(true)
    setGmatWorkflowEntries(setGmatWorkflowStatus(newGmatWorkflow(), 'draft_llm', 'running'))
    if (activeGmatRun) {
      void askMissionAssistant({ draftId: activeGmatRun.draftId, message: prompt, runPath: activeGmatRun.runPath, workspaceDir: gmatWorkspaceDir })
        .then(result => {
          if (result.kind === 'draft') {
            setActiveGmatDraft(result.draft)
            setActiveGmatRun(null)
            setChatMode(activeGmatRun.template === 'electric-propulsion-transfer' ? 'gmat-electric-propulsion' : 'gmat-orbit-keeping')
            showSpeechText(result.draft.assistantMessage || 'Mission draft updated.')
          } else {
            setActiveGmatRun(current => current && current.runPath === activeGmatRun.runPath
              ? { ...current, conversation: [...current.conversation, { answer: result.answer, askedAt: new Date().toISOString(), question: prompt }] }
              : current)
            if (result.intent === 'simu-cic') setSatelliteRefreshNonce(value => value + 1)
            showSpeechText(result.answer)
          }
          setPendingGmatMessage(null)
          setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'draft_llm', 'completed') : entries)
        })
        .catch(error => {
          const message = error instanceof Error ? error.message : 'GMAT analysis failed'
          setManagedRunError(message)
          setPendingGmatMessage(current => current?.message === prompt ? { ...current, error: message, status: 'failed' } : current)
          setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'draft_llm', 'failed') : entries)
        })
        .finally(() => setGmatGenerating(false))
      return
    }
    const describeDraft = (draft: OrbitKeepingDraft) => {
      const labels: Record<string, string> = {
        'endOfLife.finalAltitudeKm': 'final altitude',
        'initialOrbit.eccentricity': 'eccentricity',
        'initialOrbit.epoch': 'initial epoch',
        'initialOrbit.inclinationDeg': 'inclination',
        'initialOrbit.smaKm': 'initial orbit altitude or semi-major axis',
        'initialOrbit.raanDeg': 'right ascension of ascending node',
        'initialOrbit.argPeriapsisDeg': 'argument of periapsis',
        'initialOrbit.trueAnomalyDeg': 'true anomaly',
        'propulsion.ispSeconds': 'specific impulse',
        'spacecraft.dragAreaM2': 'drag area',
        'spacecraft.dragCoefficient': 'drag coefficient',
        'spacecraft.dryMassKg': 'dry mass',
        'spacecraft.initialFuelMassKg': 'initial fuel mass',
        'stationKeeping.fuelReserveKg': 'fuel reserve',
        'stationKeeping.minimumAltitudeKm': 'minimum reboost altitude',
        'stationKeeping.targetSmaKm': 'target semi-major axis',
        'transfer.burnDurationDays': 'electric-thrust duration',
        'propulsion.maximumUsablePowerKw': 'maximum usable power',
        'propulsion.minimumUsablePowerKw': 'minimum usable power',
        'power.initialMaxPowerKw': 'initial solar-array power',
        'power.busLoadKw': 'spacecraft bus load',
        'power.systemMarginPercent': 'power-system margin',
      }
      const missing = draft.missing.length
        ? `\nStill needed: ${draft.missing.map(field => labels[field] ?? field).join(', ')}.`
        : ''
      const safetyErrors = draft.safety.checks.filter(check => check.severity === 'error')
      const safetyWarnings = draft.safety.checks.filter(check => check.severity === 'warning')
      const safety = safetyErrors.length
        ? `\nGMAT is blocked by physical sanity checks: ${safetyErrors.map(check => check.message).join(' ')}`
        : safetyWarnings.length
          ? `\nPhysical sanity checks passed with warnings: ${safetyWarnings.map(check => check.message).join(' ')}`
          : draft.missing.length === 0
            ? '\nPhysical sanity checks passed. Review the assumed defaults, then select Confirm and run GMAT.'
            : ''
      showSpeechText(`${draft.assistantMessage || 'Mission draft updated.'}${missing}${safety}`)
    }
    if (!activeGmatDraft) {
      const createDraft = selectedMode === 'gmat-electric-propulsion' ? createElectricPropulsionDraft : createOrbitKeepingDraft
      const discussDraft = selectedMode === 'gmat-electric-propulsion' ? discussElectricPropulsionDraft : discussOrbitKeepingDraft
      void createDraft(gmatWorkspaceDir)
        .then(draft => {
          // Keep the empty draft locally: a failed LLM call can be retried without losing its context.
          setActiveGmatDraft(draft)
          return discussDraft(draft.draftId, prompt, gmatWorkspaceDir)
        })
        .then(draft => { setActiveGmatDraft(draft); setPendingGmatMessage(null); describeDraft(draft); setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(setGmatWorkflowStatus(entries, 'draft_llm', 'completed'), 'validate_draft', 'completed') : entries) })
        .catch(reason => {
          const message = reason instanceof Error ? reason.message : 'GMAT draft creation failed'
          setManagedRunError(message)
          setPendingGmatMessage(current => current?.message === prompt ? { ...current, error: message, status: 'failed' } : current)
          setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'draft_llm', 'failed') : entries)
        })
        .finally(() => setGmatGenerating(false))
      return
    }
    const discussDraft = selectedMode === 'gmat-electric-propulsion' ? discussElectricPropulsionDraft : discussOrbitKeepingDraft
    void discussDraft(activeGmatDraft.draftId, prompt, gmatWorkspaceDir)
      .then(draft => { setActiveGmatDraft(draft); setPendingGmatMessage(null); describeDraft(draft); setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(setGmatWorkflowStatus(entries, 'draft_llm', 'completed'), 'validate_draft', 'completed') : entries) })
      .catch(reason => {
        const message = reason instanceof Error ? reason.message : 'GMAT draft update failed'
        setManagedRunError(message)
        setPendingGmatMessage(current => current?.message === prompt ? { ...current, error: message, status: 'failed' } : current)
        setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'draft_llm', 'failed') : entries)
      })
      .finally(() => setGmatGenerating(false))
  }, [activeContext.versionDir, activeGmatDraft, activeGmatRun, activePlanningRun, chatMode, clearAgentSpeechDisplay, gmatWorkspaceDir, refreshWorkspaceViews, runCodex, showSpeechText, textComposerBusy, textInput])
  const handleExecuteGmatDraft = useCallback(() => {
    if (!activeGmatDraft || gmatGenerating) return
    setGmatGenerating(true)
    setProgressPanelOpen(true)
    setGmatWorkflowEntries(setGmatWorkflowStatus(setGmatWorkflowStatus(newGmatWorkflow(), 'draft_llm', 'completed'), 'validate_draft', 'running'))
    const confirmDraft = chatMode === 'gmat-electric-propulsion' ? confirmElectricPropulsionDraft : confirmOrbitKeepingDraft
    const executeDraft = chatMode === 'gmat-electric-propulsion' ? executeElectricPropulsionDraftWithProgress : executeOrbitKeepingDraftWithProgress
    void confirmDraft(activeGmatDraft.draftId, gmatWorkspaceDir)
      .then(draft => {
        setActiveGmatDraft(draft)
        setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'validate_draft', 'completed') : entries)
        return executeDraft(draft.draftId, {
          workspaceDir: gmatWorkspaceDir,
          onProgress: event => setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, event.key, event.status) : entries),
        })
      })
      .then((result: OrbitKeepingGenerateResult) => {
        const runFailed = result.result.status === 'failed' || result.result.status === 'timeout'
        const runWarnings = result.result.warnings ?? []
        const conversation: OrbitKeepingRunConversationTurn[] = [{
          answer: runFailed
            ? `GMAT ${result.result.status}: ${result.result.error || 'GMAT did not produce a usable result. Review the generated log file for details.'}`
            : runWarnings.length
              ? `GMAT completed with safety warnings: ${runWarnings.join(' ')}`
            : `GMAT completed successfully. You can analyze these saved results or request changed mission values to create a new run.`,
          askedAt: new Date().toISOString(),
          question: 'GMAT execution',
        }]
        setActiveGmatRun({ conversation, draftId: result.draftId ?? activeGmatDraft.draftId, result: result.result, runId: result.runId, runPath: result.runPath, template: chatMode === 'gmat-electric-propulsion' ? 'electric-propulsion-transfer' : 'orbit-keeping' })
        setActiveGmatDraft(current => current?.draftId === activeGmatDraft.draftId ? {
          ...current,
          runs: [...(current.runs ?? []).filter(run => run.runId !== result.runId), { completedAt: new Date().toISOString(), result: result.result, runId: result.runId, runPath: result.runPath }],
        } : current)
        if (runFailed) setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'run_gmat', 'failed') : entries)
        showSpeechText(runFailed
          ? `GMAT run ${result.runId} ${result.result.status}: ${result.result.error || 'see the run discussion for details.'}`
          : runWarnings.length
            ? `GMAT run ${result.runId} completed with safety warnings: ${runWarnings.join(' ')}`
          : `GMAT run ${result.runId}: ${result.result.status}. Accepted changes: ${result.changes.length}.`)
        refreshWorkspaceViews()
      })
      .catch(reason => { setManagedRunError(reason instanceof Error ? reason.message : 'GMAT draft execution failed'); setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'run_gmat', 'failed') : entries) })
      .finally(() => setGmatGenerating(false))
  }, [activeGmatDraft, gmatGenerating, gmatWorkspaceDir, refreshWorkspaceViews, showSpeechText])
  const handleNewGmatDraft = useCallback(() => {
    if (gmatGenerating) return
    setActiveGmatRun(null)
    setActiveGmatDraft(null)
    setSimuCicConversation([])
    setPendingGmatMessage(null)
    setManagedRunError('')

    // Start from a generic planning discussion. The first user message routes
    // to the appropriate template, instead of accidentally inheriting the
    // completed run's template or draft.
    setGmatGenerating(true)
    void createPlanningRun(activeContext.versionDir)
      .then(planningRun => {
        setActivePlanningRun(planningRun)
        setChatMode('general')
        refreshWorkspaceViews()
        showSpeechText(`New planning run ${planningRun.planningRunId} created. Describe the mission to select its GMAT template.`)
      })
      .catch(reason => setManagedRunError(reason instanceof Error ? reason.message : 'GMAT draft creation failed'))
      .finally(() => setGmatGenerating(false))
  }, [activeContext.versionDir, gmatGenerating, refreshWorkspaceViews, showSpeechText])
  const displayedSessionStatus = managedVoiceRunning || latestManagedStatus?.status === 'running'
    ? 'running'
    : latestManagedStatus?.status === 'completed' || latestManagedStatus?.status === 'partial'
      ? 'completed'
      : latestManagedStatus?.status === 'failed' || latestManagedStatus?.status === 'cancelled'
        ? 'failed'
      : sessionStatus
  const handleOpenActiveGmatGui = useCallback(() => {
    if (!activeGmatRun || gmatGuiOpening) return
    setGmatGuiOpening(true)
    setManagedRunError('')
    const isElectricTransfer = activeGmatRun.template === 'electric-propulsion-transfer'
    void (isElectricTransfer ? openElectricPropulsionRunInGui(activeGmatRun.runPath) : openOrbitKeepingRunInGui(activeGmatRun.runPath))
      .then(() => showSpeechText('GMAT GUI was opened for run ' + activeGmatRun.runId + '.'))
      .catch(reason => setManagedRunError(reason instanceof Error ? reason.message : 'Unable to open GMAT GUI'))
      .finally(() => setGmatGuiOpening(false))
  }, [activeGmatRun, gmatGuiOpening, showSpeechText])
  const handleRunSimuCic = useCallback(() => {
    if (!activeGmatRun || simuCicRunning) return
    setSimuCicRunning(true)
    setManagedRunError('')
    setProgressPanelOpen(true)
    setGmatWorkflowEntries(newSimuCicWorkflow())
    void runSimuCic(activeGmatRun.runPath)
      .then(result => {
        setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'run_simucic', 'completed') : entries)
        const askedAt = new Date().toISOString()
        setActiveGmatRun(current => current ? { ...current, conversation: [...current.conversation, { answer: 'Simu-CIC completed. CIC data are available for downstream OPALIS processing.', askedAt, question: 'Run Simu-CIC' }] } : current)
        showSpeechText('Simu-CIC completed for run ' + activeGmatRun.runId + '. CIC data: ' + result.cicSatDir + '.')
        refreshWorkspaceViews()
      })
      .catch(reason => {
        setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'run_simucic', 'failed') : entries)
        setManagedRunError(reason instanceof Error ? reason.message : 'Unable to run Simu-CIC')
      })
      .finally(() => setSimuCicRunning(false))
  }, [activeGmatRun, refreshWorkspaceViews, showSpeechText, simuCicRunning])
  const handleOpenSimuCicGui = useCallback(() => {
    if (!activeGmatRun || simuCicGuiOpening) return
    setSimuCicGuiOpening(true)
    setManagedRunError('')
    void openSimuCicGui(activeGmatRun.runPath)
      .then(() => showSpeechText('Simu-CIC GUI was opened for run ' + activeGmatRun.runId + '.'))
      .catch(reason => setManagedRunError(reason instanceof Error ? reason.message : 'Unable to open Simu-CIC GUI'))
      .finally(() => setSimuCicGuiOpening(false))
  }, [activeGmatRun, showSpeechText, simuCicGuiOpening])
  const handleOpenPreparedOpalis = useCallback(() => {
    if (!activeGmatRun || opalisGuiOpening) return
    setOpalisGuiOpening(true)
    setManagedRunError('')
    void openPreparedOpalisScenario(activeGmatRun.runPath)
      .then(() => showSpeechText('OPALIS GUI was opened for run ' + activeGmatRun.runId + '.'))
      .catch(reason => setManagedRunError(reason instanceof Error ? reason.message : 'Unable to open OPALIS GUI'))
      .finally(() => setOpalisGuiOpening(false))
  }, [activeGmatRun, opalisGuiOpening, showSpeechText])
  const handlePrepareOpalis = useCallback(() => undefined, [])
  const handleRunOpalis = useCallback(() => {
    if (!activeGmatRun || opalisRunning || simuCicRunning) return
    setOpalisRunning(true)
    setManagedRunError('')
    setProgressPanelOpen(true)
    setGmatWorkflowEntries(newOpalisRunWorkflow())
    void runOpalisScenario(activeGmatRun.runPath)
      .then(result => {
        setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(setGmatWorkflowStatus(setGmatWorkflowStatus(entries, 'run_simucic', 'completed'), 'prepare_opalis', 'completed'), 'run_opalis', 'completed') : entries)
        const askedAt = new Date().toISOString()
        setActiveGmatRun(current => current ? { ...current, conversation: [...current.conversation,
          { answer: 'Simu-CIC completed. CIC data was generated for OPALIS.', askedAt, question: 'Run Simu-CIC' },
          { answer: 'OPALIS calculation completed. Consolidated results are available for analysis.', askedAt, question: 'Run OPALIS calculation' },
        ] } : current)
        showSpeechText('OPALIS calculation completed for run ' + activeGmatRun.runId + '. Results: ' + result.summary + '.')
        refreshWorkspaceViews()
      })
      .catch(reason => {
        setGmatWorkflowEntries(entries => entries
          ? setGmatWorkflowStatus(setGmatWorkflowStatus(entries, 'run_simucic', 'failed'), 'run_opalis', 'failed')
          : entries)
        setManagedRunError(reason instanceof Error ? reason.message : 'Unable to run OPALIS calculation')
      })
      .finally(() => setOpalisRunning(false))
  }, [activeGmatRun, opalisRunning, refreshWorkspaceViews, showSpeechText, simuCicRunning])
  const handleStopCalculations = useCallback(() => {
    const runPath = activeGmatRun?.runPath
    setGmatGenerating(false)
    setSimuCicRunning(false)
    setOpalisRunning(false)
    setPendingGmatMessage(null)
    setManagedRunError('Calculations stopped by the user. You can continue the discussion.')
    setGmatWorkflowEntries(entries => entries ? entries.map(entry => entry.status === 'running'
      ? { ...entry, completed: false, rawStatus: 'failed', status: 'failed', statusLabel: 'Stopped', updatedAt: new Date().toISOString() }
      : entry) : entries)
    void cancelGmatCalculations(runPath)
      .then(() => refreshWorkspaceViews())
      .catch(reason => setManagedRunError(reason instanceof Error ? reason.message : 'Unable to stop active calculations'))
  }, [activeGmatRun, refreshWorkspaceViews])
  const sessionStatusLabel = t(`workspace.status.${displayedSessionStatus}`)
  const dataSourceLabel = activeContext.workspaceName
    ? getWorkspaceDisplayName(activeContext.workspaceName)
    : activeContext.workspaceKey || activeContext.workspaceId || 'No workspace selected'
  const versionLabel = activeContext.versionId || 'No version selected'
  const agentPageClassName = [
    'agent-page',
    `is-${agentTheme}-theme`,
    showGncConfig ? 'is-gnc-agent' : '',
    progressVariant === 'thermal' ? 'is-thermal-agent' : '',
    progressVariant === 'check' ? 'is-derating-agent' : '',
    activeView ? 'has-workspace-view' : '',
    conversationPanelOpen ? 'has-left-floating-panel' : '',
    progressPanelOpen ? 'has-right-floating-panel' : '',
    conversationPanelOpen || progressPanelOpen ? 'has-floating-panel' : '',
  ].filter(Boolean).join(' ')

  const handleAgentThemeChange = useCallback((nextTheme: AgentTheme) => {
    setAgentTheme(nextTheme)
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(AGENT_THEME_STORAGE_KEY, nextTheme)
    }
  }, [])

  return (
    <main className={agentPageClassName}>
      <AgentTopbar
        conversationOpen={conversationPanelOpen}
        dataSourceLabel={dataSourceLabel}
        agentTheme={agentTheme}
        inputMode={inputMode}
        modelBackend={modelBackend}
        onAgentThemeChange={handleAgentThemeChange}
        onInputModeChange={handleInputModeChange}
        onModelBackendChange={setModelBackend}
        onConversationToggle={() => setConversationPanelOpen(open => !open)}
        portStatus={remoteToolPortStatus}
        portStatusError={remoteToolPortError}
        portStatusLoading={remoteToolPortLoading}
        onPortStatusRefresh={() => refreshRemoteToolPortStatus({ force: true })}
        onProgressToggle={() => setProgressPanelOpen(open => !open)}
        onStopAndSummarize={handleStopAndSummarize}
        progressOpen={progressPanelOpen}
        progressPercent={progressPercent}
        progressStatusLabel={progressStatusLabel}
        progressTitle={displayedProgressTitle}
        sessionStatus={displayedSessionStatus}
        sessionStatusLabel={sessionStatusLabel}
        stopSummaryPending={stopSummaryPending}
        versionLabel={versionLabel}
      />
      {conversationPanelOpen ? (
        <AgentConversationPopover
          conversationLogs={conversationLogs}
          onClose={() => setConversationPanelOpen(false)}
          title="Conversation history"
        />
      ) : null}
      {progressPanelOpen ? (
        <AgentProgressRail
          className="agent-progress-popover"
          gmatGuiAction={{
            disabled: !activeGmatRun || gmatGuiOpening,
            label: gmatGuiOpening ? 'Opening GMAT GUI…' : 'Open active run in GMAT GUI',
            onClick: handleOpenActiveGmatGui,
            title: activeGmatRun ? 'Open the generated script for this run in GMAT.' : 'Select a GMAT run first.',
          }}
          simuCicGuiAction={{
            disabled: !activeGmatRun || simuCicGuiOpening || simuCicRunning,
            label: simuCicGuiOpening ? 'Opening Simu-CIC GUI…' : 'Open Simu-CIC GUI',
            onClick: handleOpenSimuCicGui,
            title: activeGmatRun ? 'Open the generated Simu-CIC scenario for this run.' : 'Select a GMAT run first.',
          }}
          opalisPrepareAction={{
            disabled: !activeGmatRun || opalisPreparing || opalisRunning || simuCicRunning,
            label: opalisPreparing ? 'Preparing OPALIS…' : 'Prepare OPALIS scenario',
            onClick: handlePrepareOpalis,
            title: activeGmatRun ? 'Build an OPALIS scenario from this run\'s satellite.json and Simu-CIC CIC files, without calculating it.' : 'Select a GMAT run first.',
          }}
          opalisRunAction={{
            disabled: !activeGmatRun || opalisRunning || opalisPreparing || simuCicRunning,
            label: opalisRunning ? 'Running OPALISâ€¦' : 'Run OPALIS calculation',
            onClick: handleRunOpalis,
            title: activeGmatRun ? 'Generate the OPALIS fluxes and run the electrical calculation in batch mode.' : 'Select a GMAT run first.',
          }}
          opalisGuiAction={{
            disabled: !activeGmatRun || opalisGuiOpening || opalisRunning,
            label: opalisGuiOpening ? 'Opening OPALIS…' : 'Open OPALIS GUI',
            onClick: handleOpenPreparedOpalis,
            title: activeGmatRun ? 'Open this run’s calculated OPALIS scenario in the OPALIS GUI.' : 'Select a GMAT run first.',
          }}
          onClose={() => setProgressPanelOpen(false)}
          progressUpdatedAt={displayedProgressUpdatedAt}
          title={displayedProgressTitle}
          workflowLoopProgressEntries={displayedProgressEntries}
        />
      ) : null}
      <section className="agent-stage" aria-live="polite">
        <AgentSideNav activeNavIndex={activeNavIndex} navItems={navItems} onNavSelect={handleNavSelect} />
        <AgentWorkspacePanel
          activeGmatRunPath={activeGmatRun?.runPath}
          activeGmatRunId={activeGmatRun?.runId}
          activeGmatRunTemplate={activeGmatRun?.template}
          activeContext={activeContext}
          missionWorkspaceDir={gmatWorkspaceDir}
          planningDiscussion={activePlanningRun}
          onMissionSatelliteSelected={() => {
            refreshWorkspaceViews()
            const initialMissionMessage = activeGmatDraft?.conversation?.[0]?.user
            const waitingForSatellite = /select a satellite version/i.test(activeGmatDraft?.assistantMessage ?? '')
            if (initialMissionMessage && waitingForSatellite) handleTextSubmit(initialMissionMessage, chatMode)
          }}
          activeManifestVersion={activeManifestVersion}
          activeTool={activeTool}
          activeView={visibleActiveView}
          apiBase={undefined}
          bomInfo={bomInfo}
          bomLoading={bomLoading}
          branchManifest={branchManifest}
          cancelDeleteVersion={cancelDeleteVersion}
          checkoutVersion={checkoutVersion}
          confirmDeleteVersion={confirmDeleteVersion}
          createChildBranch={createChildBranch}
          createInitialVersion={createInitialVersion}
          createVersionFromInput={createVersionFromInput}
          handleSelectFile={handleSelectFile}
          gmatMissionChat={{
            busy: gmatGenerating || simuCicRunning || opalisRunning,
            chatMode,
            conversation: activeGmatRun?.conversation,
            draft: activeGmatDraft,
            error: error || managedRunError,
            gmatRunFailed: activeGmatRun?.result?.status === 'failed' || activeGmatRun?.result?.status === 'timeout',
            pending: pendingGmatMessage,
            onExecute: handleExecuteGmatDraft,
            onNewRun: handleNewGmatDraft,
            onRunSimuCic: handleRunSimuCic,
            onRunOpalis: handleRunOpalis,
            onStopCalculations: handleStopCalculations,
            onRetry: () => {
              if (pendingGmatMessage?.status === 'failed') handleTextSubmit(pendingGmatMessage.message, chatMode)
            },
            onSend: (message, mode) => handleTextSubmit(message, mode),
            simuCicConversation,
            simuCicRefreshNonce: satelliteRefreshNonce,
            simuCicRunning,
          }}
          manifestLoading={manifestLoading}
          onSelectGmatDraft={(draft: GmatSavedDraft) => {
            setActiveGmatRun(null)
            setActiveGmatDraft(draft)
            setPendingGmatMessage(null)
            setChatMode(draft.missionType === 'electric-propulsion-transfer' ? 'gmat-electric-propulsion' : 'gmat-orbit-keeping')
            setManagedRunError('')
            showSpeechText(`Draft ${draft.draftId} reopened. You can continue the mission discussion without rerunning GMAT.`)
          }}
          onSelectGmatRun={run => {
            setActiveGmatRun({ ...run, conversation: [] })
            const isElectricTransfer = run.missionType === 'electric-propulsion-transfer'
            void getRunWorkflowLog(run.runPath)
              .then(log => setGmatWorkflowEntries(workflowForSavedRun(log)))
              .catch(() => setGmatWorkflowEntries(setGmatWorkflowStatus(setGmatWorkflowStatus(newGmatWorkflow(), 'draft_llm', 'completed'), 'run_gmat', 'completed')))
            setActiveGmatDraft(null)
            void (isElectricTransfer ? getElectricPropulsionRunConversation(run.runPath) : getOrbitKeepingRunConversation(run.runPath))
              .then(conversation => setActiveGmatRun(current => current?.runPath === run.runPath ? { ...current, conversation } : current))
              .catch(() => null)
            void (isElectricTransfer ? listElectricPropulsionDrafts(gmatWorkspaceDir) : listOrbitKeepingDrafts(gmatWorkspaceDir))
              .then(drafts => {
                const draft = drafts.find(candidate => candidate.runs?.some(savedRun => savedRun.runPath === run.runPath))
                if (draft) setActiveGmatDraft(draft)
              })
              .catch(() => null)
            setActiveGmatRun(current => current?.runPath === run.runPath ? { ...current, template: run.missionType } : current)
            setChatMode(isElectricTransfer ? 'gmat-electric-propulsion' : 'gmat-orbit-keeping')
            setManagedRunError('')
            showSpeechText(`Run ${run.runId} is now the active GMAT conversation context. Questions will use its saved results without rerunning GMAT.`)
          }}
          selectedBom={selectedBom}
          selectedFileError={selectedFileError}
          selectedFileLoading={selectedFileLoading}
          selectedFilePath={selectedFilePath}
          selectedFilePreview={selectedFilePreview}
          setActiveTool={setActiveTool}
          setSelectedBomId={setSelectedBomId}
          requestDeleteVersion={requestDeleteVersion}
          refreshWorkspaceViews={refreshWorkspaceViews}
          theme={agentTheme}
          showGncConfig={showGncConfig}
          showComplianceCheckConfig={progressVariant === 'check'}
          showModelPreview={showModelPreview}
          switchActiveWorkspace={switchActiveWorkspace}
          t={t}
          toolUrls={toolUrls}
          versionAction={versionAction}
          versionDeleteTarget={versionDeleteTarget}
          versionError={versionError}
          viewerHref={viewerHref}
          workspaceChanging={workspaceChanging}
          workspaceItems={workspaceItems}
          workspaceRefreshNonce={workspaceRefreshNonce}
          satelliteRefreshNonce={satelliteRefreshNonce}
        />

        <div hidden aria-hidden="true">
        <AgentRecorderControl
          activeGmatRunId={activeGmatRun?.runId}
          gmatRunConversation={activeGmatRun?.conversation}
          activeView={activeView}
          agentSpeechError={agentSpeechError}
          agentSpeechState={agentSpeechState}
          busy={recordButtonBusy}
          chatMode={chatMode}
          disabled={recordButtonDisabled}
          error={error || managedRunError}
          gmatDraft={activeGmatDraft}
          gmatPendingMessage={pendingGmatMessage}
          inputMode={inputMode}
          onButtonClick={handleButtonClick}
          onExecuteGmatDraft={handleExecuteGmatDraft}
          onStartNewGmatRun={() => {
            clearAgentSpeechDisplay()
            handleNewGmatDraft()
          }}
          onRetryGmatMessage={() => {
            if (pendingGmatMessage?.status === 'failed') handleTextSubmit(pendingGmatMessage.message, chatMode)
          }}
          onTextChange={setTextInput}
          onTextSubmit={() => handleTextSubmit()}
          recorderStatusText={inputMode === 'text' ? textRecorderStatusText : recorderStatusText}
          state={state}
          text={inputMode === 'text' ? textInputDisplay : text}
          textInputDisabled={textComposerBusy}
          textInputValue={textInput}
          visibleAgentResponse={visibleAgentResponse}
        />
        </div>
      </section>
    </main>
  )
}
