import { useEffect, useMemo, useState } from 'react'
import { getElectricPropulsionTimeSeries, type ElectricPropulsionTimeSeriesSample } from './electricPropulsionApi'
import { listMissionTemplateFiles } from './missionTemplateRuntime'
import { missionTemplateDefinition, type GmatMissionTemplateId } from './gmatMissionTemplates'
import { getOrbitKeepingTimeSeries, type OrbitKeepingTimeSeriesSample } from './orbitKeepingApi'
import { getOpalisResults, getOpalisTimeSeries, type OpalisResultSummary, type OpalisTimeSeries, type OpalisTimeSeriesSample } from './simuCicApi'
import { CesiumOrbitViewer } from './CesiumOrbitViewer'

type PlottableTemplate = Extract<GmatMissionTemplateId, 'electric-propulsion-transfer' | 'orbit-keeping'>
type Metric = 'altitudeKm' | 'eccentricity' | 'fuelMassKg' | 'massFlowRateKgPerSec' | 'powerAvailableKw' | 'semiMajorAxisKm'
type AnalysisSample = { altitudeKm?: number; eccentricity: number; elapsedDays: number; fuelMassKg: number; massFlowRateKgPerSec?: number; powerAvailableKw?: number; semiMajorAxisKm: number }
type RunOption = { label: string; path: string; template: GmatMissionTemplateId }
type ChartSeries = { color: string; label: string; samples: AnalysisSample[] }
type LoadedOpalisResult = OpalisResultSummary & { runPath: string }
type OpalisMetric = 'soc_percent' | 'battery_voltage_v' | 'solar_energy_wh' | 'depth_of_discharge_percent'
type OpalisChartSeries = { color: string; label: string; result: OpalisTimeSeries }

const EARTH_EQUATORIAL_RADIUS_KM = 6378.1363
const METRICS: Record<Metric, { label: string; unit: string }> = {
  altitudeKm: { label: 'Altitude', unit: 'km' }, eccentricity: { label: 'Eccentricity', unit: '' }, fuelMassKg: { label: 'Fuel mass', unit: 'kg' }, massFlowRateKgPerSec: { label: 'Mass flow rate', unit: 'kg/s' }, powerAvailableKw: { label: 'Thrust power available', unit: 'kW' }, semiMajorAxisKm: { label: 'Semi-major axis', unit: 'km' },
}
const ELECTRIC_METRICS: Metric[] = ['altitudeKm', 'eccentricity', 'fuelMassKg', 'powerAvailableKw', 'massFlowRateKgPerSec']
const ORBIT_METRICS: Metric[] = ['altitudeKm', 'semiMajorAxisKm', 'fuelMassKg']
const OPALIS_METRICS: Array<{ key: OpalisMetric; label: string; unit: string }> = [
  { key: 'soc_percent', label: 'State of charge', unit: '%' }, { key: 'battery_voltage_v', label: 'Battery voltage', unit: 'V' },
  { key: 'solar_energy_wh', label: 'Solar-array energy', unit: 'Wh' }, { key: 'depth_of_discharge_percent', label: 'Depth of discharge', unit: '%' },
]

function isPlottableTemplate(value: string): value is PlottableTemplate { return value === 'electric-propulsion-transfer' || value === 'orbit-keeping' }
function runLabel(path: string) { return path.replace(/\\/gu, '/').split('/').at(-1) ?? path }
function axisTicks(minimum: number, maximum: number, count = 5) { const span = maximum - minimum || 1; return Array.from({ length: count + 1 }, (_, index) => minimum + span * index / count) }
function axisValue(value: number) { const magnitude = Math.abs(value); return magnitude > 0 && magnitude < .01 ? value.toExponential(2) : magnitude >= 1000 ? value.toFixed(0) : magnitude >= 10 ? value.toFixed(1) : value.toFixed(2) }
function hasMetric(sample: AnalysisSample, metric: Metric): sample is AnalysisSample & Record<Metric, number> { return typeof sample[metric] === 'number' && Number.isFinite(sample[metric]) }
function hasOpalisMetric(sample: OpalisTimeSeriesSample, metric: OpalisMetric): sample is OpalisTimeSeriesSample & Record<OpalisMetric, number> { return typeof sample[metric] === 'number' && Number.isFinite(sample[metric]) }
function opalisElapsedMinutes(sample: OpalisTimeSeriesSample) { return (sample.time_seconds ?? sample.index) / 60 }

