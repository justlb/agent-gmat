import { useState } from 'react'
import type { WorkspaceSessionStatus } from '../workspace/workspaceSessionVisibility'

type AgentInputMode = 'voice' | 'text'
type AgentModelBackend = 'openai' | 'chatModel'
type AgentTheme = 'dark' | 'light'

function formatCheckedAt(value?: string) {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour12: false })
}

function formatInterfaceDetail(item: InterfaceCheckResult) {
  const duration = Number.isFinite(item.durationMs) ? `${item.durationMs}ms` : ''
  const status = item.status ? `HTTP ${item.status}` : ''
  const message = item.ok ? item.message : item.error || item.message
  return [item.target, status, duration, message].filter(Boolean).join(' · ')
}

export type InterfaceCheckResult = {
  ok: boolean
  group: string
  name: string
  target: string
  required: boolean
  skipped: boolean
  durationMs: number
  message: string
  error?: string
  status?: number
  bytes?: number
}

export type RemoteToolPortSummary = {
  ok: boolean
  checkedAt: string
  cacheTtlMs?: number
  results: InterfaceCheckResult[]
  requiredFailureCount: number
  optionalFailureCount: number
  skippedCount: number
}

type AgentTopbarProps = {
  agentTheme: AgentTheme
  conversationOpen: boolean
  dataSourceLabel: string
  inputMode: AgentInputMode
  modelBackend: AgentModelBackend
  onAgentThemeChange: (nextTheme: AgentTheme) => void
  onInputModeChange: (nextMode: AgentInputMode) => void
  onModelBackendChange: (nextBackend: AgentModelBackend) => void
  onConversationToggle: () => void
  portStatus: RemoteToolPortSummary | null
  portStatusError: string
  portStatusLoading: boolean
  onPortStatusRefresh: () => void
  onProgressToggle: () => void
  onStopAndSummarize: () => void
  progressOpen: boolean
  progressPercent?: number
  progressStatusLabel: string
  progressTitle: string
  sessionStatus: WorkspaceSessionStatus
  sessionStatusLabel: string
  stopSummaryPending: boolean
  versionLabel: string
}

