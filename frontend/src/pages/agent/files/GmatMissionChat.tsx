import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { MarkdownText } from '../../../components/outputMarkdown'
import type { AgentChatMode } from '../AgentRecorderControl'
import { getSelectedSatellite, listSimuCicGroundStations, saveSimuCicConfiguration, type PredefinedGroundStation, type SimuCicConfiguration } from '../satelliteLibraryApi'
import { missionTemplateDefinition, missionTemplateForChatMode, type MissionInputField } from '../gmatMissionTemplates'

type Draft = {
  assistantMessage?: string
  confirmed: boolean
  conversation?: Array<{ assistant: string; user: string }>
  draftId: string
  missing: string[]
  safety: { assumptions: Array<{ label: string; value: string }>; checks: Array<{ code: string; message: string; severity: 'error' | 'warning' }> }
  status: 'blocked' | 'collecting' | 'ready' | 'confirmed'
  updatedAt?: string
  values: Record<string, string | number | null>
  runs?: Array<{ completedAt: string; missionValues?: Record<string, string | number | null>; result: { finalAltitudeKm?: number; finalFuelMassKg?: number; finalRadiusKm?: number; status: string }; runId: string; runPath: string }>
} | null

type Assumption = { label: string; value: string }
const EARTH_EQUATORIAL_RADIUS_KM = 6378.1363
const RF_COMLINK_GROUND_STATION_IDS = ['kiruna', 'kourou', 'inuvik', 'aussaguel'] as const

function valueAt(document: Record<string, unknown>, path: string): string | number | null {
  let value: unknown = document
  for (const key of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    value = (value as Record<string, unknown>)[key]
  }
  return typeof value === 'string' || typeof value === 'number' ? value : null
}

function displayValue(document: Record<string, unknown>, path: string, unit = '') {
  const value = valueAt(document, path)
  return value === null ? null : `${value}${unit ? ` ${unit}` : ''}`
}

/** Run-scoped vehicle parameters. The displayed document is the current
 * satellite.json, never the immutable library record. */
function editableSatelliteAssumptions(document: Record<string, unknown>, mode: AgentChatMode): Assumption[] {
  const fields: Array<[string, string, string?]> = [
    ['Dry mass', 'satellite.bus.physical.mass_kg.dry', 'kg'],
    ['Drag area', 'satellite.bus.physical.drag_area_m2', 'm²'],
    ['Drag coefficient', 'satellite.bus.physical.drag_coefficient'],
    ['Specific impulse', 'satellite.bus.propulsion_subsystem.specific_impulse_seconds', 's'],
    ['Solar-array area', 'satellite.bus.electrical_subsystem.solar_panels.total_area_m2', 'm²'],
    ['Solar-array efficiency', 'satellite.bus.electrical_subsystem.solar_panels.efficiency_percent', '%'],
    ['OPALIS power-consumption mode', 'satellite.bus.opalis.power_distribution.consumption_mode'],
    ['OPALIS constant consumption', 'satellite.bus.opalis.power_distribution.constant_load_w', 'W'],
    ['OPALIS power margin', 'satellite.bus.opalis.power_distribution.margin_w', 'W'],
  ]
  if (mode === 'gmat-electric-propulsion') fields.splice(4, 0,
    ['Electric propellant', 'satellite.bus.propulsion_subsystem.electric_thruster.propellant_mass_kg', 'kg'],
    ['Minimum usable thruster power', 'satellite.bus.propulsion_subsystem.electric_thruster.minimum_usable_power_kw', 'kW'],
    ['Maximum usable thruster power', 'satellite.bus.propulsion_subsystem.electric_thruster.maximum_usable_power_kw', 'kW'],
    ['Solar-array rated power', 'satellite.bus.electrical_subsystem.solar_panels.total_power_generated_watts', 'W'],
    ['Electric-propulsion bus load', 'satellite.bus.electrical_subsystem.electric_propulsion_mode.bus_load_kw', 'kW'],
    ['Power-system margin', 'satellite.bus.electrical_subsystem.system_margin_percent', '%'],
  )
  return fields.flatMap(([label, path, unit]) => {
    const value = displayValue(document, path, unit)
    return value === null ? [] : [{ label, value }]
  })
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
  } else if (mode === 'gmat-orbit-keeping') {
    values['spacecraft.initialFuelMassKg'] = valueAt(document, 'analysis_requests.gmat.orbit_keeping.initial_fuel_mass_kg')
    values['stationKeeping.minimumAltitudeKm'] = valueAt(document, 'analysis_requests.gmat.orbit_keeping.minimum_reboost_altitude_km')
  } else if (mode === 'gmat-chemical-hohmann') {
    values['transfer.targetRadiusKm'] = valueAt(document, 'analysis_requests.gmat.chemical_hohmann_transfer.target_orbit.radius_km')
    values['transfer.targetEccentricity'] = valueAt(document, 'analysis_requests.gmat.chemical_hohmann_transfer.target_orbit.eccentricity')
    values['transfer.finalPropagationSeconds'] = valueAt(document, 'analysis_requests.gmat.chemical_hohmann_transfer.final_propagation_seconds')
  }
  return values
}