function LineChart({ metric, series }: { metric: Metric; series: ChartSeries[] }) {
  const width = 760; const height = 300; const margin = { bottom: 58, left: 74, right: 24, top: 26 }; const chartWidth = width - margin.left - margin.right; const chartHeight = height - margin.top - margin.bottom
  const usable = series.map(entry => ({ ...entry, samples: entry.samples.filter(sample => hasMetric(sample, metric)) })).filter(entry => entry.samples.length)
  const samples = usable.flatMap(entry => entry.samples)
  if (!samples.length) return <p className="gmat-analysis-note">This GMAT report does not contain {METRICS[metric].label.toLowerCase()} samples.</p>
  const xValues = samples.map(sample => sample.elapsedDays); const yValues = samples.map(sample => sample[metric]); const xMin = Math.min(...xValues); const xMax = Math.max(...xValues); const yMin = Math.min(...yValues); const yMax = Math.max(...yValues); const xSpan = xMax - xMin || 1; const ySpan = yMax - yMin || 1
  const x = (value: number) => margin.left + (value - xMin) / xSpan * chartWidth; const y = (value: number) => margin.top + chartHeight - (value - yMin) / ySpan * chartHeight
  const xTicks = axisTicks(xMin, xMax); const yTicks = axisTicks(yMin, yMax); const unit = METRICS[metric].unit
  return <><svg aria-label={`${METRICS[metric].label} from GMAT output`} className="gmat-analysis-chart" viewBox={`0 0 ${width} ${height}`} role="img">
    <g className="gmat-analysis-grid">{yTicks.map(tick => <line key={`y-${tick}`} x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />)}{xTicks.map(tick => <line key={`x-${tick}`} x1={x(tick)} x2={x(tick)} y1={margin.top} y2={height - margin.bottom} />)}</g>
    <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} /><line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} />
    {yTicks.map(tick => <text key={`yl-${tick}`} textAnchor="end" x={margin.left - 8} y={y(tick) + 4}>{axisValue(tick)}</text>)}{xTicks.map(tick => <text key={`xl-${tick}`} textAnchor="middle" x={x(tick)} y={height - margin.bottom + 20}>{axisValue(tick)}</text>)}
    <text textAnchor="middle" x={margin.left + chartWidth / 2} y={height - 10}>Elapsed time (days)</text><text textAnchor="middle" transform={`translate(18 ${margin.top + chartHeight / 2}) rotate(-90)`}>{METRICS[metric].label}{unit ? ` (${unit})` : ''}</text>
    {usable.map(entry => <polyline fill="none" key={entry.label} points={entry.samples.map(sample => `${x(sample.elapsedDays)},${y(sample[metric])}`).join(' ')} stroke={entry.color} strokeWidth="3" />)}
  </svg>{usable.length > 1 ? <div className="gmat-analysis-legend">{usable.map(entry => <span key={entry.label}><i style={{ background: entry.color }} />{entry.label}</span>)}</div> : null}</>
}

