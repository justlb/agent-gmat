import { useEffect, useRef, useState } from 'react'
import { ResultCharts } from './ResultCharts'
import { ResultsDiscussion } from './ResultsDiscussion'
import { getRunView, type RunView } from './runViewApi'
import { getResultSamples, listResultRuns, RESULT_STAGES, type ResultRun, type ResultSample } from './runResultsApi'
import './ResultsPage.css'

const MAX_SELECTION = 5

const STATUS_LABELS: Record<ResultRun['status'], string> = {
  completed: 'Fully completed',
  failed: 'Failed / incomplete',
  running: 'In progress',
  partial: 'Partially completed',
  not_started: 'Not started',
  unknown: 'Status unavailable',
}

const SERIES_COLORS = ['#60a5fa', '#f59e0b', '#34d399', '#f87171', '#c084fc']

const CHEMICAL_TEMPLATES = new Set(['orbit-keeping', 'chemical-hohmann-transfer', 'chemical-3d-transfer'])
const ELECTRIC_TEMPLATES = new Set(['electric-propulsion-transfer', 'electrical-leo-orbit-maintenance'])

type StatusFilter = 'all' | 'completed' | 'incomplete'
type ScenarioFilter = 'all' | 'chemical' | 'electric'

// Known mission parameter keys → human-readable labels.
const PARAM_LABELS: Record<string, { label: string; unit?: string }> = {
  'initialOrbit.altitudeKm': { label: 'Altitude', unit: 'km' },
  'initialOrbit.smaKm': { label: 'Semi-major axis', unit: 'km' },
  'initialOrbit.eccentricity': { label: 'Eccentricity' },
  'initialOrbit.inclinationDeg': { label: 'Inclination', unit: '°' },
  'initialOrbit.raanDeg': { label: 'RAAN', unit: '°' },
  'initialOrbit.argPeriapsisDeg': { label: 'AOP', unit: '°' },
  'initialOrbit.trueAnomalyDeg': { label: 'True anomaly', unit: '°' },
  'spacecraft.dryMassKg': { label: 'Dry mass', unit: 'kg' },
  'spacecraft.initialFuelMassKg': { label: 'Fuel mass', unit: 'kg' },
  'spacecraft.dragAreaM2': { label: 'Drag area', unit: 'm²' },
  'spacecraft.dragCoefficient': { label: 'Drag coeff' },
  'propulsion.ispSeconds': { label: 'Isp', unit: 's' },
  'stationKeeping.minimumAltitudeKm': { label: 'Min altitude', unit: 'km' },
  'stationKeeping.targetSmaKm': { label: 'Target SMA', unit: 'km' },
  'stationKeeping.fuelReserveKg': { label: 'Fuel reserve', unit: 'kg' },
  'stationKeeping.missionDayLimit': { label: 'Duration limit', unit: 'days' },
  'endOfLife.finalAltitudeKm': { label: 'Final altitude', unit: 'km' },
  'transfer.finalAltitudeKm': { label: 'Final altitude', unit: 'km' },
}

// Result metric rows (same keys as the old MissionOverview component).
const RESULT_ROWS: { key: string; label: string; stage: string }[] = [
  { key: 'lifetime', label: 'Lifetime', stage: 'gmat' },
  { key: 'fuelMassConsumed', label: 'Fuel consumed', stage: 'gmat' },
  { key: 'averageAltitude', label: 'Avg altitude', stage: 'gmat' },
  { key: 'contactTime', label: 'Contact time', stage: 'simu_cic' },
  { key: 'latency', label: 'Latency', stage: 'simu_cic' },
  { key: 'eclipseTime', label: 'Eclipse time', stage: 'simu_cic' },
  { key: 'electricalConfiguration', label: 'Electrical', stage: 'opalis' },
]

const STAGE_LABELS: Record<string, string> = { gmat: 'GMAT', simu_cic: 'Simu-CIC', opalis: 'OPALIS', rf_comlink: 'RF-COMLINK' }

function dateLabel(run: ResultRun) {
  return run.createdAt ? new Date(run.createdAt).toLocaleString() : run.runId
}

function errorMessage(reason: unknown, fallback: string) {
  return reason instanceof Error ? reason.message : fallback
}