function verifyRunValuesAgainstAdapter(values: Record<string, string | number | null>, adapter: Record<string, string | number | null> | undefined) {
  if (!adapter) return 'Verified directly from satellite.json'
  const mismatches = Object.keys(values).filter(key => values[key] !== null && adapter[key] !== undefined && String(values[key]) !== String(adapter[key]))
  return mismatches.length ? `Verification warning: ${mismatches.join(', ')} differs from the GMAT adapter; satellite.json is displayed.` : 'Verified against satellite.json'
}

function MissionValueField({ busy, field, onSubmit, value }: { busy: boolean; field: MissionInputField; onSubmit: (path: string, value: string) => void; value: string | number | null }) {
  const displayValue = field.valueTransform === 'earth-radius' && typeof value === 'number'
    ? Number((value - EARTH_EQUATORIAL_RADIUS_KM).toFixed(6))
    : value
  const savedValue = displayValue === null ? '' : String(displayValue)
  const [entry, setEntry] = useState(savedValue)
  useEffect(() => { setEntry(savedValue) }, [savedValue])
  const submit = () => {
    const nextValue = entry.trim()
    if (!nextValue || busy || nextValue === savedValue) return
    const storedValue = field.valueTransform === 'earth-radius' ? Number(nextValue) + EARTH_EQUATORIAL_RADIUS_KM : nextValue
    if (typeof storedValue === 'number' && !Number.isFinite(storedValue)) return
    onSubmit(field.path, String(storedValue))
  }
  return <input
    aria-label={`Enter ${field.label}`}
    className="gmat-mission-required-input"
    disabled={busy}
    onBlur={submit}
    onChange={event => setEntry(event.target.value)}
    onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); submit() } }}
    placeholder={field.unit ? `Enter ${field.unit}` : 'Enter value'}
    value={entry}
  />
}

const MEMORY_FIELDS: Array<[string, string, string?]> = [
  ['SMA', 'initialOrbit.smaKm', 'km'], ['ECC', 'initialOrbit.eccentricity'], ['INC', 'initialOrbit.inclinationDeg', 'deg'],
  ['Fuel', 'spacecraft.initialFuelMassKg', 'kg'], ['Burn', 'transfer.burnDurationDays', 'days'], ['Reboost', 'stationKeeping.minimumAltitudeKm', 'km'],
]

const COMPARISON_LABELS: Record<string, string> = {
  'initialOrbit.epoch': 'Epoch', 'initialOrbit.smaKm': 'SMA', 'initialOrbit.eccentricity': 'ECC', 'initialOrbit.inclinationDeg': 'INC',
  'initialOrbit.raanDeg': 'RAAN', 'initialOrbit.argPeriapsisDeg': 'AOP', 'initialOrbit.trueAnomalyDeg': 'TA',
  'spacecraft.dryMassKg': 'Dry mass', 'spacecraft.initialFuelMassKg': 'Fuel', 'spacecraft.dragAreaM2': 'Drag area',
  'spacecraft.dragCoefficient': 'Drag coefficient', 'propulsion.ispSeconds': 'Isp', 'transfer.burnDurationDays': 'Burn',
  'stationKeeping.minimumAltitudeKm': 'Reboost altitude', 'stationKeeping.targetSmaKm': 'Target SMA',
  'stationKeeping.fuelReserveKg': 'Fuel reserve', 'endOfLife.finalAltitudeKm': 'End altitude',
  'propulsion.maximumUsablePowerKw': 'Maximum power', 'propulsion.minimumUsablePowerKw': 'Minimum power',
  'power.initialMaxPowerKw': 'Solar power', 'power.busLoadKw': 'Bus load', 'power.systemMarginPercent': 'Power margin',
}