function OpalisLineChart({ metric, series }: { metric: { key: OpalisMetric; label: string; unit: string }; series: OpalisChartSeries[] }) {
  const usable = series.map(entry => ({ ...entry, samples: entry.result.samples.filter(sample => hasOpalisMetric(sample, metric.key)) })).filter(entry => entry.samples.length)
  const samples = usable.flatMap(entry => entry.samples)
  if (!samples.length) return null
  const width = 700; const height = 230; const margin = { bottom: 48, left: 66, right: 18, top: 20 }; const chartWidth = width - margin.left - margin.right; const chartHeight = height - margin.top - margin.bottom
  const xValues = samples.map(opalisElapsedMinutes); const yValues = samples.map(sample => sample[metric.key]); const xMin = Math.min(...xValues); const xMax = Math.max(...xValues); const yMin = Math.min(...yValues); const yMax = Math.max(...yValues); const xSpan = xMax - xMin || 1; const ySpan = yMax - yMin || 1
  const x = (value: number) => margin.left + (value - xMin) / xSpan * chartWidth; const y = (value: number) => margin.top + chartHeight - (value - yMin) / ySpan * chartHeight
  const xTicks = axisTicks(xMin, xMax, 4); const yTicks = axisTicks(yMin, yMax, 4)
  return <section className="opalis-series-chart"><strong>{metric.label}</strong><span>OPALIS result rows · elapsed time (minutes)</span><svg aria-label={`${metric.label} from OPALIS output`} className="gmat-analysis-chart" viewBox={`0 0 ${width} ${height}`} role="img"><g className="gmat-analysis-grid">{yTicks.map(tick => <line key={`y-${tick}`} x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />)}{xTicks.map(tick => <line key={`x-${tick}`} x1={x(tick)} x2={x(tick)} y1={margin.top} y2={height - margin.bottom} />)}</g><line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} /><line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} />{yTicks.map(tick => <text key={`yl-${tick}`} textAnchor="end" x={margin.left - 8} y={y(tick) + 4}>{axisValue(tick)}</text>)}{xTicks.map(tick => <text key={`xl-${tick}`} textAnchor="middle" x={x(tick)} y={height - margin.bottom + 20}>{axisValue(tick)}</text>)}<text textAnchor="middle" x={margin.left + chartWidth / 2} y={height - 9}>Elapsed time (min)</text><text textAnchor="middle" transform={`translate(16 ${margin.top + chartHeight / 2}) rotate(-90)`}>{metric.label} ({metric.unit})</text>{usable.map(entry => <polyline fill="none" key={entry.label} points={entry.samples.map(sample => `${x(opalisElapsedMinutes(sample))},${y(sample[metric.key])}`).join(' ')} stroke={entry.color} strokeWidth="3" />)}</svg>{usable.length > 1 ? <div className="gmat-analysis-legend">{usable.map(entry => <span key={entry.label}><i style={{ background: entry.color }} />{entry.label}</span>)}</div> : null}</section>
}

function orbitSamples(samples: OrbitKeepingTimeSeriesSample[]): AnalysisSample[] { const first = samples[0]?.epochA1ModJulian ?? 0; return samples.map(sample => ({ altitudeKm: sample.altitudeKm, eccentricity: sample.eccentricity, elapsedDays: sample.epochA1ModJulian - first, fuelMassKg: sample.fuelMassKg, semiMajorAxisKm: sample.semiMajorAxisKm })) }
function electricAltitudeKm(sample: ElectricPropulsionTimeSeriesSample) { const radius = sample.semiMajorAxisKm * (1 - sample.eccentricity ** 2) / (1 + sample.eccentricity * Math.cos(sample.trueAnomalyDeg * Math.PI / 180)); return radius - EARTH_EQUATORIAL_RADIUS_KM }
function electricSamples(samples: ElectricPropulsionTimeSeriesSample[]): AnalysisSample[] { return samples.map(sample => ({ altitudeKm: electricAltitudeKm(sample), eccentricity: sample.eccentricity, elapsedDays: sample.elapsedDays, fuelMassKg: sample.fuelMassKg, massFlowRateKgPerSec: sample.massFlowRateKgPerSec, powerAvailableKw: sample.powerAvailableKw, semiMajorAxisKm: sample.semiMajorAxisKm })) }
function metricRange(samples: AnalysisSample[], metric: Metric) { const values = samples.filter(sample => hasMetric(sample, metric)).map(sample => sample[metric]); return values.length ? { maximum: Math.max(...values), minimum: Math.min(...values) } : null }
function finalMetric(samples: AnalysisSample[], metric: Metric) { const sample = [...samples].reverse().find(item => hasMetric(item, metric)); return sample?.[metric] ?? null }
function finalOpalisMetric(series: OpalisTimeSeries | null, metric: OpalisMetric) { const sample = series ? [...series.samples].reverse().find(item => hasOpalisMetric(item, metric)) : undefined; return sample?.[metric] ?? null }
function metricValue(value: number | null, unit = '', digits = 1) { return value === null ? 'Unavailable' : `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}` }
function durationValue(seconds: number | null) { if (seconds === null) return 'Unavailable'; if (seconds < 60) return `${seconds.toFixed(1)} s`; if (seconds < 3600) return `${(seconds / 60).toFixed(1)} min`; return `${(seconds / 3600).toFixed(2)} h` }

