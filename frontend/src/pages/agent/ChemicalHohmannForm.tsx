import { useEffect, useState } from 'react'

import { confirmChemicalHohmannDraft, createChemicalHohmannDraft, discussChemicalHohmannDraft, executeChemicalHohmannDraft, listChemicalHohmannDrafts, type ChemicalHohmannDraft } from './chemicalHohmannApi'
import { updateMissionValue } from './missionValuesApi'
import { askMissionAssistant } from './missionAssistantApi'
import { getSelectedSatellite, listSimuCicGroundStations, saveSimuCicConfiguration, type PredefinedGroundStation, type SimuCicConfiguration } from './satelliteLibraryApi'

type Field = { label: string; path: string; placeholder: string; unit?: string }

const EARTH_EQUATORIAL_RADIUS_KM = 6378.1363
const REQUIRED_FIELDS: Field[] = [
  { label: 'Initial epoch', path: 'initialOrbit.epoch', placeholder: 'TAIModJulian, e.g. 21545' },
  { label: 'Initial altitude', path: 'initialOrbit.smaKm', placeholder: 'km above Earth surface', unit: 'km' },
  { label: 'Initial eccentricity', path: 'initialOrbit.eccentricity', placeholder: '0 to < 1' },
  { label: 'Initial inclination', path: 'initialOrbit.inclinationDeg', placeholder: 'degrees', unit: 'deg' },
  { label: 'Target altitude', path: 'transfer.targetRadiusKm', placeholder: 'km above Earth surface', unit: 'km' },
]
const OPTIONAL_FIELDS: Field[] = [
  { label: 'Target eccentricity', path: 'transfer.targetEccentricity', placeholder: 'default 0.005' },
  { label: 'Final propagation duration', path: 'transfer.finalPropagationSeconds', placeholder: 'seconds', unit: 's' },
]
const RF_COMLINK_GROUND_STATION_IDS = new Set(['kiruna', 'kourou', 'inuvik', 'aussaguel'])

function fieldValue(draft: ChemicalHohmannDraft | null, path: string) {
  const value = draft?.values[path]
  if ((path === 'initialOrbit.smaKm' || path === 'transfer.targetRadiusKm') && typeof value === 'number') return String(Number((value - EARTH_EQUATORIAL_RADIUS_KM).toFixed(6)))
  return value === null || value === undefined ? '' : String(value)
}