function RunComparisonMemory({ runs }: { runs: NonNullable<Draft>['runs'] }) {
  const ordered = [...(runs ?? [])].sort((left, right) => right.completedAt.localeCompare(left.completedAt))
  const inputs = (run: typeof ordered[number]) => MEMORY_FIELDS.flatMap(([label, path, unit]) => {
    const value = run.missionValues?.[path]
    return value === null || value === undefined ? [] : [`${label} ${value}${unit ? ` ${unit}` : ''}`]
  })
  const changedFrom = (run: typeof ordered[number], previous: typeof ordered[number] | undefined) => !previous?.missionValues || !run.missionValues
    ? []
    : Array.from(new Set([...Object.keys(run.missionValues), ...Object.keys(previous.missionValues)])).sort()
      .filter(path => run.missionValues?.[path] !== previous.missionValues?.[path])
      .map(path => COMPARISON_LABELS[path] ?? path)
  return <section className="gmat-run-comparison-memory">
    <header><strong>Run comparison memory</strong><span>{ordered.length} saved</span></header>
    <p>Each result keeps the exact mission values used for it.</p>
    <ul>{ordered.map((run, index) => {
      const prior = ordered[index + 1]
      const result = run.result
      const metrics = [
        result.finalAltitudeKm !== undefined ? `Final altitude ${result.finalAltitudeKm.toFixed(2)} km` : result.finalRadiusKm !== undefined ? `Final radius ${result.finalRadiusKm.toFixed(2)} km` : null,
        result.finalFuelMassKg !== undefined ? `Final fuel ${result.finalFuelMassKg.toFixed(3)} kg` : null,
      ].filter(Boolean)
      const changed = changedFrom(run, prior)
      return <li key={run.runId}><div><strong>{run.runId}</strong><b className={`is-${result.status}`}>{result.status}</b></div><small>{inputs(run).join(' | ') || 'Legacy run: input snapshot unavailable'}</small>{metrics.length ? <small>{metrics.join(' | ')}</small> : null}{changed.length ? <small>Changed vs previous: {changed.slice(0, 6).join(', ')}{changed.length > 6 ? ` +${changed.length - 6} more` : ''}</small> : null}</li>
    })}</ul>
  </section>
}

export type GmatMissionChatProps = {
  activeRunId?: string
  chatMode: AgentChatMode
  /** Mission Studio inserts its template and satellite selectors directly
   * below the General heading, before mission-specific values. */
  contextContent?: ReactNode
  conversation?: Array<{ answer: string; askedAt: string; question: string }>
  draft: Draft
  error: string
  gmatRunFailed?: boolean
  busy: boolean
  pending?: { error?: string; kind: 'draft' | 'run'; message: string; status: 'sending' | 'failed' } | null
  onExecute: () => void
  /** Creates the dated mission folder when the engineer configures a
   * downstream tool before the first GMAT execution. */
  onEnsureMissionRun?: () => Promise<string>
  onMissionValuesChangeRequested?: () => void
  onNewRun: () => void
  onRunSimuCic?: () => void
  onSimuCicConfigurationChanged?: () => void
  onRunOpalis?: () => void
  onSaveRfComlinkResults?: () => void
  onOpenRfComlinkGui?: () => void
  onPrepareRfComlink?: () => void
  onStopCalculations?: () => void
  onRetry: () => void
  onSend: (message: string, mode: AgentChatMode) => void
  onUpdateMissionValue?: (path: string, value: string) => void
  simuCicConversation?: Array<{ answer: string; askedAt: string; question: string }>
  simuCicCompleted?: boolean
  simuCicRefreshNonce?: number
  simuCicRunning?: boolean
  rfComlinkPreparing?: boolean
  rfComlinkPrepared?: boolean
  rfComlinkCalculationStarting?: boolean
  rfComlinkResultsSaving?: boolean
  workspaceDir?: string | null
}