function OpalisResultsCard({ result, runs }: { result: LoadedOpalisResult; runs: RunOption[] }) {
  const [series, setSeries] = useState<OpalisTimeSeries | null>(null)
  const [comparisonPath, setComparisonPath] = useState('')
  const [comparisonResult, setComparisonResult] = useState<LoadedOpalisResult | null>(null)
  const [comparisonSeries, setComparisonSeries] = useState<OpalisTimeSeries | null>(null)
  const [seriesError, setSeriesError] = useState('')
  const comparisonRuns = runs.filter(run => run.path !== result.runPath)
  useEffect(() => { setComparisonPath('') }, [result.runPath])
  useEffect(() => {
    let cancelled = false
    setSeries(null); setComparisonResult(null); setComparisonSeries(null); setSeriesError('')
    const comparisonRun = comparisonRuns.find(run => run.path === comparisonPath)
    void getOpalisTimeSeries(result.runPath)
      .then(primary => { if (!cancelled) setSeries(primary) })
      .catch(() => { if (!cancelled) setSeriesError('Detailed OPALIS rows are not available for this older calculation.') })
    if (comparisonRun) {
      void Promise.all([getOpalisResults(comparisonRun.path), getOpalisTimeSeries(comparisonRun.path)])
        .then(comparison => { if (!cancelled) { setComparisonResult({ ...comparison[0], runPath: comparisonRun.path }); setComparisonSeries(comparison[1]) } })
        .catch(() => { if (!cancelled) setSeriesError('The selected comparison run does not contain detailed OPALIS rows.') })
    }
    return () => { cancelled = true }
  }, [comparisonPath, result.runPath])
  const chartSeries: OpalisChartSeries[] = series ? [{ color: '#22d3ee', label: `Run A · ${runLabel(result.runPath)}`, result: series }, ...(comparisonSeries ? [{ color: '#f59e0b', label: `Run B · ${runLabel(comparisonPath)}`, result: comparisonSeries }] : [])] : []
  const deltas = comparisonSeries ? OPALIS_METRICS.flatMap(metric => { const primary = finalOpalisMetric(series, metric.key); const comparison = finalOpalisMetric(comparisonSeries, metric.key); return primary === null || comparison === null ? [] : [{ ...metric, value: primary - comparison }] }) : []
  return <section className="opalis-results-card">
    <strong>{comparisonResult ? 'OPALIS run comparison' : 'OPALIS electrical results'}</strong>
    <span>Curves use the saved OPALIS samples, aligned on elapsed time from each run&apos;s start.</span>
    {comparisonRuns.length ? <div className="gmat-analysis-comparison-selector opalis-comparison-selector"><strong>Compare OPALIS runs</strong><span>Choose a second run with OPALIS detailed output.</span><label>Compare with<select value={comparisonPath} onChange={event => setComparisonPath(event.target.value)}><option value="">No comparison</option>{comparisonRuns.map(run => <option key={run.path} value={run.path}>{missionTemplateDefinition(run.template).label} · {run.label}</option>)}</select></label></div> : null}
    <div className="opalis-result-groups">
      <div><h3>Summary</h3><dl><dt>Satellite</dt><dd>{result.satelliteName ?? 'Unavailable'}</dd><dt>Calculated duration</dt><dd>{durationValue(result.computedDurationSeconds)}</dd><dt>Completion</dt><dd>{metricValue(result.completionPercent, '%')}</dd><dt>Stop condition</dt><dd>{result.stopCondition ?? 'Unavailable'}</dd><dt>Voltage control</dt><dd>{result.voltageControlMode ?? 'Unavailable'}</dd></dl></div>
      <div><h3>Energy balance</h3><dl><dt>Initial SoC</dt><dd>{metricValue(result.initialSocPercent, '%')}</dd><dt>Final SoC</dt><dd>{metricValue(result.finalSocPercent, '%')}</dd><dt>Max depth of discharge</dt><dd>{metricValue(result.maxDepthOfDischargePercent, '%')}</dd><dt>Solar-array energy</dt><dd>{metricValue(result.solarArrayEnergy, ' Wh', 2)}</dd><dt>Solar sections</dt><dd>{metricValue(result.solarSections, '', 0)}</dd></dl></div>
      <div><h3>Battery &amp; synthesis</h3><dl><dt>Initial voltage</dt><dd>{metricValue(result.initialBatteryVoltageV, ' V', 2)}</dd><dt>Low-voltage limit</dt><dd>{metricValue(result.lowVoltageLimitV, ' V', 2)}</dd><dt>Orbits synthesised</dt><dd>{metricValue(result.orbitCount, '', 0)}</dd><dt>Result rows</dt><dd>{metricValue(result.resultRows, '', 0)}</dd><dt>Time step</dt><dd>{durationValue(result.timeStepSeconds)}</dd></dl></div>
    </div>
    {deltas.length ? <div className="gmat-analysis-comparison-deltas">{deltas.map(delta => <span key={delta.key}>Δ final {delta.label}: {delta.value >= 0 ? '+' : ''}{axisValue(delta.value)} {delta.unit}</span>)}</div> : null}
    {result.alerts.map(alert => <p className={alert.level === 'warning' ? 'opalis-result-warning' : 'opalis-result-info'} key={alert.message}>{alert.message}</p>)}
    {chartSeries.length ? <div className="opalis-series-grid">{OPALIS_METRICS.map(metric => <OpalisLineChart key={metric.key} metric={metric} series={chartSeries} />)}</div> : null}
    {seriesError ? <p className="opalis-result-info">{seriesError}</p> : null}
  </section>
}

