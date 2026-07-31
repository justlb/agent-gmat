import { useState, type KeyboardEvent } from 'react'
import type { AgentChatMode } from '../AgentRecorderControl'

type Draft = {
  conversation?: Array<{ assistant: string; user: string }>
  missing: string[]
  safety?: { assumptions: Array<{ label: string; value: string }>; checks: Array<{ code: string; message: string; severity: 'error' | 'warning' }> }
  status: 'blocked' | 'collecting' | 'ready' | 'confirmed'
  values: Record<string, string | number | null>
} | null

type Field = { label: string; path: string; unit?: string }
const ORBIT_FIELDS: Field[] = [
  { label: 'Epoch', path: 'initialOrbit.epoch' }, { label: 'Initial semi-major axis', path: 'initialOrbit.smaKm', unit: 'km' },
  { label: 'Eccentricity', path: 'initialOrbit.eccentricity' }, { label: 'Inclination', path: 'initialOrbit.inclinationDeg', unit: 'deg' },
  { label: 'Dry mass', path: 'spacecraft.dryMassKg', unit: 'kg' }, { label: 'Initial fuel mass', path: 'spacecraft.initialFuelMassKg', unit: 'kg' },
  { label: 'Minimum reboost altitude', path: 'stationKeeping.minimumAltitudeKm', unit: 'km' },
]
const ELECTRIC_FIELDS: Field[] = [
  { label: 'Initial epoch', path: 'initialOrbit.epoch' }, { label: 'Initial semi-major axis', path: 'initialOrbit.smaKm', unit: 'km' },
  { label: 'Initial eccentricity', path: 'initialOrbit.eccentricity' }, { label: 'Initial inclination', path: 'initialOrbit.inclinationDeg', unit: 'deg' },
  { label: 'Dry mass', path: 'spacecraft.dryMassKg', unit: 'kg' },
  { label: 'Initial electric propellant mass', path: 'spacecraft.initialFuelMassKg', unit: 'kg' }, { label: 'Electric-thrust duration', path: 'transfer.burnDurationDays', unit: 'days' },
]

export type GmatMissionChatProps = {
  activeRunId?: string
  chatMode: AgentChatMode
  conversation?: Array<{ answer: string; askedAt: string; question: string }>
  draft: Draft
  error: string
  busy: boolean
  pending?: { error?: string; kind: 'draft' | 'run'; message: string; status: 'sending' | 'failed' } | null
  onChangeMode: (mode: AgentChatMode) => void
  onExecute: () => void
  onNewRun: () => void
  onRetry: () => void
  onSend: (message: string, mode: AgentChatMode) => void
}