export function ChemicalHohmannForm({ activeRunId, conversation = [], onChanged, onNewRun, onRunExecuted, onRunOpalis, onRunRfComlink, onRunSimuCic, onSaveRfComlinkResults, onSimuCicConfigurationChanged, rfComlinkCalculationStarting = false, rfComlinkPrepared = false, rfComlinkPreparing = false, rfComlinkResultsSaving = false, selectedSatelliteId, simuCicCompleted = false, simuCicRunning = false, workspaceDir }: {
  activeRunId?: string
  conversation?: Array<{ answer: string; askedAt: string; question: string }>
  onChanged?: () => void
  onRunExecuted?: (run: { result: { error?: string; executionDurationMs?: number; status: 'generated' | 'completed' | 'failed' | 'timeout' }; runId: string; runPath: string }) => void
  onNewRun?: () => void
  onSaveRfComlinkResults?: () => void
  onRunOpalis?: () => void
  onRunRfComlink?: () => void
  onRunSimuCic?: () => void
  onSimuCicConfigurationChanged?: () => void
  rfComlinkCalculationStarting?: boolean
  rfComlinkPrepared?: boolean
  rfComlinkPreparing?: boolean
  rfComlinkResultsSaving?: boolean
  selectedSatelliteId?: string
  simuCicCompleted?: boolean
  simuCicRunning?: boolean
  workspaceDir?: string | null
}) {
  const [draft, setDraft] = useState<ChemicalHohmannDraft | null>(null)
  const [entries, setEntries] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [assistantMessage, setAssistantMessage] = useState('')
  const [runAnalysis, setRunAnalysis] = useState('')
  const [groundStations, setGroundStations] = useState<PredefinedGroundStation[]>([])
  const [simuCic, setSimuCic] = useState<SimuCicConfiguration>({ attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null })
  const validWorkspace = Boolean(workspaceDir && /[\\/]gmat[\\/]mission-runs[\\/][^\\/]+$/u.test(workspaceDir))

  useEffect(() => {
    let cancelled = false
    setDraft(null); setEntries({}); setError(''); setNotice(''); setAssistantMessage(''); setRunAnalysis('')
    if (!workspaceDir || !validWorkspace || !selectedSatelliteId) return () => { cancelled = true }
    setBusy(true)
    void listChemicalHohmannDrafts(workspaceDir)
      .then(drafts => drafts[0] ?? createChemicalHohmannDraft(workspaceDir))
      .then(next => { if (!cancelled) { setDraft(next); setEntries(Object.fromEntries([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map(field => [field.path, fieldValue(next, field.path)]))) } })
      .catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to create the Hohmann mission draft') })
      .finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [selectedSatelliteId, validWorkspace, workspaceDir])

  useEffect(() => {
    let cancelled = false
    if (!workspaceDir || !validWorkspace) return () => { cancelled = true }
    void Promise.all([getSelectedSatellite(workspaceDir), listSimuCicGroundStations()]).then(([thread, stations]) => {
      if (cancelled) return
      const configuration = thread.document.analysis_requests?.simu_cic
      setSimuCic(configuration?.attitude_mode === 'ground_station_tracking' ? configuration : { attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null })
      setGroundStations(stations)
    }).catch(() => { if (!cancelled) setGroundStations([]) })
    return () => { cancelled = true }
  }, [validWorkspace, workspaceDir])

  const updateGroundStation = (stationId: string) => {
    if (!workspaceDir || busy) return
    const next: SimuCicConfiguration = stationId
      ? { attitude_mode: 'ground_station_tracking', ground_station_ids: [stationId], simultaneous_visibility_policy: 'first_visible_station_wins' }
      : { attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null }
    const previous = simuCic
    setSimuCic(next)
    void saveSimuCicConfiguration(next, workspaceDir).then(() => onSimuCicConfigurationChanged?.()).catch(reason => {
      setSimuCic(previous)
      setError(reason instanceof Error ? reason.message : 'Unable to save the Simu-CIC configuration')
    })
  }

  const saveField = async (field: Field) => {
    if (!workspaceDir || !draft || busy) return
    const displayedValue = (entries[field.path] ?? '').trim()
    if (!displayedValue) return
    const altitudeField = field.path === 'initialOrbit.smaKm' || field.path === 'transfer.targetRadiusKm'
    const altitude = Number(displayedValue)
    if (altitudeField && (!Number.isFinite(altitude) || altitude < 0)) { setError(`${field.label} must be a non-negative number in km.`); return }
    const value = altitudeField ? String(altitude + EARTH_EQUATORIAL_RADIUS_KM) : displayedValue
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await updateMissionValue<ChemicalHohmannDraft>({ draftId: draft.draftId, path: field.path, template: 'chemical-hohmann-transfer', value, workspaceDir })
      setDraft(next); setEntries(current => ({ ...current, [field.path]: fieldValue(next, field.path) })); onChanged?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save mission value') } finally { setBusy(false) }
  }
  const confirmAndRun = async () => {
    if (!workspaceDir || !draft || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const confirmed = await confirmChemicalHohmannDraft(draft.draftId, workspaceDir)
      setDraft(confirmed)
      const result = await executeChemicalHohmannDraft(confirmed.draftId, workspaceDir)
      if (result.result.status === 'completed') setNotice(`GMAT ${result.runId} completed. The script, values, log, manifest, result and satellite.json are available in this mission run.`)
      else setError(`GMAT ${result.result.status}: ${result.result.error ?? 'Review gmat.log in this mission run.'}`)
      // A generated script is a valid GMAT-GUI artifact even when console
      // execution later fails (for example while validating an OEM writer).
      // Promote it to the active run in every case, so the Workflow panel can
      // open and inspect exactly this run rather than leaving the user stuck.
      onRunExecuted?.(result)
      onChanged?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to run GMAT') } finally { setBusy(false) }
  }
  const askAssistant = async () => {
    const message = assistantMessage.trim()
    if (!workspaceDir || !draft || !message || busy) return
    setBusy(true); setError('')
    try {
      if (activeRunId) {
        const result = await askMissionAssistant({ draftId: draft.draftId, message, runPath: workspaceDir, workspaceDir })
        if (!('answer' in result)) throw new Error('The assistant returned a mission revision instead of a result analysis')
        setRunAnalysis(result.answer)
        setAssistantMessage('')
        return
      }
      const next = await discussChemicalHohmannDraft(draft.draftId, message, workspaceDir)
      setDraft(next)
      setEntries(Object.fromEntries([...REQUIRED_FIELDS, ...OPTIONAL_FIELDS].map(field => [field.path, fieldValue(next, field.path)])))
      setAssistantMessage(''); onChanged?.()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to ask the mission assistant') } finally { setBusy(false) }
  }
  const missingLabels = REQUIRED_FIELDS.filter(field => draft?.missing.includes(field.path)).map(field => field.label)

  const input = (field: Field) => <input
    aria-label={`Enter ${field.label}`}
    className="gmat-mission-required-input"
    disabled={busy || !draft}
    key={field.path}
    onBlur={() => { void saveField(field) }}
    onChange={event => setEntries(current => ({ ...current, [field.path]: event.target.value }))}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void saveField(field) } }}
    placeholder={field.placeholder}
    value={entries[field.path] ?? ''}
  />

  return <section className="gmat-mission-chat chemical-hohmann-chat" aria-label="Chemical Hohmann transfer inputs">
    <div className="gmat-mission-chat-tabs"><span>General</span></div>
    <div className="gmat-mission-chat-layout">
      <aside className="gmat-mission-chat-sidebar">
        <section><header><strong>Required before GMAT can run</strong><span>{busy ? 'Saving…' : draft?.missing.length ? `${missingLabels.length} remaining` : draft ? 'Complete' : 'Waiting'}</span></header>
          {validWorkspace && selectedSatelliteId ? <ul>{REQUIRED_FIELDS.map(field => <li className={draft?.missing.includes(field.path) ? 'is-missing' : ''} key={field.path}><span>{field.label}{field.unit ? ` (${field.unit})` : ''}</span>{input(field)}</li>)}</ul> : <p className="gmat-mission-run-blocker">Choose a compatible chemical-propulsion satellite to unlock these values.</p>}
        </section>
        {validWorkspace && selectedSatelliteId ? <section><header><strong>Assumed defaults to confirm</strong><span>Template defaults</span></header><ul>
          {OPTIONAL_FIELDS.map(field => <li key={field.path}><span>{field.label}{field.unit ? ` (${field.unit})` : ''}</span>{input(field)}</li>)}
          <li><span>Vehicle properties</span><b>From satellite.json</b></li>
        </ul></section> : null}
        {validWorkspace && selectedSatelliteId ? <section><header><strong>Simu-CIC attitude</strong><span>{simuCic.attitude_mode === 'ground_station_tracking' ? 'Station tracking' : 'Nadir default'}</span></header><label className="gmat-mission-ground-station-picker" htmlFor="chemical-simu-cic-ground-station">Attitude target<select disabled={busy} id="chemical-simu-cic-ground-station" onChange={event => updateGroundStation(event.target.value)} value={simuCic.attitude_mode === 'ground_station_tracking' ? simuCic.ground_station_ids[0] ?? '' : ''}><option value="">Nadir pointing (default)</option>{groundStations.filter(station => RF_COMLINK_GROUND_STATION_IDS.has(station.id)).map(station => <option key={station.id} value={station.id}>{station.name} ({station.id})</option>)}</select></label></section> : null}
        <button className="gmat-mission-run-button" disabled={busy || !draft || draft.missing.length > 0} onClick={() => { void confirmAndRun() }} type="button">{busy ? 'Running GMAT…' : 'Confirm and run GMAT'}</button>
        {activeRunId ? <><button className="gmat-mission-run-button" disabled={simuCicRunning} onClick={onRunSimuCic} type="button">{simuCicRunning ? 'Running Simu-CIC…' : 'Run Simu-CIC'}</button><button className="gmat-mission-run-button" disabled={!simuCicCompleted || simuCicRunning} onClick={onRunOpalis} type="button">Run OPALIS</button><button className="gmat-mission-run-button" disabled={!simuCicCompleted || simuCicRunning || rfComlinkPreparing || rfComlinkCalculationStarting} onClick={onRunRfComlink} type="button">{rfComlinkPreparing || rfComlinkCalculationStarting ? 'Starting RF-COMLINK…' : 'Run RF-COMLINK'}</button><button className="gmat-mission-run-button" disabled={!rfComlinkPrepared || rfComlinkResultsSaving || rfComlinkCalculationStarting} onClick={onSaveRfComlinkResults} type="button">{rfComlinkResultsSaving ? 'Saving RF-COMLINK results…' : 'Save RF-COMLINK results'}</button><button type="button" onClick={onNewRun}>Start separate GMAT mission</button></> : null}
      </aside>
      <section className="gmat-mission-chat-thread">
        <header><strong>Mission discussion</strong><span>Deterministic template</span></header>
        <div className="gmat-mission-chat-history">
          {error ? <p className="chemical-hohmann-message is-error">{error}</p> : null}
          {notice ? <p className="chemical-hohmann-message">{notice}</p> : null}
          {!validWorkspace || !selectedSatelliteId ? <p className="gmat-mission-chat-placeholder">Select the Chemical Hohmann transfer template, then select the compatible chemical-propulsion satellite. A new dated mission run is created for this discussion.</p> : <>{activeRunId ? <p className="gmat-mission-chat-placeholder">Ask about the saved GMAT, Simu-CIC, OPALIS, or RF-COMLINK result for this run.</p> : <><p className="gmat-mission-chat-placeholder">Enter the initial Keplerian orbit and target altitude above Earth’s surface. The application converts these values to the Cartesian state required by the fixed GMAT tutorial, while satellite-owned values remain in satellite.json.</p><div className="chemical-hohmann-guidance"><strong>Assistant role</strong><p>The LLM can fill these exact same values from a natural-language message. It cannot modify satellite-owned values or the fixed GMAT algorithm.</p></div></>}{activeRunId ? conversation.map((turn, index) => <div className="chemical-hohmann-turn" key={`${turn.askedAt}-${index}`}><div className="is-user"><span>You</span>{turn.question}</div><div className="is-assistant"><span>Mission workflow</span>{turn.answer}</div></div>) : draft?.conversation.map((turn, index) => <div className="chemical-hohmann-turn" key={`${turn.user}-${index}`}><div className="is-user"><span>You</span>{turn.user}</div><div className="is-assistant"><span>GMAT assistant</span>{turn.assistant}</div></div>)}{runAnalysis ? <div className="chemical-hohmann-turn"><div className="is-assistant"><span>Mission assistant</span>{runAnalysis}</div></div> : null}</>}
        </div>
        <div className="gmat-mission-composer"><textarea disabled={busy || !draft} onChange={event => setAssistantMessage(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void askAssistant() } }} placeholder={activeRunId ? 'Ask about the saved results for this run...' : 'Describe the Hohmann-transfer mission values; the assistant can fill the form...'} rows={3} value={assistantMessage} /><button disabled={busy || !draft || !assistantMessage.trim()} onClick={() => { void askAssistant() }} type="button">Send</button></div>
      </section>
    </div>
  </section>
}
