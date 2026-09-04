import { useEffect, useMemo, useRef, useState } from 'react'

import { joinApiPath } from '../../app/apiBase'
import { listMissionTemplateDefinitions, type MissionTemplateDefinition } from './missionTemplateCatalogApi'
import { missionTemplateRuntime } from './missionTemplateRuntime'
import { createPlanningRun } from './planningRunApi'
import { getRunView, type RunViewArtifact, type RunView } from './runViewApi'
import { listSatelliteDefinitions, listRFComlinkGroundStations, saveSimuCicConfiguration, selectSatelliteDefinition, type RFComlinkGroundStation, type SatelliteDefinition } from './satelliteLibraryApi'
import type { GmatMissionTemplateId } from './gmatMissionTemplates'
import { MissionOverview } from './MissionOverview'
import { missionInputValue, satelliteFrequencyBands } from './missionInputValue'

type Props = { onStartMission?: () => Promise<{ workspaceDir: string }>; workspaceDir?: string | null }
const PIPELINE_STAGES = [['gmat', 'GMAT'], ['simu_cic', 'Simu-CIC'], ['opalis', 'OPALIS'], ['rf_comlink', 'RF-COMLINK']] as const
type PipelineStatus = Record<(typeof PIPELINE_STAGES)[number][0], { detail?: string; status: string }>
const initialPipeline: PipelineStatus = { gmat: { status: 'not_started' }, simu_cic: { status: 'not_started' }, opalis: { status: 'not_started' }, rf_comlink: { status: 'not_started' } }

function numberAt(source: Record<string, unknown>, path: string) { return path.split('.').reduce<unknown>((value, key) => value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : null, source) }
function firstValue(source: Record<string, unknown>, ...paths: string[]) { return paths.map(path => numberAt(source, path)).find(value => value !== null && value !== undefined) ?? '—' }
function runPathForWorkspace(workspace: string) {
  const normalized = workspace.replaceAll('\\', '/')
  const marker = '/data/user/default/'
  const index = normalized.indexOf(marker)
  return index >= 0 ? normalized.slice(index + marker.length) : normalized
}