/** Accept absolute and relative paths returned by the archive without mixing runs. */
function matchesPath(run: ResultRun, path: string) {
  const normalized = path.replaceAll('\\', '/')
  return normalized === run.runPath || normalized.endsWith(`/${run.runPath}`)
}

/** Collect all unique missionValues keys across all runs, in a stable order. */
function collectParamKeys(runs: ResultRun[], views: Record<string, RunView | null>): string[] {
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const key of Object.keys(PARAM_LABELS)) {
    for (const run of runs) {
      const mv = views[run.runPath]?.missionValues
      if (mv && key in mv && !seen.has(key)) {
        seen.add(key)
        ordered.push(key)
      }
    }
  }
  // Include any keys present in missionValues but not in the predefined labels.
  for (const run of runs) {
    const mv = views[run.runPath]?.missionValues
    if (!mv) continue
    for (const key of Object.keys(mv)) {
      if (!seen.has(key)) {
        seen.add(key)
        ordered.push(key)
      }
    }
  }
  return ordered
}

/** Single unified table replacing MissionOverview + ComparisonTable. */
function UnifiedRunTable({ runs, views }: { runs: ResultRun[]; views: Record<string, RunView | null> }) {
  const paramKeys = collectParamKeys(runs, views)

  const renderParamValue = (run: ResultRun, key: string) => {
    const mv = views[run.runPath]?.missionValues
    const raw = mv?.[key]
    if (raw === null || raw === undefined) return '—'
    const meta = PARAM_LABELS[key]
    const unit = meta?.unit ? ` ${meta.unit}` : ''
    return `${raw}${unit}`
  }

  const renderResultValue = (run: ResultRun, row: { key: string; stage: string }) => {
    const overview = views[run.runPath]?.overview
    const stages = run.workflow?.stages
    const status = stages?.[row.stage as keyof typeof stages]?.status ?? 'unknown'
    const finished = status === 'failed' || status === 'completed' || status === 'unknown'
    const reported = overview?.[row.key]
    if (reported && !(finished && reported.value.startsWith('Waiting'))) return reported.value
    if (finished) return 'Unavailable'
    if (status === 'running') return `${STAGE_LABELS[row.stage] ?? row.stage} running`
    return `Waiting for ${STAGE_LABELS[row.stage] ?? row.stage}`
  }

  return <section className="results-unified-table">
    <span>RUN SUMMARY</span>
    <h2>{runs.length > 1 ? `${runs.length} runs compared` : 'Mission overview'}</h2>
    <div className="results-unified-scroll">
      <table>
        <thead>
          <tr>
            <th className="row-label"> </th>
            {runs.map((run, i) => <th key={run.runPath} style={{ color: SERIES_COLORS[i % SERIES_COLORS.length] }}>
              {run.runId}
            </th>)}
          </tr>
        </thead>
        <tbody>
          <tr className="section-row">
            <td colSpan={runs.length + 1}>Parameters</td>
          </tr>
          {paramKeys.map(key => (
            <tr key={key}>
              <td className="row-label">{PARAM_LABELS[key]?.label ?? key}</td>
              {runs.map(run => <td key={run.runPath}>{renderParamValue(run, key)}</td>)}
            </tr>
          ))}
          <tr className="section-row">
            <td colSpan={runs.length + 1}>Results</td>
          </tr>
          {RESULT_ROWS.map(row => (
            <tr key={row.key}>
              <td className="row-label">{row.label}</td>
              {runs.map(run => <td key={run.runPath} title={STAGE_LABELS[row.stage]}>{renderResultValue(run, row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
}

function MultiRunResults({ runs, refresh }: { runs: ResultRun[]; refresh: string }) {
  const [views, setViews] = useState<Record<string, RunView | null>>({})
  const [samplesByRun, setSamplesByRun] = useState<Record<string, ResultSample[]>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chartError, setChartError] = useState('')

  const primary = runs[0]

  useEffect(() => {
    let cancelled = false

    // Load run views (missionValues + overview) for ALL selected runs in parallel.
    Promise.allSettled(runs.map(run => getRunView(run.runPath)))
      .then(results => {
        if (cancelled) return
        const next: Record<string, RunView | null> = {}
        let hasError = false
        for (let i = 0; i < results.length; i++) {
          if (results[i].status === 'fulfilled') next[runs[i].runPath] = results[i].value
          else { hasError = true; next[runs[i].runPath] = null }
        }
        setViews(next)
        if (hasError) setError('Some runs could not be loaded.')
        else setError('')
      })

    // Load time-series for all selected runs in parallel.
    Promise.allSettled(runs.map(run => getResultSamples(run.runPath)))
      .then(results => {
        if (cancelled) return
        const next: Record<string, ResultSample[]> = {}
        let hasChartError = false
        for (let i = 0; i < results.length; i++) {
          const result = results[i]
          if (result.status === 'fulfilled') next[runs[i].runPath] = result.value
          else hasChartError = true
        }
        setSamplesByRun(next)
        if (hasChartError) setChartError('Some runs could not be loaded for chart overlay.')
        else setChartError('')
      })
      .finally(() => { if (!cancelled) setLoading(false) })

    return () => { cancelled = true }
  }, [runs.map(r => r.runPath).join(','), refresh])

  const completedStages = RESULT_STAGES.filter(([id]) => primary.workflow?.stages[id]?.status === 'completed').length

  const chartSeries = runs.map((run, index) => ({
    label: run.runId,
    color: SERIES_COLORS[index % SERIES_COLORS.length],
    samples: samplesByRun[run.runPath] ?? [],
  }))

  return <>
    <section className="results-run-heading">
      <span>SELECTED RUN{runs.length > 1 ? `S · ${runs.length}` : ''} · {primary.runId}</span>
      <h2>{primary.name}</h2>
      <time dateTime={primary.createdAt ?? undefined}>{dateLabel(primary)}</time>
      <b className={`results-status is-${primary.status}`}>{STATUS_LABELS[primary.status]}</b>
    </section>
    <details className="results-workflow-details">
      <summary>Pipeline details · {completedStages} / 4 stages completed</summary>
      <section className="results-workflow" aria-label="Pipeline status">
        {RESULT_STAGES.map(([id, label]) => {
          const stage = primary.workflow?.stages[id]
          const status = stage?.status ?? 'unknown'
          return <div key={id}>
            <strong>{label}</strong>
            <span className={`results-status is-${status}`}>{status.replaceAll('_', ' ')}</span>
            {stage?.message ? <small>{stage.message}</small> : null}
          </div>
        })}
      </section>
    </details>
    {error ? <p className="results-error" role="alert">{error}</p> : null}
    <UnifiedRunTable runs={runs} views={views} />
    {loading ? <p className="results-notice">Loading saved graphs…</p> : null}
    {chartError ? <p className="results-error" role="alert">{chartError}</p> : null}
    {!loading && !chartError ? <ResultCharts series={chartSeries} runs={runs} views={views} /> : null}
  </>
}

export function ResultsPage({ runPath, workspaceDir }: { runPath?: string; workspaceDir?: string | null }) {
  const [runs, setRuns] = useState<ResultRun[]>([])
  const [selectedPaths, setSelectedPaths] = useState<string[]>(runPath ? [runPath] : [])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [scenarioFilter, setScenarioFilter] = useState<ScenarioFilter>('all')
  const hasInitializedRef = useRef(false)

  useEffect(() => {
    if (runPath) setSelectedPaths(prev => prev.includes(runPath) ? prev : [runPath, ...prev].slice(0, MAX_SELECTION))
  }, [runPath])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>

    const load = async () => {
      try {
        const result = await listResultRuns(workspaceDir)
        if (!cancelled) {
          setRuns(result.runs)
          setError('')
          setSelectedPaths(prev => {
            const filtered = prev.filter(p => result.runs.some(run => matchesPath(run, p)))
            if (filtered.length === 0 && result.runs.length && !hasInitializedRef.current) {
              return [result.runs[0].runPath]
            }
            return filtered
          })
          hasInitializedRef.current = true
        }
      } catch (reason) {
        if (!cancelled) setError(errorMessage(reason, 'Unable to load runs'))
      } finally {
        if (!cancelled) {
          setLoading(false)
          timer = setTimeout(() => void load(), 5000)
        }
      }
    }

    void load()
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [workspaceDir, refresh])

  const filteredRuns = runs.filter(run => {
    if (statusFilter === 'completed' && run.status !== 'completed') return false
    if (statusFilter === 'incomplete' && run.status === 'completed') return false
    if (scenarioFilter === 'chemical' && !CHEMICAL_TEMPLATES.has(run.templateId ?? '')) return false
    if (scenarioFilter === 'electric' && !ELECTRIC_TEMPLATES.has(run.templateId ?? '')) return false
    return true
  })

  const selectedRuns = selectedPaths
    .map(p => runs.find(run => matchesPath(run, p)))
    .filter((run): run is ResultRun => Boolean(run))

  const toggleRun = (runPath: string) => {
    setSelectedPaths(prev =>
      prev.includes(runPath)
        ? prev.filter(p => p !== runPath)
        : prev.length < MAX_SELECTION ? [...prev, runPath] : prev
    )
  }

  const selectedRefresh = `${refresh}-${JSON.stringify(selectedRuns[0]?.workflow)}`

  const discussionMode = selectedRuns.length >= 2
    ? { kind: 'multi' as const, runs: selectedRuns }
    : selectedRuns.length === 1
      ? { kind: 'single' as const, run: selectedRuns[0] }
      : null

  return <div className="results-layout">
    <aside className="results-run-list" aria-label="Saved mission runs">
      <header>
        <span>MISSION ARCHIVE</span>
        <h2>Saved runs</h2>
      </header>
      <div className="results-filters">
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as StatusFilter)} title="Status filter">
          <option value="all">All</option>
          <option value="completed">Completed</option>
          <option value="incomplete">Incomplete</option>
        </select>
        <select value={scenarioFilter} onChange={e => setScenarioFilter(e.target.value as ScenarioFilter)} title="Scenario filter">
          <option value="all">All</option>
          <option value="chemical">Chemical</option>
          <option value="electric">Electric</option>
        </select>
        <button type="button" onClick={() => setRefresh(value => value + 1)} title="Refresh runs list">↻</button>
      </div>
      <p className="results-selection-count">{selectedPaths.length}/{MAX_SELECTION} selected</p>
      {error ? <p className="results-error" role="alert">{error}</p> : null}
      <div className="results-run-options">
        {filteredRuns.map(run => {
          const isSelected = selectedPaths.includes(run.runPath)
          const selectionIndex = selectedPaths.indexOf(run.runPath)
          return <label
            key={run.runPath}
            className={`results-run-option ${isSelected ? 'is-selected' : ''}`}
            style={isSelected ? { boxShadow: `inset 3px 0 ${SERIES_COLORS[selectionIndex % SERIES_COLORS.length]}` } : undefined}
          >
            <input
              type="checkbox"
              checked={isSelected}
              disabled={!isSelected && selectedPaths.length >= MAX_SELECTION}
              onChange={() => toggleRun(run.runPath)}
            />
            <div className="results-run-option-content">
              <time dateTime={run.createdAt ?? undefined}>{dateLabel(run)}</time>
              <strong>{run.name}</strong>
              <small>{run.runId}</small>
              <span className={`results-status is-${run.status}`}>{STATUS_LABELS[run.status]}</span>
            </div>
          </label>
        })}
        {!loading && !runs.length && !error ? <p className="results-notice">No runs found. Start one from New simulation.</p> : null}
      </div>
    </aside>
    <main className="results-main" aria-label="Run results">
      {selectedRuns.length
        ? <MultiRunResults key={selectedRuns[0].runPath} runs={selectedRuns} refresh={selectedRefresh} />
        : <div className="results-empty">
          <h2>{loading ? 'Loading mission runs…' : 'No saved run selected'}</h2>
          <p>{error ? 'The run list could not be loaded. Use Refresh to retry.' : 'Select a saved run from the archive, including partial or failed calculations.'}</p>
        </div>}
    </main>
    <aside className="results-discussion" aria-label="Results assistant">
      {discussionMode
        ? <ResultsDiscussion key={discussionMode.kind === 'single' ? discussionMode.run.runPath : selectedRuns.map(r => r.runPath).join(',')} mode={discussionMode} />
        : <p className="results-notice">Select a run to discuss its results.</p>}
    </aside>
  </div>
}
