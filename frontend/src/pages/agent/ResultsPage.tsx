import { useEffect, useState } from 'react'
import { MissionOverview, RESULT_STAGES } from './MissionOverview'
import { ResultCharts } from './GmatAnalysisPanel'
import { ResultsDiscussion } from './ResultsDiscussion'
import { getRunView, type RunView } from './runViewApi'
import { getResultSamples, listResultRuns, type ResultRun, type ResultSample } from './runResultsApi'
import './ResultsPage.css'

const statusLabels: Record<ResultRun['status'], string> = { completed: 'Fully completed', failed: 'Failed / incomplete', running: 'In progress', partial: 'Partially completed', not_started: 'Not started', unknown: 'Status unavailable' }
function dateLabel(run: ResultRun) { return run.createdAt ? new Date(run.createdAt).toLocaleString() : run.runId }
function matchesPath(run: ResultRun, path: string) { const normalized = path.replaceAll('\\', '/'); return normalized === run.runPath || normalized.endsWith(`/${run.runPath}`) }

function SelectedResults({ run, comparison, refresh }: { run: ResultRun; comparison?: ResultRun; refresh: string }) {
  const [view, setView] = useState<RunView | null>(null)
  const [samples, setSamples] = useState<ResultSample[]>([])
  const [comparisonSamples, setComparisonSamples] = useState<ResultSample[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [chartError, setChartError] = useState('')
  const [comparisonError, setComparisonError] = useState('')
  useEffect(() => {
    let cancelled = false
    void getRunView(run.runPath).then(result => { if (!cancelled) { setView(result); setError('') } }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load run summary') })
    void getResultSamples(run.runPath).then(result => { if (!cancelled) { setSamples(result); setChartError('') } }).catch(reason => { if (!cancelled) setChartError(reason instanceof Error ? reason.message : 'Unable to load graphs') }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [run.runPath, refresh])
  useEffect(() => {
    let cancelled = false
    setComparisonSamples([]); setComparisonError('')
    if (comparison) void getResultSamples(comparison.runPath).then(result => { if (!cancelled) { setComparisonSamples(result); if (!result.length) setComparisonError('The comparison run has no saved time-series data.') } }).catch(reason => { if (!cancelled) setComparisonError(reason instanceof Error ? reason.message : 'Unable to load comparison') })
    return () => { cancelled = true }
  }, [comparison?.runPath, refresh])
  return <>
    <section className="results-run-heading"><span>SELECTED RUN · {run.runId}</span><h2>{run.name}</h2><time dateTime={run.createdAt ?? undefined}>{dateLabel(run)}</time><b className={`results-status is-${run.status}`}>{statusLabels[run.status]}</b></section>
    <section className="results-workflow" aria-label="Pipeline status">{RESULT_STAGES.map(([id, label]) => <div key={id}><strong>{label}</strong><span className={`results-status is-${run.workflow?.stages[id]?.status ?? 'unknown'}`}>{run.workflow?.stages[id]?.status.replaceAll('_', ' ') ?? 'Unknown'}</span>{run.workflow?.stages[id]?.message ? <small>{run.workflow.stages[id]?.message}</small> : null}</div>)}</section>
    {error ? <p className="results-error" role="alert">Summary unavailable: {error}</p> : null}
    <MissionOverview overview={view?.overview} stages={run.workflow?.stages} saved />
    {loading ? <p className="results-notice">Loading saved graphs…</p> : null}
    {chartError ? <p className="results-error" role="alert">Graphs unavailable: {chartError}</p> : null}
    {comparisonError ? <p className="results-error" role="alert">{comparisonError}</p> : null}
    {!loading && !chartError ? <ResultCharts samples={samples} comparison={comparisonSamples} label={run.runId} comparisonLabel={comparison?.runId} /> : null}
  </>
}

export function ResultsPage({ runPath, workspaceDir }: { runPath?: string; workspaceDir?: string | null }) {
  const [runs, setRuns] = useState<ResultRun[]>([])
  const [selectedPath, setSelectedPath] = useState(runPath ?? '')
  const [comparisonPath, setComparisonPath] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { if (runPath) setSelectedPath(runPath) }, [runPath])
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const result = await listResultRuns(workspaceDir)
        if (!cancelled) { setRuns(result.runs); setError(''); setSelectedPath(current => result.runs.find(run => matchesPath(run, current))?.runPath ?? result.runs[0]?.runPath ?? '') }
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load runs') }
      finally { if (!cancelled) { setLoading(false); timer = setTimeout(() => void load(), 5000) } }
    }
    void load()
    return () => { cancelled = true; clearTimeout(timer) }
  }, [workspaceDir, refresh])
  const selected = runs.find(run => matchesPath(run, selectedPath))
  const compatible = selected ? runs.filter(run => run.runPath !== selected.runPath && run.templateId === selected.templateId && run.templateId !== null) : []
  const comparison = compatible.find(run => run.runPath === comparisonPath)
  // Reload saved indicators when the persisted workflow advances, not on every list refresh.
  const selectedRefresh = `${refresh}-${JSON.stringify(selected?.workflow)}`
  return <div className="results-layout">
    <aside className="results-discussion" aria-label="Results assistant">{selected ? <ResultsDiscussion key={selected.runPath} run={selected} /> : <p className="results-notice">Select a run to discuss its results.</p>}</aside>
    <main className="results-main" aria-label="Run results">{selected ? <SelectedResults key={selected.runPath} run={selected} comparison={comparison} refresh={selectedRefresh} /> : <div className="results-empty"><h2>{loading ? 'Loading mission runs…' : 'No saved run selected'}</h2><p>{error ? 'The run list could not be loaded. Use Refresh to retry.' : 'Saved runs appear on the right, including partial or failed calculations.'}</p></div>}</main>
    <aside className="results-run-list" aria-label="Saved mission runs"><header><span>MISSION ARCHIVE</span><h2>Saved runs</h2><p>Dates are displayed in your local time.</p><button type="button" onClick={() => setRefresh(value => value + 1)}>Refresh</button></header>
      {error ? <p className="results-error" role="alert">{error}</p> : null}
      <div className="results-run-options">{runs.map(run => <button key={run.runPath} type="button" className={`results-run-option ${selected?.runPath === run.runPath ? 'is-selected' : ''}`} aria-pressed={selected?.runPath === run.runPath} onClick={() => { setSelectedPath(run.runPath); setComparisonPath('') }}><time dateTime={run.createdAt ?? undefined}>{dateLabel(run)}</time><strong>{run.name}</strong><small>{run.runId}</small><span className={`results-status is-${run.status}`}>{statusLabels[run.status]}</span></button>)}{!loading && !runs.length && !error ? <p className="results-notice">No runs found. Start one from New simulation.</p> : null}</div>
      <label className="results-comparison">Compare graphs with<select value={comparison?.runPath ?? ''} disabled={!compatible.length} onChange={event => setComparisonPath(event.target.value)}><option value="">No comparison</option>{compatible.map(run => <option key={run.runPath} value={run.runPath}>{dateLabel(run)} · {statusLabels[run.status]}</option>)}</select></label>
    </aside>
  </div>
}
