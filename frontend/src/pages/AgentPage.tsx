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
import { cancelManagedCodex, getLatestManagedCodexStatus, summarizeManagedCodex, type ManagedModelBackend } from './agent/managedRun'
import { analyzeElectricPropulsionRun, confirmElectricPropulsionDraft, createElectricPropulsionDraft, discussElectricPropulsionDraft, executeElectricPropulsionDraftWithProgress, getElectricPropulsionRunConversation, listElectricPropulsionDrafts, openElectricPropulsionRunInGui } from './agent/electricPropulsionApi'
import { analyzeOrbitKeepingRun, confirmOrbitKeepingDraft, createOrbitKeepingDraft, discussOrbitKeepingDraft, executeOrbitKeepingDraftWithProgress, getOrbitKeepingRunConversation, listOrbitKeepingDrafts, openOrbitKeepingRunInGui, type OrbitKeepingDraft, type OrbitKeepingGenerateResult, type OrbitKeepingProgressEvent, type OrbitKeepingRunConversationTurn } from './agent/orbitKeepingApi'
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

const GMAT_WORKFLOW_LABELS: Record<OrbitKeepingProgressEvent['key'] | 'draft_llm' | 'validate_draft', string> = {
  draft_llm: 'LLM mission discussion',
  validate_draft: 'Validate mission inputs',
  load_template: 'Prepare fixed GMAT template',
  llm_patch: 'Apply confirmed changes',
  render_script: 'Generate GMAT script',
  run_gmat: 'Run GMAT simulation',
  save_results: 'Save GMAT results',
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
  const [progressRefreshNonce, setProgressRefreshNonce] = useState(0)
  const [inputMode, setInputMode] = useState<AgentInputMode>('text')
  const [chatMode, setChatMode] = useState<ChatMode>('general')
  const [modelBackend, setModelBackend] = useState<ManagedModelBackend>('chatModel')
  const [textInput, setTextInput] = useState('')
  const [textInputDisplay, setTextInputDisplay] = useState('')
  const [managedRunError, setManagedRunError] = useState('')
  const [gmatGenerating, setGmatGenerating] = useState(false)
  const [gmatGuiOpening, setGmatGuiOpening] = useState(false)
  const [pendingGmatMessage, setPendingGmatMessage] = useState<PendingGmatMessage | null>(null)
  const [activeGmatDraft, setActiveGmatDraft] = useState<OrbitKeepingDraft | null>(null)
  const [activeGmatRun, setActiveGmatRun] = useState<{ conversation: OrbitKeepingRunConversationTurn[]; draftId?: string; result?: OrbitKeepingGenerateResult['result']; runId: string; runPath: string } | null>(null)
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

  const handleChatModeChange = useCallback((nextMode: ChatMode) => {
    if (nextMode === chatMode) return
    if (state === 'recording') cancelRecording()
    if (agentSpeechPlaying || agentSpeechState === 'synthesizing') stopAgentSpeechPlayback()
    clearAgentSpeechDisplay()
    clearRecorderDisplay()
    setManagedRunError('')
    setTextInputDisplay('')
    setActiveGmatDraft(null)
    setActiveGmatRun(null)
    setPendingGmatMessage(null)
    setChatMode(nextMode)
  }, [agentSpeechPlaying, agentSpeechState, cancelRecording, chatMode, clearAgentSpeechDisplay, clearRecorderDisplay, state, stopAgentSpeechPlayback])

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
  const progressStatusLabel = gmatWorkflowEntries ? `GMAT workflow: ${gmatActiveEntry?.label ?? 'completed'}` : workflowProgressSummary.statusLabel || progressUpdatedAt
  const displayedProgressUpdatedAt = gmatWorkflowEntries?.find(entry => entry.status === 'running')?.updatedAt ?? progressUpdatedAt
  const displayedProgressTitle = gmatWorkflowEntries ? 'GMAT workflow' : t('workspace.inspector.progressTitle')
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
    if (selectedMode === 'general') {
      void runCodex(prompt, 'text')
      return
    }
    setGmatGenerating(true)
    const pendingKind: PendingGmatMessage['kind'] = activeGmatRun ? 'run' : 'draft'
    setPendingGmatMessage({ kind: pendingKind, message: prompt, status: 'sending' })
    setProgressPanelOpen(true)
    setGmatWorkflowEntries(setGmatWorkflowStatus(newGmatWorkflow(), 'draft_llm', 'running'))
    if (activeGmatRun) {
      const analyzeRun = selectedMode === 'gmat-electric-propulsion' ? analyzeElectricPropulsionRun : analyzeOrbitKeepingRun
      void analyzeRun({
        draftId: activeGmatRun.draftId,
        question: prompt,
        runPath: activeGmatRun.runPath,
        workspaceDir: activeContext.versionDir,
      })
        .then(result => {
          setActiveGmatRun(current => current && current.runPath === activeGmatRun.runPath
            ? { ...current, conversation: [...current.conversation, { answer: result.answer, askedAt: new Date().toISOString(), question: prompt }] }
            : current)
          showSpeechText(result.answer)
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
      void createDraft(activeContext.versionDir)
        .then(draft => {
          // Keep the empty draft locally: a failed LLM call can be retried without losing its context.
          setActiveGmatDraft(draft)
          return discussDraft(draft.draftId, prompt, activeContext.versionDir)
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
    void discussDraft(activeGmatDraft.draftId, prompt, activeContext.versionDir)
      .then(draft => { setActiveGmatDraft(draft); setPendingGmatMessage(null); describeDraft(draft); setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(setGmatWorkflowStatus(entries, 'draft_llm', 'completed'), 'validate_draft', 'completed') : entries) })
      .catch(reason => {
        const message = reason instanceof Error ? reason.message : 'GMAT draft update failed'
        setManagedRunError(message)
        setPendingGmatMessage(current => current?.message === prompt ? { ...current, error: message, status: 'failed' } : current)
        setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'draft_llm', 'failed') : entries)
      })
      .finally(() => setGmatGenerating(false))
  }, [activeContext.versionDir, activeGmatDraft, activeGmatRun, chatMode, clearAgentSpeechDisplay, refreshWorkspaceViews, runCodex, showSpeechText, textComposerBusy, textInput])
  const handleExecuteGmatDraft = useCallback(() => {
    if (!activeGmatDraft || gmatGenerating) return
    setGmatGenerating(true)
    setProgressPanelOpen(true)
    setGmatWorkflowEntries(setGmatWorkflowStatus(setGmatWorkflowStatus(newGmatWorkflow(), 'draft_llm', 'completed'), 'validate_draft', 'running'))
    const confirmDraft = chatMode === 'gmat-electric-propulsion' ? confirmElectricPropulsionDraft : confirmOrbitKeepingDraft
    const executeDraft = chatMode === 'gmat-electric-propulsion' ? executeElectricPropulsionDraftWithProgress : executeOrbitKeepingDraftWithProgress
    void confirmDraft(activeGmatDraft.draftId, activeContext.versionDir)
      .then(draft => {
        setActiveGmatDraft(draft)
        setGmatWorkflowEntries(entries => entries ? setGmatWorkflowStatus(entries, 'validate_draft', 'completed') : entries)
        return executeDraft(draft.draftId, {
          workspaceDir: activeContext.versionDir,
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
            : `GMAT completed successfully. You can now ask questions about the saved results without running GMAT again.`,
          askedAt: new Date().toISOString(),
          question: 'GMAT execution',
        }]
        setActiveGmatRun({ conversation, draftId: result.draftId ?? activeGmatDraft.draftId, result: result.result, runId: result.runId, runPath: result.runPath })
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
  }, [activeContext.versionDir, activeGmatDraft, gmatGenerating, refreshWorkspaceViews, showSpeechText])
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
    const isElectricTransfer = activeGmatRun.runPath.includes('gmat/electric-propulsion-transfer/') || activeGmatRun.runPath.includes('gmat\\electric-propulsion-transfer\\')
    void (isElectricTransfer ? openElectricPropulsionRunInGui(activeGmatRun.runPath) : openOrbitKeepingRunInGui(activeGmatRun.runPath))
      .then(() => showSpeechText(`GMAT GUI was opened for run ${activeGmatRun.runId}.`))
      .catch(reason => setManagedRunError(reason instanceof Error ? reason.message : 'Unable to open GMAT GUI'))
      .finally(() => setGmatGuiOpening(false))
  }, [activeGmatRun, gmatGuiOpening, showSpeechText])
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
          activeContext={activeContext}
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
            busy: gmatGenerating,
            chatMode,
            conversation: activeGmatRun?.conversation,
            draft: activeGmatDraft,
            error: error || managedRunError,
            pending: pendingGmatMessage,
            onChangeMode: handleChatModeChange,
            onExecute: handleExecuteGmatDraft,
            onNewRun: () => {
              setActiveGmatRun(null)
              setActiveGmatDraft(null)
              setPendingGmatMessage(null)
              setManagedRunError('')
            },
            onRetry: () => {
              if (pendingGmatMessage?.status === 'failed') handleTextSubmit(pendingGmatMessage.message, chatMode)
            },
            onSend: (message, mode) => handleTextSubmit(message, mode),
          }}
          manifestLoading={manifestLoading}
          onSelectGmatRun={run => {
            setActiveGmatRun({ ...run, conversation: [] })
            const isElectricTransfer = run.runPath.includes('gmat/electric-propulsion-transfer/') || run.runPath.includes('gmat\\electric-propulsion-transfer\\')
            setActiveGmatDraft(null)
            void (isElectricTransfer ? getElectricPropulsionRunConversation(run.runPath) : getOrbitKeepingRunConversation(run.runPath))
              .then(conversation => setActiveGmatRun(current => current?.runPath === run.runPath ? { ...current, conversation } : current))
              .catch(() => null)
            void (isElectricTransfer ? listElectricPropulsionDrafts(activeContext.versionDir) : listOrbitKeepingDrafts(activeContext.versionDir))
              .then(drafts => {
                const draft = drafts.find(candidate => candidate.runs?.some(savedRun => savedRun.runPath === run.runPath))
                if (draft) setActiveGmatDraft(draft)
              })
              .catch(() => null)
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
        />

        <AgentRecorderControl
          activeGmatRunId={activeGmatRun?.runId}
          gmatRunConversation={activeGmatRun?.conversation}
          activeView={activeView}
          agentSpeechError={agentSpeechError}
          agentSpeechState={agentSpeechState}
          busy={recordButtonBusy}
          chatMode="general"
          disabled={recordButtonDisabled}
          error={error || managedRunError}
          gmatDraft={activeGmatDraft}
          gmatPendingMessage={pendingGmatMessage}
          inputMode={inputMode}
          onButtonClick={handleButtonClick}
          onExecuteGmatDraft={handleExecuteGmatDraft}
          onStartNewGmatRun={() => {
            setActiveGmatRun(null)
            setActiveGmatDraft(null)
            setPendingGmatMessage(null)
            clearAgentSpeechDisplay()
            setManagedRunError('')
          }}
          onRetryGmatMessage={() => {
            if (pendingGmatMessage?.status === 'failed') handleTextSubmit(pendingGmatMessage.message, chatMode)
          }}
          onTextChange={setTextInput}
          onTextSubmit={() => handleTextSubmit(undefined, 'general')}
          recorderStatusText={inputMode === 'text' ? textRecorderStatusText : recorderStatusText}
          state={state}
          text={inputMode === 'text' ? textInputDisplay : text}
          textInputDisabled={textComposerBusy}
          textInputValue={textInput}
          visibleAgentResponse={visibleAgentResponse}
        />
      </section>
    </main>
  )
}
