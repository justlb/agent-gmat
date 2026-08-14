import { useEffect, useState, type KeyboardEvent } from 'react'
import { MarkdownText } from '../../../components/outputMarkdown'
import type { AgentChatMode } from '../AgentRecorderControl'
import { getSelectedSatellite, type SimuCicConfiguration } from '../satelliteLibraryApi'

type Draft = {
  assistantMessage?: string
  confirmed: boolean
  conversation?: Array<{ assistant: string; user: string }>
  draftId: string
  missing: string[]
  safety: { assumptions: Array<{ label: string; value: string }>; checks: Array<{ code: string; message: string; severity: 'error' | 'warning' }> }
  status: 'blocked' | 'collecting' | 'ready' | 'confirmed'
  values: Record<string, string | number | null>
} | null

type Field = { derived?: 'initialAltitude'; label: string; path: string; unit?: string }
const EARTH_EQUATORIAL_RADIUS_KM = 6378.1363
const ORBIT_FIELDS: Field[] = [
  { label: 'Epoch', path: 'initialOrbit.epoch' }, { label: 'Initial semi-major axis', path: 'initialOrbit.smaKm', unit: 'km' },
  { derived: 'initialAltitude', label: 'Initial altitude', path: 'initialOrbit.altitudeKm', unit: 'km' },
  { label: 'Eccentricity', path: 'initialOrbit.eccentricity' }, { label: 'Inclination', path: 'initialOrbit.inclinationDeg', unit: 'deg' },
  { label: 'Drag area', path: 'spacecraft.dragAreaM2', unit: 'm²' }, { label: 'Drag coefficient', path: 'spacecraft.dragCoefficient' },
  { label: 'Initial fuel mass', path: 'spacecraft.initialFuelMassKg', unit: 'kg' },
  { label: 'Minimum reboost altitude', path: 'stationKeeping.minimumAltitudeKm', unit: 'km' },
]
const ELECTRIC_FIELDS: Field[] = [
  { label: 'Initial epoch', path: 'initialOrbit.epoch' }, { label: 'Initial semi-major axis', path: 'initialOrbit.smaKm', unit: 'km' },
  { derived: 'initialAltitude', label: 'Initial altitude', path: 'initialOrbit.altitudeKm', unit: 'km' },
  { label: 'Initial eccentricity', path: 'initialOrbit.eccentricity' }, { label: 'Initial inclination', path: 'initialOrbit.inclinationDeg', unit: 'deg' },
  { label: 'Electric-thrust duration', path: 'transfer.burnDurationDays', unit: 'days' },
]

function valueAt(document: Record<string, unknown>, path: string): string | number | null {
  let value: unknown = document
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    value = (value as Record<string, unknown>)[key]
  }
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function runValuesFromSatelliteJson(document: Record<string, unknown>, mode: AgentChatMode) {
  const values: Record<string, string | number | null> = {
    'initialOrbit.epoch': valueAt(document, 'satellite.orbit.reference_epoch_tai_mod_julian'),
    'initialOrbit.smaKm': valueAt(document, 'satellite.orbit.keplerian_elements.semi_major_axis_km'),
    'initialOrbit.eccentricity': valueAt(document, 'satellite.orbit.keplerian_elements.eccentricity'),
    'initialOrbit.inclinationDeg': valueAt(document, 'satellite.orbit.keplerian_elements.inclination_deg'),
  }
  if (mode === 'gmat-electric-propulsion') {
    values['transfer.burnDurationDays'] = valueAt(document, 'analysis_requests.gmat.electric_propulsion_transfer.burn_duration_days')
  } else {
    values['spacecraft.initialFuelMassKg'] = valueAt(document, 'analysis_requests.gmat.orbit_keeping.initial_fuel_mass_kg')
    values['stationKeeping.minimumAltitudeKm'] = valueAt(document, 'analysis_requests.gmat.orbit_keeping.minimum_reboost_altitude_km')
  }
  return values
}

function verifyRunValuesAgainstAdapter(values: Record<string, string | number | null>, adapter: Record<string, string | number | null> | undefined) {
  if (!adapter) return 'Verified directly from satellite.json'
  const mismatches = Object.keys(values).filter(key => values[key] !== null && adapter[key] !== undefined && String(values[key]) !== String(adapter[key]))
  return mismatches.length ? `Verification warning: ${mismatches.join(', ')} differs from the GMAT adapter; satellite.json is displayed.` : 'Verified against satellite.json'
}