export function GmatMissionChat({ activeRunId, busy, chatMode, conversation = [], draft, error, onChangeMode, onExecute, onNewRun, onRetry, onSend, pending }: GmatMissionChatProps) {
  const [message, setMessage] = useState('')
  const isGeneral = chatMode === 'general'
  const fields = chatMode === 'gmat-electric-propulsion' ? ELECTRIC_FIELDS : ORBIT_FIELDS
  const submit = () => {
    const prompt = message.trim()
    if (!prompt || busy || isGeneral) return
    setMessage('')
    onSend(prompt, chatMode)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() }
  }
  const missing = draft ? fields.filter(field => draft.missing.includes(field.path)).map(field => field.label) : []
  const blockers = draft?.safety?.checks.filter(check => check.severity === 'error') ?? []
  const warnings = draft?.safety?.checks.filter(check => check.severity === 'warning') ?? []

  return (
    <section className="gmat-mission-chat" aria-label="GMAT mission conversation">
      <div className="gmat-mission-chat-tabs" role="group" aria-label="GMAT template">
        <button aria-pressed={isGeneral} className={isGeneral ? 'is-selected' : ''} onClick={() => onChangeMode('general')} type="button">General</button>
        <button aria-pressed={chatMode === 'gmat-orbit-keeping'} className={chatMode === 'gmat-orbit-keeping' ? 'is-selected' : ''} onClick={() => onChangeMode('gmat-orbit-keeping')} type="button">GMAT Orbit Keeping</button>
        <button aria-pressed={chatMode === 'gmat-electric-propulsion'} className={chatMode === 'gmat-electric-propulsion' ? 'is-selected' : ''} onClick={() => onChangeMode('gmat-electric-propulsion')} type="button">GMAT Electric Transfer</button>
      </div>
      {isGeneral ? <div className="gmat-mission-chat-empty"><strong>Select a GMAT template.</strong><span>Mission drafts, runs, files, and run discussions are managed here.</span></div> : (
        <div className="gmat-mission-chat-layout">
          <aside className="gmat-mission-chat-sidebar">
            {activeRunId ? <><strong>Run values</strong><span>{activeRunId}</span></> : null}
            {draft ? <>
              <section><header><strong>Required before GMAT can run</strong><span>{draft.missing.length ? `${draft.missing.length} remaining` : 'Complete'}</span></header><ul>
                {fields.map(field => { const value = draft.values[field.path]; const absent = draft.missing.includes(field.path) || value === null || value === undefined || value === ''; return <li className={absent ? 'is-missing' : ''} key={field.path}><span>{field.label}</span><b>{absent ? 'Not provided' : `${value}${field.unit ? ` ${field.unit}` : ''}`}</b></li> })}
              </ul></section>
              <section><header><strong>Assumed defaults to confirm</strong><span>Template defaults</span></header><ul className="assumptions">{(draft.safety?.assumptions ?? []).map(item => <li key={item.label}>{item.label}: {item.value}</li>)}</ul></section>
              {!activeRunId && draft.status === 'ready' ? <button className="gmat-mission-run-button" disabled={busy} type="button" onClick={onExecute}>Confirm and run GMAT</button> : null}
            </> : activeRunId ? <p>The mission values are not loaded for this saved run.</p> : <p>Describe the mission to start a new draft.</p>}
            {activeRunId ? <button type="button" onClick={onNewRun}>New GMAT run</button> : null}
          </aside>
          <section className="gmat-mission-chat-thread" aria-live="polite">
            <header><strong>{activeRunId ? 'Run discussion' : 'Mission discussion'}</strong><span>{activeRunId ? 'Ask about saved results without rerunning GMAT' : 'Draft assistant'}</span></header>
            <div className="gmat-mission-chat-history">
              {error && pending?.status !== 'failed' ? <StatusMessage text={error} variant="error" title="GMAT error" /> : null}
              {missing.length ? <StatusMessage text={`GMAT cannot run yet. Missing required data: ${missing.join(', ')}.`} title="GMAT status" /> : null}
              {blockers.map(item => <StatusMessage key={item.code} text={item.message} title="GMAT safety check" />)}
              {warnings.map(item => <StatusMessage key={item.code} text={item.message} title="GMAT warning" />)}
              {activeRunId ? conversation.map((turn, index) => <Turn answer={turn.answer} key={`${turn.askedAt}-${index}`} question={turn.question} />) : (draft?.conversation ?? []).map((turn, index) => <Turn answer={turn.assistant} key={`${turn.user}-${index}`} question={turn.user} />)}
              {pending ? <><p className="is-user is-pending"><span>You</span>{pending.message}</p>{pending.status === 'sending' ? <p className="is-assistant is-pending"><span>GMAT assistant</span>{pending.kind === 'run' ? 'Analyzing saved results…' : 'Thinking…'}</p> : <div className="gmat-mission-send-error"><span>GMAT assistant</span><p>{pending.error || 'Message was not sent.'}</p><button type="button" onClick={onRetry}>Retry</button></div>}</> : null}
              {!activeRunId && !draft && !pending ? <p className="gmat-mission-chat-placeholder">Start by describing a GMAT mission.</p> : null}
            </div>
            <div className="gmat-mission-composer"><textarea disabled={busy} onChange={event => setMessage(event.target.value)} onKeyDown={onKeyDown} placeholder={activeRunId ? 'Ask a question about this completed run...' : 'Describe the mission parameters to validate...'} rows={3} value={message} /><button disabled={busy || !message.trim()} onClick={submit} type="button">Send</button></div>
          </section>
        </div>
      )}
    </section>
  )
}

function Turn({ answer, question }: { answer: string; question: string }) { return <div className="gmat-mission-turn"><p className="is-user"><span>You</span>{question}</p><p className="is-assistant"><span>GMAT assistant</span>{answer}</p></div> }
function StatusMessage({ text, title, variant }: { text: string; title: string; variant?: 'error' }) { return <p className={`gmat-mission-status ${variant === 'error' ? 'is-error' : ''}`}><span>{title}</span>{text}</p> }