export function AgentTopbar({
  agentTheme,
  conversationOpen,
  dataSourceLabel,
  inputMode,
  modelBackend,
  onAgentThemeChange,
  onInputModeChange,
  onModelBackendChange,
  onConversationToggle,
  portStatus,
  portStatusError,
  portStatusLoading,
  onPortStatusRefresh,
  onProgressToggle,
  onStopAndSummarize,
  progressOpen,
  progressPercent,
  progressStatusLabel,
  progressTitle,
  sessionStatus,
  sessionStatusLabel,
  stopSummaryPending,
  versionLabel,
}: AgentTopbarProps) {
  const [portPanelOpen, setPortPanelOpen] = useState(false)
  const showStopButton = sessionStatus === 'running'
  const portVariant = portStatusError
    ? 'bad'
    : portStatus?.ok
      ? 'ok'
      : portStatusLoading && !portStatus
        ? 'checking'
        : 'bad'
  const failedChecks = portStatus?.results.filter(item => !item.ok) ?? []
  const skippedChecks = portStatus?.results.filter(item => item.skipped) ?? []
  const showInterfaceStatus = Boolean(portStatusError || failedChecks.length)
  const checkedAtLabel = formatCheckedAt(portStatus?.checkedAt)
  const inputModeLabel = inputMode === 'voice' ? 'Voice input' : 'Text input'
  const totalChecks = portStatus?.results.length ?? 0

  return (
    <header className="agent-hud-topbar">
      <div className="agent-brand">
        <img src="/logo_1.png" alt="SATLAB" className="agent-brand-logo" />
      </div>
      <div className="agent-topbar-status">
        <div className={`agent-session-control ${showStopButton ? 'has-stop' : ''}`}>
          <button
            type="button"
            className={`agent-status-pill agent-status-pill--session agent-session-pill is-${sessionStatus} ${conversationOpen ? 'is-open' : ''}`}
            aria-expanded={conversationOpen}
            aria-haspopup="dialog"
            onClick={onConversationToggle}
          >
            <span className="agent-session-status">
              <span className="agent-session-dot" />
              <span className="agent-session-label">{sessionStatusLabel}</span>
            </span>
            <span className="agent-session-copy">
              <span className="agent-session-source">{dataSourceLabel}</span>
              <span className="agent-session-version">· {versionLabel}</span>
            </span>
          </button>
          {showStopButton ? (
            <button
              type="button"
              className="agent-stop-summary-button agent-stop-summary-button--topbar"
              disabled={stopSummaryPending}
              onClick={onStopAndSummarize}
              title="Stop the current Codex pipeline and generate a spoken summary"
            >
              <span aria-hidden="true" />
              {stopSummaryPending ? 'Summarizing' : 'Stop'}
            </button>
          ) : null}
        </div>
      </div>
      <div className="agent-topbar-port-status">
        <button
          type="button"
          className={`agent-status-pill agent-status-pill--progress agent-progress-pill ${progressOpen ? 'is-open' : ''}`}
          aria-expanded={progressOpen}
          aria-haspopup="dialog"
          onClick={onProgressToggle}
        >
          <span className="agent-progress-orbit" aria-hidden="true" />
          <span className="agent-progress-copy">
            <strong>{progressTitle}</strong>
            <small>{progressStatusLabel}</small>
          </span>
          {typeof progressPercent === 'number' ? <span className="agent-progress-value">{progressPercent}%</span> : null}
        </button>
        <button
          type="button"
          className={`agent-port-card is-${portVariant} ${portPanelOpen ? 'is-open' : ''}`}
          title={`${inputModeLabel}. Open status and settings.`}
          aria-expanded={portPanelOpen}
          aria-haspopup="dialog"
          onClick={() => setPortPanelOpen(open => !open)}
        >
          <span
            className={`agent-input-mode-icon ${inputMode === 'text' ? 'is-muted' : 'is-live'}`}
            aria-label={inputModeLabel}
            role="img"
          >
            <span className="agent-input-muted-slash" aria-hidden="true" />
          </span>
        </button>
        {portPanelOpen ? (
          <div className="agent-port-popover" role="dialog" aria-label="Status and settings">
            <section className="agent-port-settings-section">
              <div className="agent-port-mode-row">
                <span>Input</span>
                <div className="agent-input-mode-switch" role="group" aria-label="Input mode">
                  <button
                    type="button"
                    className={inputMode === 'voice' ? 'is-active' : ''}
                    aria-pressed={inputMode === 'voice'}
                    onClick={() => onInputModeChange('voice')}
                  >
                    Voice
                  </button>
                  <button
                    type="button"
                    className={inputMode === 'text' ? 'is-active' : ''}
                    aria-pressed={inputMode === 'text'}
                    onClick={() => onInputModeChange('text')}
                  >
                    Text
                  </button>
                </div>
              </div>
              <div className="agent-port-mode-row">
                <span>Model</span>
                <div className="agent-input-mode-switch" role="group" aria-label="Model">
                  <button
                    type="button"
                    className={modelBackend === 'openai' ? 'is-active' : ''}
                    aria-pressed={modelBackend === 'openai'}
                    onClick={() => onModelBackendChange('openai')}
                  >
                    OpenAI
                  </button>
                  <button
                    type="button"
                    className={modelBackend === 'chatModel' ? 'is-active' : ''}
                    aria-pressed={modelBackend === 'chatModel'}
                    onClick={() => onModelBackendChange('chatModel')}
                  >
                    Internal model
                  </button>
                </div>
              </div>
              <div className="agent-port-mode-row">
                <span>Theme</span>
                <div className="agent-input-mode-switch" role="group" aria-label="Theme">
                  <button
                    type="button"
                    className={agentTheme === 'dark' ? 'is-active' : ''}
                    aria-pressed={agentTheme === 'dark'}
                    onClick={() => onAgentThemeChange('dark')}
                  >
                    Dark
                  </button>
                  <button
                    type="button"
                    className={agentTheme === 'light' ? 'is-active' : ''}
                    aria-pressed={agentTheme === 'light'}
                    onClick={() => onAgentThemeChange('light')}
                  >
                    Light
                  </button>
                </div>
              </div>
            </section>
            {showInterfaceStatus ? (
              <>
                <section className="agent-interface-section">
                  <div className="agent-interface-summary">
                    <div>
                      <strong>{portStatusError || !portStatus?.ok ? 'Interface issue' : 'Interface status'}</strong>
                      <span>
                        {portStatus
                          ? `${totalChecks} checks · ${failedChecks.length} failing${skippedChecks.length ? ` · ${skippedChecks.length} skipped` : ''}${checkedAtLabel ? ` · ${checkedAtLabel}` : ''}`
                          : portStatusLoading
                            ? 'Checking service interfaces'
                            : 'Waiting for results'}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="agent-interface-refresh"
                      disabled={portStatusLoading}
                      onClick={onPortStatusRefresh}
                    >
                      {portStatusLoading ? 'Checking' : 'Check again'}
                    </button>
                  </div>
                </section>
                {portStatusError ? (
                  <p className="agent-port-error">{portStatusError}</p>
                ) : (
                  <>
                    <div className="agent-port-list">
                      {failedChecks.map(item => (
                        <div className={`agent-port-row ${item.ok ? 'ok' : 'bad'}`} key={`${item.group}:${item.name}:${item.target}`}>
                          <span className="agent-port-row-dot" />
                          <div>
                            <strong>{item.name}</strong>
                            <span>{formatInterfaceDetail(item)}</span>
                          </div>
                          <em>{item.required ? 'Error' : 'Warning'}</em>
                        </div>
                      ))}
                    </div>
                    <p className="agent-port-check-note is-bad">
                      {`${failedChecks.length} interface issue(s) detected`}
                      {checkedAtLabel ? ` · ${checkedAtLabel}` : ''}
                    </p>
                  </>
                )}
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </header>
  )
}