export type GmatMissionChatProps = {
  activeRunId?: string
  chatMode: AgentChatMode
  conversation?: Array<{ answer: string; askedAt: string; question: string }>
  draft: Draft
  error: string
  gmatRunFailed?: boolean
  busy: boolean
  pending?: { error?: string; kind: 'draft' | 'run'; message: string; status: 'sending' | 'failed' } | null
  onExecute: () => void
  onNewRun: () => void
  onRunSimuCic?: () => void
  onRunOpalis?: () => void
  onStopCalculations?: () => void
  onRetry: () => void
  onSend: (message: string, mode: AgentChatMode) => void
  simuCicConversation?: Array<{ answer: string; askedAt: string; question: string }>
  simuCicRefreshNonce?: number
  simuCicRunning?: boolean
  workspaceDir?: string | null
}

export function GmatMissionChat({ activeRunId, busy, chatMode, conversation = [], draft, error, gmatRunFailed = false, onExecute, onNewRun, onRunSimuCic, onRunOpalis, onStopCalculations, onRetry, onSend, pending, simuCicConversation = [], simuCicRefreshNonce = 0, simuCicRunning = false, workspaceDir }: GmatMissionChatProps) {
  const [message, setMessage] = useState('')
  const [simuCic, setSimuCic] = useState<SimuCicConfiguration>({ attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null })
  const [savedRunValues, setSavedRunValues] = useState<Record<string, string | number | null> | null>(null)
  const [runValuesVerification, setRunValuesVerification] = useState('')
  useEffect(() => {
    let cancelled = false
    // Do not render an attitude law from the previously selected draft/run
    // while the next run's satellite.json is loading. That brief stale state
    // made e.g. "Bremen" appear although the new run and Simu-CIC calculation
    // both use the default nadir law.
    setSimuCic({ attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null })
    void getSelectedSatellite(workspaceDir)
      .then(result => {
        if (cancelled) return
        const configuration = result.document.analysis_requests?.simu_cic ?? { attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null }
        setSimuCic(configuration.attitude_mode === 'ground_station_tracking'
          ? configuration
          : { attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null })
        const satelliteValues = activeRunId ? runValuesFromSatelliteJson(result.document, chatMode) : null
        const adapterValues = chatMode === 'gmat-electric-propulsion' ? result.adapters?.gmat?.electricPropulsionTransfer?.values : result.adapters?.gmat?.orbitKeeping?.values
        setSavedRunValues(satelliteValues)
        setRunValuesVerification(satelliteValues ? verifyRunValuesAgainstAdapter(satelliteValues, adapterValues) : '')
      })
      .catch(() => { if (!cancelled) { setSimuCic({ attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null }); setSavedRunValues(null); setRunValuesVerification('Unable to verify satellite.json') } })
    return () => { cancelled = true }
  }, [workspaceDir, draft?.draftId, draft?.status, activeRunId, chatMode, simuCicRefreshNonce])
  const fields = (chatMode === 'gmat-electric-propulsion' ? ELECTRIC_FIELDS : ORBIT_FIELDS)
    .filter(field => field.path === 'spacecraft.initialFuelMassKg' || (!field.path.startsWith('spacecraft.') && !field.path.startsWith('propulsion.') && !field.path.startsWith('power.')))
  const displayedValues = activeRunId ? savedRunValues : draft?.values ?? null
  const submit = () => {
    const prompt = message.trim()
    if (!prompt || busy) return
    setMessage('')
    onSend(prompt, chatMode)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit() }
  }
  const missing = displayedValues ? fields.filter(field => !field.derived && (displayedValues[field.path] === null || displayedValues[field.path] === undefined || displayedValues[field.path] === '')).map(field => field.label) : []
  const blockers = draft?.safety?.checks.filter(check => check.severity === 'error') ?? []
  const warnings = draft?.safety?.checks.filter(check => check.severity === 'warning') ?? []
  const simuCicNeedsStations = simuCic.attitude_mode === 'ground_station_tracking' && !simuCic.ground_station_ids.length
  const simuCicComplete = simuCic.attitude_mode === 'nadir_pointing' || (simuCic.attitude_mode === 'ground_station_tracking' && !simuCicNeedsStations)
  const runConversation = [
    ...(draft?.conversation ?? []).map(turn => ({ answer: turn.assistant, askedAt: '', question: turn.user })),
    ...conversation,
  ].filter((turn, index, turns) => turns.findIndex(candidate => candidate.question === turn.question && candidate.answer === turn.answer) === index)
  const draftConversation = [
    ...(draft?.conversation ?? []).map(turn => ({ answer: turn.assistant, askedAt: '', question: turn.user })),
  ].filter((turn, index, turns) => turns.findIndex(candidate => candidate.question === turn.question && candidate.answer === turn.answer) === index)

  return (
    <section className="gmat-mission-chat" aria-label="GMAT mission conversation">
      <div className="gmat-mission-chat-tabs" aria-label="Conversation channel"><span>General</span></div>
      <div className="gmat-mission-chat-layout">
          <aside className="gmat-mission-chat-sidebar">
            {activeRunId ? <><strong>Run values</strong><span>{activeRunId}</span></> : null}
            {draft || (activeRunId && displayedValues) ? <>
              <section><header><strong>{activeRunId ? 'Saved GMAT mission values' : 'Required before GMAT can run'}</strong><span>{missing.length ? `${missing.length} remaining` : 'Complete'}</span></header>{activeRunId ? <p className="gmat-mission-source-verification">{runValuesVerification}</p> : null}<ul>
                {fields.map(field => {
                  const semiMajorAxis = displayedValues?.['initialOrbit.smaKm']
                  const derivedAltitude = field.derived === 'initialAltitude' && typeof semiMajorAxis === 'number'
                    ? Number((semiMajorAxis - EARTH_EQUATORIAL_RADIUS_KM).toFixed(3))
                    : null
                  const value = field.derived ? derivedAltitude : displayedValues?.[field.path]
                  const absent = field.derived ? derivedAltitude === null : value === null || value === undefined || value === ''
                  return <li className={absent ? 'is-missing' : ''} key={field.derived ?? field.path}><span>{field.label}</span><b>{absent ? 'Not provided' : `${value}${field.unit ? ` ${field.unit}` : ''}`}</b></li>
                })}
              </ul></section>
              <section><header><strong>Required before Simu-CIC can run</strong><span>{simuCicComplete ? 'Complete' : simuCicNeedsStations ? 'Station required' : 'Attitude law required'}</span></header><ul>
                <li><span>Attitude behavior</span><b>{simuCic.attitude_mode === 'nadir_pointing' ? 'Nadir pointing' : simuCic.attitude_mode === 'ground_station_tracking' ? 'Track ground station(s)' : 'Nadir pointing'}</b></li>
                {simuCic.attitude_mode === 'ground_station_tracking' ? <li className={simuCicNeedsStations ? 'is-missing' : ''}><span>Ground stations</span><b>{simuCic.ground_station_ids.length ? simuCic.ground_station_ids.join(', ') : 'Not provided'}</b></li> : null}
              </ul><p className="gmat-mission-simucic-hint">Ask the LLM in writing for the predefined ground-station list or to configure the attitude behavior.</p></section>
              {draft ? <><section><header><strong>Assumed defaults to confirm</strong><span>Template defaults</span></header><ul className="assumptions">{(draft.safety?.assumptions ?? []).map(item => <li key={item.label}>{item.label}: {item.value}</li>)}</ul></section>
              {!activeRunId ? <>
                <button
                  className="gmat-mission-run-button"
                  disabled={busy || draft.status !== 'ready'}
                  title={draft.status === 'ready' ? 'Confirm the mission inputs and run GMAT.' : draft.missing.length ? 'Complete the required mission inputs before running GMAT.' : blockers.map(check => check.message).join(' ')}
                  type="button"
                  onClick={onExecute}
                >Confirm and run GMAT</button>
                {draft.status !== 'ready' && !draft.missing.length && blockers.length ? <p className="gmat-mission-run-blocker">GMAT is blocked by the safety check shown in the discussion.</p> : null}
              </> : null}</> : null}
            </> : activeRunId ? <p>Loading saved mission values…</p> : <p>Describe the mission to start a new draft.</p>}
            {activeRunId && gmatRunFailed ? <><p className="gmat-mission-run-blocker">GMAT failed. Fix the mission values if needed, then run GMAT again before continuing to Simu-CIC or OPALIS.</p><button className="gmat-mission-run-button" disabled={busy || !draft} type="button" onClick={onExecute}>Retry GMAT</button></> : null}
            {activeRunId && !gmatRunFailed && onRunSimuCic ? <button className="gmat-mission-run-button" disabled={simuCicRunning} type="button" onClick={onRunSimuCic}>{simuCicRunning ? 'Running Simu-CIC…' : 'Run Simu-CIC'}</button> : null}
            {activeRunId && !gmatRunFailed && onRunOpalis ? <button className="gmat-mission-run-button" disabled={simuCicRunning || busy} type="button" onClick={onRunOpalis}>Run OPALIS (includes Simu-CIC)</button> : null}
            {activeRunId ? <button type="button" onClick={onNewRun}>Start separate GMAT mission</button> : null}
          </aside>
          <section className="gmat-mission-chat-thread" aria-live="polite">
            <header><strong>{activeRunId ? 'Run discussion' : 'Mission discussion'}</strong><span>{activeRunId ? 'Ask about results or request changed values for a new run' : 'Draft assistant'}</span></header>
            <div className="gmat-mission-chat-history">
              {error && pending?.status !== 'failed' ? <StatusMessage text={error} variant="error" title="GMAT error" /> : null}
              {missing.length ? <StatusMessage text={`GMAT cannot run yet. Missing required data: ${missing.join(', ')}.`} title="GMAT status" /> : null}
              {blockers.map(item => <StatusMessage key={item.code} text={item.message} title="GMAT safety check" />)}
              {warnings.map(item => <StatusMessage key={item.code} text={item.message} title="GMAT warning" />)}
              {activeRunId ? runConversation.map((turn, index) => <Turn answer={turn.answer} key={`${turn.askedAt}-${index}`} question={turn.question} />) : draft ? draftConversation.map((turn, index) => <Turn answer={turn.answer} key={`${turn.askedAt}-${index}`} question={turn.question} />) : simuCicConversation.map((turn, index) => <Turn answer={turn.answer} key={`${turn.askedAt}-${index}`} question={turn.question} />)}
              {pending ? <><p className="is-user is-pending"><span>You</span>{pending.message}</p>{pending.status === 'sending' ? <p className="is-assistant is-pending"><span>GMAT assistant</span>{pending.kind === 'run' ? 'Analyzing saved results…' : 'Thinking…'}</p> : <div className="gmat-mission-send-error"><span>GMAT assistant</span><p>{pending.error || 'Message was not sent.'}</p><button type="button" onClick={onRetry}>Retry</button></div>}</> : null}
              {!activeRunId && !draft && !simuCicConversation.length && !pending ? <p className="gmat-mission-chat-placeholder">Start by describing a GMAT mission, or ask the assistant about Simu-CIC attitude behavior.</p> : null}
            </div>
            <div className="gmat-mission-composer"><textarea disabled={busy} onChange={event => setMessage(event.target.value)} onKeyDown={onKeyDown} placeholder={activeRunId ? 'Ask a question about this completed run...' : 'Describe the mission parameters to validate...'} rows={3} value={message} /><button disabled={busy || !message.trim()} onClick={submit} type="button">Send</button>{busy && onStopCalculations ? <button className="gmat-mission-stop-button" onClick={onStopCalculations} type="button">Stop calculations</button> : null}</div>
          </section>
      </div>
    </section>
  )
}

function Turn({ answer, question }: { answer: string; question: string }) {
  return <div className="gmat-mission-turn">
    <div className="is-user"><span>You</span><MarkdownText text={question} /></div>
    <div className="is-assistant"><span>GMAT assistant</span><MarkdownText text={answer} /></div>
  </div>
}

function StatusMessage({ text, title, variant }: { text: string; title: string; variant?: 'error' }) {
  return <div className={`gmat-mission-status ${variant === 'error' ? 'is-error' : ''}`}><span>{title}</span><MarkdownText text={text} /></div>
}