export function MissionV2({ onStartMission, workspaceDir }: Props) {
  const restored = useRef(false)
  const [satellites, setSatellites] = useState<SatelliteDefinition[]>([])
  const [templates, setTemplates] = useState<MissionTemplateDefinition[]>([])
  const [stations, setStations] = useState<RFComlinkGroundStation[]>([])
  const [satelliteId, setSatelliteId] = useState('')
  const [templateId, setTemplateId] = useState<GmatMissionTemplateId | ''>('')
  const [stationId, setStationId] = useState('')
  const [activeWorkspace, setActiveWorkspace] = useState(workspaceDir ?? '')
  const [draftId, setDraftId] = useState('')
  const [values, setValues] = useState<Record<string, string | number | null>>({})
  const [running, setRunning] = useState(false)
  const [scriptReady, setScriptReady] = useState(false)
  const [pipeline, setPipeline] = useState<PipelineStatus>(initialPipeline)
  const [runPath, setRunPath] = useState('')
  const [artifacts, setArtifacts] = useState<RunViewArtifact[]>([])
  const [overview, setOverview] = useState<RunView['overview'] | null>(null)
  const [message, setMessage] = useState('Choose a satellite to begin.')

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('mission-v2-state-v2')
      if (saved) {
        const state = JSON.parse(saved) as Partial<{ satelliteId: string; templateId: GmatMissionTemplateId; stationId: string; activeWorkspace: string; draftId: string; values: Record<string, string | number | null>; runPath: string }>
        if (state.satelliteId) setSatelliteId(state.satelliteId)
        if (state.templateId) setTemplateId(state.templateId)
        if (state.stationId) setStationId(state.stationId)
        if (state.activeWorkspace) setActiveWorkspace(state.activeWorkspace)
        if (state.draftId) setDraftId(state.draftId)
        if (state.values) setValues(state.values)
        if (state.runPath) setRunPath(state.runPath)
      }
    } catch { /* a malformed browser cache must never block the page */ }
    restored.current = true
  }, [])
  useEffect(() => {
    if (!restored.current) return
    sessionStorage.setItem('mission-v2-state-v2', JSON.stringify({ satelliteId, templateId, stationId, activeWorkspace, draftId, values, runPath }))
  }, [satelliteId, templateId, stationId, activeWorkspace, draftId, values, runPath])

  useEffect(() => {
    void Promise.all([listSatelliteDefinitions(), listMissionTemplateDefinitions()])
      .then(([a, b]) => { setSatellites(a); setTemplates(b) })
      .catch(error => setMessage(error instanceof Error ? error.message : 'Unable to load mission definitions'))
    void listRFComlinkGroundStations().then(setStations)
      .catch(error => setMessage(error instanceof Error ? error.message : 'RF-COMLINK station catalogue unavailable'))
  }, [])
  useEffect(() => {
    if (templateId !== 'electrical-leo-orbit-maintenance') return
    setValues(current => ({ ...current, 'stationKeeping.missionDays': current['stationKeeping.missionDays'] ?? 3, 'stationKeeping.throttleBias': current['stationKeeping.throttleBias'] ?? 0.87, 'stationKeeping.throttleGain': current['stationKeeping.throttleGain'] ?? 0.15 }))
  }, [templateId])
  useEffect(() => {
    if (!runPath) return
    let cancelled = false
    const refresh = async () => { try { const response = await fetch(joinApiPath(undefined, '/opalis/workflow-status'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ runPath }) }); const body = await response.json() as { workflow?: { stages?: PipelineStatus } }; const view = await getRunView(runPath); if (!cancelled) { if (body.workflow?.stages) setPipeline(body.workflow.stages); setArtifacts(view.artifacts); setOverview(view.overview) } } catch { /* retain the last persisted state while polling */ } }
    void refresh(); const timer = window.setInterval(() => void refresh(), 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [runPath])
  const satellite = satellites.find(item => item.id === satelliteId)
  const available = useMemo(() => templates.filter(item => item.id !== 'chemical-3d-transfer' && (!satellite || satellite.mission_templates.includes(item.id) || (item.id === 'electrical-leo-orbit-maintenance' && satellite.mission_templates.includes('electric-propulsion-transfer')))), [satellite, templates])
  const bands = satelliteFrequencyBands(satellite?.satellite)
  const compatibleStations = stations.filter(station => bands.every(band => station.bands.includes(band)))
  useEffect(() => {
    if (stations.length && stationId && !compatibleStations.some(station => station.id === stationId)) setStationId('')
  }, [stationId, compatibleStations])
  const template = templates.find(item => item.id === templateId)
  const requiredPaths = new Set(templateId === 'electric-propulsion-transfer'
    ? ['initialOrbit.altitudeKm', 'initialOrbit.eccentricity', 'initialOrbit.inclinationDeg', 'transfer.finalAltitudeKm']
    : templateId === 'orbit-keeping' || templateId === 'electrical-leo-orbit-maintenance'
      ? ['initialOrbit.altitudeKm', 'initialOrbit.eccentricity', 'initialOrbit.inclinationDeg', 'stationKeeping.minimumAltitudeKm']
      : ['initialOrbit.altitudeKm', 'initialOrbit.eccentricity', 'initialOrbit.inclinationDeg', 'transfer.targetAltitudeKm'])
  const requiredFields = template?.ui.missionInputFields.filter(field => requiredPaths.has(field.path)) ?? []
  const optionalFields = template?.ui.missionInputFields.filter(field => !requiredPaths.has(field.path)) ?? []
  const ensureWorkspace = async () => { if (activeWorkspace) return activeWorkspace; if (!onStartMission) throw new Error('Start a mission workspace first.'); const created = await onStartMission(); setActiveWorkspace(created.workspaceDir); return created.workspaceDir }

  const chooseSatellite = async (id: string) => {
    setSatelliteId(id); setTemplateId(''); setDraftId(''); setValues({}); setScriptReady(false)
    if (!id) return
    try { const current = await ensureWorkspace(); const item = satellites.find(x => x.id === id); if (!item) return; await selectSatelliteDefinition(item.id, item.version, current); setMessage('Choose a compatible mission scenario.') } catch (error) { setMessage(error instanceof Error ? error.message : 'Satellite selection failed') }
  }
  const chooseTemplate = async (id: string) => {
    setTemplateId(id as GmatMissionTemplateId); setDraftId(''); setValues({}); setScriptReady(false)
    if (!id) return
    try { const current = await ensureWorkspace(); const selected = satellites.find(item => item.id === satelliteId); if (!selected) throw new Error('Choose a satellite before choosing a mission scenario.'); await selectSatelliteDefinition(selected.id, selected.version, current); const draft = await missionTemplateRuntime(id as GmatMissionTemplateId).create(current); const response = id === 'electrical-leo-orbit-maintenance' ? await fetch(joinApiPath(undefined, `/gmat/templates/${id}/drafts/${draft.draftId}/values`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir: current, path: 'transfer.finalAltitudeKm', value: '500' }) }) : null; const saved = response?.ok ? await response.json() as { values?: Record<string, string | number | null> } : null; setDraftId(draft.draftId); setValues(id === 'electrical-leo-orbit-maintenance' ? { ...draft.values, ...(saved?.values ?? {}), 'stationKeeping.missionDays': 3, 'stationKeeping.throttleBias': 0.87, 'stationKeeping.throttleGain': 0.15, 'spacecraft.initialFuelMassKg': draft.values['spacecraft.initialFuelMassKg'] ?? 80 } : draft.values); setMessage('Enter the required mission values, then run the deterministic pipeline.') } catch (error) { setMessage(error instanceof Error ? error.message : 'Mission scenario setup failed') }
  }
  const update = async (path: string, value: string) => {
    if (!templateId || !draftId) return
    setScriptReady(false)
    try { const current = await ensureWorkspace(); const response = await fetch(joinApiPath(undefined, `/gmat/templates/${templateId}/drafts/${draftId}/values`), { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceDir: current, path, value }) }); const body = await response.json() as { values?: Record<string, string | number | null>; error?: string }; if (!response.ok) throw new Error(body.error ?? 'Value update failed'); setValues(body.values ?? {}); setScriptReady(false) } catch (error) { setMessage(error instanceof Error ? error.message : 'Value update failed') }
  }
  const prepareScript = async () => {
    if (!templateId || !draftId) return
    setRunning(true); setPipeline({ ...initialPipeline, gmat: { status: 'not_started', detail: 'Generating and saving the GMAT script.' } }); setMessage('Generating the GMAT script…')
    try {
      const current = await ensureWorkspace()
      const generation = await missionTemplateRuntime(templateId).prepare(draftId, current)
      const preparedRunPath = runPathForWorkspace(generation.runPath)
      const view = await getRunView(preparedRunPath)
      setRunPath(preparedRunPath); setArtifacts(view.artifacts); setOverview(view.overview); setScriptReady(true)
      setMessage('GMAT script saved in Run artifacts. GMAT will now start from this file.')
      // Give React a paint opportunity: the user sees the downloaded artifact
      // before the following request starts the external GMAT process.
      await new Promise<void>(resolve => window.setTimeout(resolve, 350))
      return true
    } catch (error) { setMessage(error instanceof Error ? error.message : 'GMAT script generation failed'); return false } finally { setRunning(false) }
  }
  const run = async () => {
    if (!scriptReady && !(await prepareScript())) return
    // Materialize the run-local script and make it available in Documents
    // before the request below starts GMAT.
    if (!templateId || !draftId || !stationId || !compatibleStations.some(station => station.id === stationId)) { setMessage('Choose a ground station and complete the mission inputs first.'); return }
    setRunning(true); setMessage('Launching GMAT from the reviewed script…')
    try { const current = await ensureWorkspace(); await saveSimuCicConfiguration({ attitude_mode: 'ground_station_tracking', ground_station_ids: [stationId] }, current); setRunPath(runPathForWorkspace(current)); const execution = await missionTemplateRuntime(templateId).runFullPipeline(draftId, current); setRunPath(execution.runPath); setMessage('Pipeline started. The workflow status is persisted while calculations run.') } catch (error) { setPipeline(current => ({ ...current, gmat: { status: 'failed', detail: error instanceof Error ? error.message : 'GMAT could not start' } })); setMessage(error instanceof Error ? error.message : 'Pipeline could not start') } finally { setRunning(false) }
  }
  const createNewRun = async () => {
    try {
      // onStartMission intentionally returns the currently active planning
      // run for ordinary form actions. The New run button must instead call
      // the creation endpoint directly, otherwise it reopens that old run.
      const created = await createPlanningRun()
      setActiveWorkspace(created.workspaceDir); setDraftId(''); setRunPath(''); setArtifacts([]); setOverview(null); setPipeline(initialPipeline); setValues({}); setSatelliteId(''); setTemplateId(''); setStationId(''); setScriptReady(false); setMessage('New run created. Choose a satellite to begin.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Failed to create a new run') }
  }
  const physical = satellite?.satellite ?? {}
  const currentRun = runPath.split('/').filter(Boolean).at(-1) ?? (draftId ? `Draft ${draftId.slice(-8)}` : 'No run selected')
  const artifactDownloadUrl = (file: RunViewArtifact) => `${joinApiPath(undefined, '/digital-thread/mission-run/download')}?${new URLSearchParams({ workspaceDir: runPath, file: file.relativePath }).toString()}`
  const artifactGroups = [
    ['GMAT scripts', (file: RunViewArtifact) => file.relativePath.endsWith('.script')],
    ['YAML parameters', (file: RunViewArtifact) => file.relativePath.endsWith('.yaml') || file.relativePath.endsWith('.yml')],
    ['JSON data', (file: RunViewArtifact) => file.relativePath.endsWith('.json')],
    ['Logs', (file: RunViewArtifact) => file.relativePath.endsWith('.log')],
    ['Simulation results', (file: RunViewArtifact) => !file.relativePath.endsWith('.script') && !file.relativePath.endsWith('.yaml') && !file.relativePath.endsWith('.yml') && !file.relativePath.endsWith('.json') && !file.relativePath.endsWith('.log')],
  ].map(([label, matches]) => ({ label: label as string, files: artifacts.filter(matches as (file: RunViewArtifact) => boolean) })).filter(group => group.files.length)
  return <div className="mission-v2-shell"><header className="mission-v2-current-run"><span>CURRENT RUN</span><strong>{currentRun}</strong><small>{pipeline.gmat.status === 'failed' || pipeline.simu_cic.status === 'failed' || pipeline.opalis.status === 'failed' || pipeline.rf_comlink.status === 'failed' ? 'Failed' : running || Object.values(pipeline).some(stage => stage.status === 'running') ? 'Running' : Object.values(pipeline).every(stage => stage.status === 'completed') ? 'Succeeded' : 'Ready'}</small><button type="button" onClick={() => void createNewRun()}>New run</button></header><div className="mission-v2-grid">
    <section className="mission-v2-left"><section className="mission-v2-card mission-v2-select"><span>STEP 1 OF 3</span><h3>Choose mission</h3><label>Satellite<select value={satelliteId} onChange={event => void chooseSatellite(event.target.value)}><option value="">Choose a satellite…</option>{satellites.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Mission scenario<select disabled={!satelliteId} value={templateId} onChange={event => void chooseTemplate(event.target.value)}><option value="">Choose a satellite first…</option>{available.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Ground station<select value={stationId} onChange={event => setStationId(event.target.value)}><option value="">Choose a ground station…</option>{compatibleStations.map(item => <option key={item.id} value={item.id}>{item.name} · {item.bands.join("/")}</option>)}</select></label><small>Stations present in RF-COMLINK for the satellite’s frequency bands. Availability does not guarantee visibility or a successful link budget.</small><small>{message}</small></section>{template ? <><section className="mission-v2-card"><span>STEP 2 OF 3</span><h3>Required mission inputs</h3><div className="mission-v2-inputs">{requiredFields.map(field => <label key={field.path}>{field.label}{field.unit ? ` (${field.unit})` : ''}<input value={missionInputValue(values, field)} placeholder={field.unit ? `Enter ${field.unit}` : 'Enter value'} onChange={event => setValues(current => ({ ...current, [field.path]: event.target.value }))} onBlur={event => void update(field.path, event.target.value)} /></label>)}</div></section><details open className="mission-v2-card mission-v2-optional"><summary>Optional mission inputs</summary><p>Pre-filled defaults. Change only if needed.</p><div className="mission-v2-inputs">{optionalFields.map(field => <label key={field.path}>{field.label}{field.unit ? ` (${field.unit})` : ''}<input value={missionInputValue(values, field)} placeholder={field.unit ? `Enter ${field.unit}` : 'Enter value'} onChange={event => setValues(current => ({ ...current, [field.path]: event.target.value }))} onBlur={event => void update(field.path, event.target.value)} /></label>)}</div></details><button className="mission-v2-run" disabled={running} type="button" onClick={() => void run()}>{running ? 'Starting calculation…' : 'Run complete mission pipeline'}</button><section className="mission-v2-card mission-v2-progress"><span>MISSION WORKFLOW</span>{PIPELINE_STAGES.map(([key, label]) => <div key={key}><b>{label}</b><strong className={`is-${pipeline[key].status}`}>{pipeline[key].status.replaceAll('_', ' ')}</strong>{pipeline[key].detail ? <small>{pipeline[key].detail}</small> : null}</div>)}</section></> : null}</section>
    <main className="mission-v2-center">{satellite ? <section className="mission-v2-card"><span>SPACECRAFT DEFINITION · {satellite.id}@{satellite.version}</span><h2>{satellite.name}</h2><p>{satellite.description}</p><div className="mission-v2-facts"><b>Dry mass<br />{String(numberAt(physical, 'bus.physical.mass_kg.dry') ?? '—')} kg</b><b>Wet mass<br />{String(numberAt(physical, 'bus.physical.mass_kg.wet_at_launch') ?? '—')} kg</b><b>Propellant capacity<br />{String(numberAt(physical, 'bus.physical.mass_kg.propellant') ?? '—')} kg</b></div><dl className="mission-v2-definition"><dt>Drag model</dt><dd>{String(numberAt(physical, 'bus.physical.drag_area_m2') ?? '—')} m² · Cd {String(numberAt(physical, 'bus.physical.drag_coefficient') ?? '—')}</dd><dt>Propulsion</dt><dd>{String(numberAt(physical, 'bus.propulsion_subsystem.type') ?? '—')}</dd><dt>Specific impulse</dt><dd>{String(numberAt(physical, 'bus.propulsion_subsystem.specific_impulse_seconds') ?? '—')} s</dd><dt>Main thrust</dt><dd>{String(firstValue(physical, 'bus.propulsion_subsystem.nominal_thrust_newtons', 'bus.propulsion_subsystem.main_engine_thrust_n'))} N</dd><dt>Solar array</dt><dd>{String(firstValue(physical, 'bus.electrical_subsystem.solar_panels.total_area_m2', 'bus.electrical_subsystem.solar_array.area_m2'))} m² · {String(firstValue(physical, 'bus.electrical_subsystem.solar_panels.total_power_generated_watts', 'bus.electrical_subsystem.solar_array.maximum_power_w'))} W</dd><dt>Battery</dt><dd>{String(firstValue(physical, 'bus.electrical_subsystem.batteries.chemistry', 'bus.electrical_subsystem.battery.technology'))} · {String(firstValue(physical, 'bus.electrical_subsystem.batteries.energy_wh', 'bus.electrical_subsystem.battery.capacity_wh'))} Wh</dd><dt>Bus load</dt><dd>{String(numberAt(physical, 'bus.electrical_subsystem.spacecraft_bus_load_kw') ?? '—')} kW</dd><dt>Reference orbit</dt><dd>SMA {String(numberAt(physical, 'orbit.keplerian_elements.semi_major_axis_km') ?? '—')} km · ECC {String(numberAt(physical, 'orbit.keplerian_elements.eccentricity') ?? '—')} · INC {String(numberAt(physical, 'orbit.keplerian_elements.inclination_deg') ?? '—')}°</dd></dl><button type="button">Download complete reference JSON</button></section> : null}</main>
    <aside className="mission-v2-results"><MissionOverview overview={overview} stages={pipeline} /><section className="mission-v2-card mission-v2-files"><span>GENERATED FILES</span><h2>Run artifacts</h2>{artifactGroups.length ? artifactGroups.map(group => <section className="mission-v2-file-group" key={group.label}><h3>{group.label}</h3>{group.files.map(file => <a download href={artifactDownloadUrl(file)} key={file.id}><b>{file.relativePath.split('/').at(-1)}</b><small>{file.tool} · {Math.max(1, Math.round(file.size / 1024))} KB</small></a>)}</section>) : <small>Files appear here as each tool completes.</small>}</section></aside>
  </div></div>
}