async function loadSamples(run: RunOption) {
  if (run.template === 'electric-propulsion-transfer') return getElectricPropulsionTimeSeries(run.path).then(electricSamples)
  if (run.template === 'orbit-keeping') return getOrbitKeepingTimeSeries(run.path).then(orbitSamples)
  return []
}

export function GmatAnalysisPanel({ runPath, template, workspaceDir }: { runPath?: string; template?: GmatMissionTemplateId; workspaceDir?: string | null }) {
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false); const [metric, setMetric] = useState<Metric>('altitudeKm'); const [runs, setRuns] = useState<RunOption[]>([]); const [opalisRunPaths, setOpalisRunPaths] = useState<Set<string>>(new Set()); const [selectedPath, setSelectedPath] = useState(runPath ?? ''); const [comparisonPath, setComparisonPath] = useState(''); const [primarySamples, setPrimarySamples] = useState<AnalysisSample[]>([]); const [comparisonSamples, setComparisonSamples] = useState<AnalysisSample[]>([]); const [opalisResult, setOpalisResult] = useState<LoadedOpalisResult | null>(null)
  useEffect(() => { let cancelled = false; void listMissionTemplateFiles(workspaceDir).then(files => { if (cancelled) return; const entries = files.reduce<Array<RunOption & { mtimeMs: number }>>((collected, file) => { if ((file.kind === 'timeseries' || file.kind === 'ephemeris') && file.runPath) collected.push({ label: runLabel(file.runPath), mtimeMs: file.mtimeMs, path: file.runPath, template: file.missionType }); return collected }, []); if (runPath && template) entries.unshift({ label: runLabel(runPath), mtimeMs: Number.MAX_SAFE_INTEGER, path: runPath, template }); const unique: RunOption[] = entries.sort((a, b) => b.mtimeMs - a.mtimeMs).filter((entry, index, all) => all.findIndex(candidate => candidate.path === entry.path) === index).map(({ label, path, template: itemTemplate }) => ({ label, path, template: itemTemplate })); setRuns(unique); setOpalisRunPaths(new Set(files.filter(file => file.kind === 'opalis' && file.fileName === 'calculated-opalis-timeseries.json' && file.runPath).map(file => file.runPath!))); setSelectedPath(current => unique.some(entry => entry.path === current) ? current : unique[0]?.path ?? '') }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to list GMAT runs') }); return () => { cancelled = true } }, [runPath, template, workspaceDir])
  const selectedRun = runs.find(run => run.path === selectedPath); const selectedRunHasTimeSeries = selectedRun ? isPlottableTemplate(selectedRun.template) : false; const compatibleRuns = selectedRun && selectedRunHasTimeSeries ? runs.filter(run => run.template === selectedRun.template && run.path !== selectedRun.path) : []
  useEffect(() => { if (comparisonPath && !compatibleRuns.some(run => run.path === comparisonPath)) setComparisonPath('') }, [comparisonPath, compatibleRuns])
  useEffect(() => { let cancelled = false; if (!selectedRun) { setPrimarySamples([]); setComparisonSamples([]); setOpalisResult(null); return () => { cancelled = true } }; const compare = compatibleRuns.find(run => run.path === comparisonPath); setLoading(true); setError(''); void Promise.all([loadSamples(selectedRun), compare ? loadSamples(compare) : Promise.resolve([])]).then(([primary, comparison]) => { if (!cancelled) { setPrimarySamples(primary); setComparisonSamples(comparison) } }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Unable to load GMAT time-series data') }).finally(() => { if (!cancelled) setLoading(false) }); void getOpalisResults(selectedRun.path).then(result => { if (!cancelled) setOpalisResult({ ...result, runPath: selectedRun.path }) }).catch(() => { if (!cancelled) setOpalisResult(null) }); return () => { cancelled = true } }, [comparisonPath, selectedRun?.path])
  const isElectric = selectedRun?.template === 'electric-propulsion-transfer'; const available = isElectric ? ELECTRIC_METRICS : ORBIT_METRICS; const selectedMetric = available.includes(metric) ? metric : available[0]; const series: ChartSeries[] = [{ color: '#60a5fa', label: `Run A · ${selectedRun?.label ?? ''}`, samples: primarySamples }, ...(comparisonPath ? [{ color: '#f59e0b', label: `Run B · ${compatibleRuns.find(run => run.path === comparisonPath)?.label ?? ''}`, samples: comparisonSamples }] : [])]; const summary = useMemo(() => metricRange(primarySamples, selectedMetric), [primarySamples, selectedMetric]); const metrics = !selectedRunHasTimeSeries ? [] : isElectric ? ELECTRIC_METRICS.filter(key => series.some(entry => entry.samples.some(sample => hasMetric(sample, key)))) : [selectedMetric]; const deltas = comparisonPath ? available.flatMap(key => { const left = finalMetric(primarySamples, key); const right = finalMetric(comparisonSamples, key); return left === null || right === null ? [] : [{ key, value: left - right }] }) : []
  return <div className="gmat-analysis-panel"><section className="gmat-analysis-run-selector"><div><strong>GMAT results</strong><span>Cesium uses the saved GMAT OEM; curves use the run time-series when available.</span></div><label>Run A<select value={selectedPath} onChange={event => setSelectedPath(event.target.value)}><option value="">Choose a GMAT run…</option>{runs.map(run => <option key={run.path} value={run.path}>{missionTemplateDefinition(run.template).label} · {run.label}</option>)}</select></label></section>{!selectedRun ? <div className="agent-empty-state">Run GMAT first. Results appear here once a real OEM ephemeris exists.</div> : null}{loading ? <div className="agent-empty-state">Loading saved GMAT time-series data…</div> : null}{error ? <div className="agent-empty-state">{error}</div> : null}{selectedRun && !loading && !error ? <><CesiumOrbitViewer runPath={selectedRun.path} />{selectedRunHasTimeSeries ? <section className="gmat-analysis-comparison-selector"><strong>Compare GMAT runs</strong><span>Cesium shows Run A only. Choose a second compatible run for the curves below.</span><label>Compare with<select disabled={!compatibleRuns.length} value={comparisonPath} onChange={event => setComparisonPath(event.target.value)}><option value="">No comparison</option>{compatibleRuns.map(run => <option key={run.path} value={run.path}>{run.label}</option>)}</select></label></section> : null}{opalisResult ? <OpalisResultsCard result={opalisResult} runs={runs.filter(run => opalisRunPaths.has(run.path))} /> : null}<section className="gmat-analysis-run-summary"><strong>{comparisonPath ? 'Run A / Run B comparison' : 'Selected GMAT run'}</strong><span>{selectedRunHasTimeSeries ? `${primarySamples.length} real time-series samples from ${selectedRun.label}${comparisonPath ? ` · ${comparisonSamples.length} samples from ${compatibleRuns.find(run => run.path === comparisonPath)?.label ?? 'Run B'}` : ''}` : `Real OEM trajectory from ${selectedRun.label}`}</span>{deltas.length ? <div className="gmat-analysis-comparison-deltas">{deltas.map(delta => <span key={delta.key}>Δ final {METRICS[delta.key].label}: {delta.value >= 0 ? '+' : ''}{axisValue(delta.value)} {METRICS[delta.key].unit}</span>)}</div> : null}</section>{metrics.map(key => { const range = metricRange(primarySamples, key); return <section key={key}><strong>{METRICS[key].label} vs elapsed time</strong><span>GMAT report output · same axis for all selected runs</span><LineChart metric={key} series={series} />{range ? <div className="gmat-analysis-metrics"><span>Run A minimum: {axisValue(range.minimum)} {METRICS[key].unit}</span><span>Run A maximum: {axisValue(range.maximum)} {METRICS[key].unit}</span></div> : null}</section> })}{selectedRunHasTimeSeries && !isElectric && summary ? <div className="gmat-analysis-metric-picker">{available.map(key => <button className={selectedMetric === key ? 'active' : ''} key={key} onClick={() => setMetric(key)} type="button">{METRICS[key].label}</button>)}</div> : null}</> : null}</div>
}