export function GmatMissionChat({ activeRunId, busy, chatMode, contextContent, conversation = [], draft, error, gmatRunFailed = false, onEnsureMissionRun, onExecute, onMissionValuesChangeRequested, onNewRun, onRunSimuCic, onRunOpalis, onPrepareRfComlink, onSaveRfComlinkResults, onOpenRfComlinkGui, onStopCalculations, onRetry, onSend, onUpdateMissionValue, onSimuCicConfigurationChanged, pending, simuCicConversation = [], simuCicCompleted = false, simuCicRefreshNonce = 0, simuCicRunning = false, rfComlinkPreparing = false, rfComlinkPrepared = false, rfComlinkCalculationStarting = false, rfComlinkResultsSaving = false, workspaceDir }: GmatMissionChatProps) {
  const [message, setMessage] = useState('')
  const [editingRunValues, setEditingRunValues] = useState(false)
  const [simuCic, setSimuCic] = useState<SimuCicConfiguration>({ attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null })
  const [groundStations, setGroundStations] = useState<PredefinedGroundStation[]>([])
  const [simuCicConfigurationError, setSimuCicConfigurationError] = useState('')
  const [savedRunValues, setSavedRunValues] = useState<Record<string, string | number | null> | null>(null)
  const [runValuesVerification, setRunValuesVerification] = useState('')
  const [satelliteAssumptions, setSatelliteAssumptions] = useState<Assumption[]>([])
  const isRunScopedWorkspace = /[\\/]gmat[\\/]mission-runs[\\/][^\\/]+$/u.test(workspaceDir ?? '')
  useEffect(() => { setEditingRunValues(false) }, [activeRunId])
  useEffect(() => {
    let cancelled = false
    void listSimuCicGroundStations().then(stations => { if (!cancelled) setGroundStations(stations) }).catch(() => { if (!cancelled) setGroundStations([]) })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    let cancelled = false
    // Do not render an attitude law from the previously selected draft/run
    // while the next run's satellite.json is loading. That brief stale state
    // made e.g. "Bremen" appear although the new run and Simu-CIC calculation
    // both use the default nadir law.
    setSimuCic({ attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null })
    // A first message is sent while Mission Studio is switching from the
    // global workspace to a new dated planning run. The global workspace may
    // legitimately contain a station choice from a previous conversation,
    // but it is not the source of truth for this new discussion. Do not read
    // it even transiently: Nadir is the only safe default until the dated
    // satellite.json exists and is selected below.
    if (!activeRunId && !isRunScopedWorkspace) {
      setSavedRunValues(null)
      setRunValuesVerification('')
      setSatelliteAssumptions([])
      return () => { cancelled = true }
    }
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
        setSatelliteAssumptions(editableSatelliteAssumptions(result.document, chatMode))
      })
      .catch(() => { if (!cancelled) { setSimuCic({ attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null }); setSavedRunValues(null); setRunValuesVerification('Unable to verify satellite.json'); setSatelliteAssumptions([]) } })
    return () => { cancelled = true }
  }, [workspaceDir, isRunScopedWorkspace, draft?.draftId, draft?.status, draft?.updatedAt, activeRunId, chatMode, simuCicRefreshNonce])
  const template = chatMode === 'general' ? null : missionTemplateForChatMode(chatMode)
  const fields = (template ? missionTemplateDefinition(template).inputFields : [])
    .filter(field => field.path === 'spacecraft.initialFuelMassKg' || (!field.path.startsWith('spacecraft.') && !field.path.startsWith('propulsion.') && !field.path.startsWith('power.')))
  // A selected template exposes its required inputs immediately. The first
  // filled field creates/updates the draft through the normal LLM workflow.
  const templateSelected = !activeRunId && chatMode !== 'general'
  // satellite.json is authoritative for values it actually contains. Mission
  // fields absent from that snapshot must keep the saved draft value instead
  // of turning into a misleading "Not provided" after a page reload.
  const savedRunMissionValues = Object.fromEntries(Object.entries(savedRunValues ?? {}).filter(([, value]) => value !== null))
  const displayedValues = activeRunId && !editingRunValues
    ? { ...(draft?.values ?? {}), ...savedRunMissionValues }
    : draft?.values ?? (templateSelected ? {} : null)
  const showMissionInputs = Boolean(draft || (activeRunId && displayedValues) || templateSelected)
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
  const updateGroundStation = (stationId: string) => {
    if (busy) return
    const next: SimuCicConfiguration = stationId
      ? { attitude_mode: 'ground_station_tracking', ground_station_ids: [stationId], simultaneous_visibility_policy: 'first_visible_station_wins' }
      : { attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null }
    const previous = simuCic
    setSimuCic(next)
    setSimuCicConfigurationError('')
    const runWorkspace = isRunScopedWorkspace && workspaceDir
      ? Promise.resolve(workspaceDir)
      : onEnsureMissionRun
        ? onEnsureMissionRun()
        : Promise.reject(new Error('Start a dated mission discussion before configuring Simu-CIC.'))
    void runWorkspace.then(runWorkspaceDir => saveSimuCicConfiguration(next, runWorkspaceDir))
      .then(result => {
        const saved = result.document.analysis_requests?.simu_cic
        setSimuCic(saved?.attitude_mode === 'ground_station_tracking' ? saved : { attitude_mode: 'nadir_pointing', ground_station_ids: [], simultaneous_visibility_policy: null })
        onSimuCicConfigurationChanged?.()
      })
      .catch(reason => {
        setSimuCic(previous)
        setSimuCicConfigurationError(reason instanceof Error ? reason.message : 'Unable to save the Simu-CIC configuration.')
      })
  }
  const runConversation = [
    ...(draft?.conversation ?? []).map(turn => ({ answer: turn.assistant, askedAt: '', question: turn.user })),
    ...conversation,
  ].filter((turn, index, turns) => turns.findIndex(candidate => candidate.question === turn.question && candidate.answer === turn.answer) === index)
  const draftConversation = [
    ...(draft?.conversation ?? []).map(turn => ({ answer: turn.assistant, askedAt: '', question: turn.user })),
  ].filter((turn, index, turns) => turns.findIndex(candidate => candidate.question === turn.question && candidate.answer === turn.answer) === index)

  return (
    <section className={`gmat-mission-chat ${contextContent ? 'has-mission-context' : ''}`} aria-label="GMAT mission conversation">
      <div className="gmat-mission-chat-tabs" aria-label="Conversation channel"><span>General</span></div>
      {contextContent ? <div className="gmat-mission-context">{contextContent}</div> : null}
      <div className="gmat-mission-chat-layout">
          <aside className="gmat-mission-chat-sidebar">
            {activeRunId ? <><strong>Run values</strong><span>{activeRunId}</span></> : null}
            {showMissionInputs ? <>
              <section><header><strong>{activeRunId ? 'Saved GMAT mission values' : 'Required before GMAT can run'}</strong><span>{missing.length ? `${missing.length} remaining` : 'Complete'}</span></header>{activeRunId ? <p className="gmat-mission-source-verification">{editingRunValues ? 'Editing a value creates a new variation and preserves this run.' : runValuesVerification}</p> : null}<ul>
                {fields.map(field => {
                  const semiMajorAxis = displayedValues?.['initialOrbit.smaKm']
                  const semiMajorAxisKm = typeof semiMajorAxis === 'number'
                    ? semiMajorAxis
                    : typeof semiMajorAxis === 'string' && Number.isFinite(Number(semiMajorAxis)) ? Number(semiMajorAxis) : null
                  const derivedAltitude = field.derived === 'initialAltitude' && semiMajorAxisKm !== null
                    ? Number((semiMajorAxisKm - EARTH_EQUATORIAL_RADIUS_KM).toFixed(3))
                    : null
                  const rawValue = field.derived ? derivedAltitude : displayedValues?.[field.path]
                  const numericRawValue = typeof rawValue === 'number'
                    ? rawValue
                    : typeof rawValue === 'string' && Number.isFinite(Number(rawValue)) ? Number(rawValue) : null
                  const value = field.valueTransform === 'earth-radius' && numericRawValue !== null
                    ? Number((numericRawValue - EARTH_EQUATORIAL_RADIUS_KM).toFixed(6))
                    : rawValue
                  const absent = field.derived ? derivedAltitude === null : value === null || value === undefined || value === ''
                  return <li className={absent ? 'is-missing' : ''} key={field.derived ?? field.path}><span>{field.label}</span>{(!activeRunId || editingRunValues) && onUpdateMissionValue ? <MissionValueField busy={busy} field={field} onSubmit={onUpdateMissionValue} value={typeof rawValue === 'string' || typeof rawValue === 'number' ? rawValue : null} /> : <b>{absent ? 'Not provided' : `${value}${field.unit ? ` ${field.unit}` : ''}`}</b>}</li>
                })}
              </ul></section>
              {draft || activeRunId || templateSelected ? <section><header><strong>Required before Simu-CIC can run</strong><span>{simuCicComplete ? 'Complete' : simuCicNeedsStations ? 'Station required' : 'Attitude law required'}</span></header><ul>
                <li><span>Attitude behavior</span><b>{simuCic.attitude_mode === 'nadir_pointing' ? 'Nadir pointing' : simuCic.attitude_mode === 'ground_station_tracking' ? 'Track ground station(s)' : 'Nadir pointing'}</b></li>
                {simuCic.attitude_mode === 'ground_station_tracking' ? <li className={simuCicNeedsStations ? 'is-missing' : ''}><span>Ground stations</span><b>{simuCic.ground_station_ids.length ? simuCic.ground_station_ids.join(', ') : 'Not provided'}</b></li> : null}
                <li className="gmat-mission-ground-station-picker"><label htmlFor="simu-cic-ground-station">Attitude target</label><select disabled={busy || simuCicRunning} id="simu-cic-ground-station" onChange={event => updateGroundStation(event.target.value)} value={simuCic.attitude_mode === 'ground_station_tracking' ? simuCic.ground_station_ids[0] ?? '' : ''}>
                  <option value="">Nadir pointing (default)</option>
                  {RF_COMLINK_GROUND_STATION_IDS.flatMap(id => groundStations.filter(station => station.id === id)).map(station => <option key={station.id} value={station.id}>{station.name} ({station.id})</option>)}
                </select></li>
              </ul>{simuCicConfigurationError ? <p className="gmat-mission-run-blocker">{simuCicConfigurationError}</p> : <p className="gmat-mission-simucic-hint">Choose nadir pointing or a predefined station. You can still ask the assistant for guidance or configure several stations in writing.</p>}</section> : null}
              {draft ? <><details className="gmat-mission-assumptions"><summary><strong>Assumed defaults to confirm</strong><span>Template defaults and satellite values</span></summary><ul className="assumptions">{(draft.safety?.assumptions ?? []).map(item => <li key={item.label}>{item.label}: {item.value}</li>)}{satelliteAssumptions.map(item => <li key={`satellite-${item.label}`}>{item.label}: {item.value}</li>)}</ul></details>
              {draft.runs?.length ? <RunComparisonMemory runs={draft.runs} /> : null}
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
            {activeRunId && !editingRunValues ? <button className="gmat-mission-run-button" disabled={busy} type="button" onClick={() => { setEditingRunValues(true); onMissionValuesChangeRequested?.() }}>Change mission values</button> : null}
            {activeRunId && gmatRunFailed ? <><p className="gmat-mission-run-blocker">GMAT failed. Edit the mission values, then run GMAT again before continuing to Simu-CIC or OPALIS.</p><button className="gmat-mission-run-button" disabled={busy || !draft} type="button" onClick={onExecute}>Retry unchanged values</button></> : null}
            {activeRunId && !gmatRunFailed && onRunSimuCic ? <button className="gmat-mission-run-button" disabled={simuCicRunning} type="button" onClick={onRunSimuCic}>{simuCicRunning ? 'Running Simu-CIC…' : 'Run Simu-CIC'}</button> : null}
            {activeRunId && !gmatRunFailed && onRunOpalis ? <button className="gmat-mission-run-button" disabled={!simuCicCompleted || simuCicRunning || busy} title={simuCicCompleted ? 'Run OPALIS from the CIC files already generated for this GMAT run.' : 'Run Simu-CIC first.'} type="button" onClick={onRunOpalis}>Run OPALIS</button> : null}
            {activeRunId && !gmatRunFailed && onPrepareRfComlink ? <button className="gmat-mission-run-button" disabled={!simuCicCompleted || simuCicRunning || busy || rfComlinkPreparing || rfComlinkCalculationStarting} title={simuCicCompleted ? 'Prepare and open the run-local RF-COMLINK calculation.' : 'Run Simu-CIC first.'} type="button" onClick={onPrepareRfComlink}>{rfComlinkPreparing || rfComlinkCalculationStarting ? 'Starting RF-COMLINK…' : 'Run RF-COMLINK'}</button> : null}
            {activeRunId && !gmatRunFailed && onOpenRfComlinkGui ? <button className="gmat-mission-run-button" disabled={!rfComlinkPrepared || rfComlinkCalculationStarting} title="Open the prepared or calculated scenario in RF-COMLINK." type="button" onClick={onOpenRfComlinkGui}>Open RF-COMLINK GUI</button> : null}
            {activeRunId && !gmatRunFailed && onSaveRfComlinkResults ? <button className="gmat-mission-run-button" disabled={!rfComlinkPrepared || rfComlinkResultsSaving || rfComlinkCalculationStarting} title="After calculating and saving in RF-COMLINK, archive the reports for discussion." type="button" onClick={onSaveRfComlinkResults}>{rfComlinkResultsSaving ? 'Saving RF-COMLINK results…' : 'Save RF-COMLINK results'}</button> : null}
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
              {!activeRunId && !draft && !simuCicConversation.length && !pending ? <p className="gmat-mission-chat-placeholder">Start with the template selector, choose a compatible satellite, then describe the mission. The assistant will guide you through the remaining inputs.</p> : null}
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
