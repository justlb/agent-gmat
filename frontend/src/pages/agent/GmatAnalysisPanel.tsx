import { useEffect, useMemo, useState } from 'react'
import { getElectricPropulsionTimeSeries, type ElectricPropulsionTimeSeriesSample } from './electricPropulsionApi'
import { getOrbitKeepingTimeSeries, type OrbitKeepingTimeSeriesSample } from './orbitKeepingApi'
import { getOpalisResults, type OpalisResultSummary } from './simuCicApi'

type Metric = 'altitudeKm' | 'eccentricity' | 'fuelMassKg' | 'massFlowRateKgPerSec' | 'powerAvailableKw' | 'semiMajorAxisKm'
type AnalysisSample = {
  altitudeKm?: number
  eccentricity: number
  elapsedDays: number
  fuelMassKg: number
  massFlowRateKgPerSec?: number
  powerAvailableKw?: number
  semiMajorAxisKm: number
}

const METRICS: Record<Metric, { label: string; unit: string }> = {
  altitudeKm: { label: 'Altitude', unit: 'km' },
  eccentricity: { label: 'Eccentricity', unit: '' },
  fuelMassKg: { label: 'Fuel mass', unit: 'kg' },
  massFlowRateKgPerSec: { label: 'Mass flow rate', unit: 'kg/s' },
  powerAvailableKw: { label: 'Thrust power available', unit: 'kW' },
  semiMajorAxisKm: { label: 'Semi-major axis', unit: 'km' },
}
const ELECTRIC_TRANSFER_METRICS: Metric[] = ['semiMajorAxisKm', 'eccentricity', 'fuelMassKg', 'powerAvailableKw', 'massFlowRateKgPerSec']

function axisTicks(minimum: number, maximum: number, count = 5) {
  const span = maximum - minimum || 1
  return Array.from({ length: count + 1 }, (_, index) => minimum + span * index / count)
}
function axisValue(value: number) {
  const magnitude = Math.abs(value)
  if (magnitude > 0 && magnitude < 0.01) return value.toExponential(2)
  if (magnitude >= 1000) return value.toFixed(0)
  if (magnitude >= 10) return value.toFixed(1)
  return value.toFixed(2)
}
function hasMetric(sample: AnalysisSample, metric: Metric): sample is AnalysisSample & Record<Metric, number> {
  return typeof sample[metric] === 'number' && Number.isFinite(sample[metric])
}

function LineChart({ metric, samples }: { metric: Metric; samples: AnalysisSample[] }) {
  const width = 760
  const height = 300
  const margin = { bottom: 58, left: 74, right: 24, top: 26 }
  const chartWidth = width - margin.left - margin.right
  const chartHeight = height - margin.top - margin.bottom
  const chartSamples = samples.filter(sample => hasMetric(sample, metric))
  const xValues = chartSamples.map(sample => sample.elapsedDays)
  const yValues = chartSamples.map(sample => sample[metric])
  const xMinimum = Math.min(...xValues)
  const xMaximum = Math.max(...xValues)
  const yMinimum = Math.min(...yValues)
  const yMaximum = Math.max(...yValues)
  const xSpan = xMaximum - xMinimum || 1
  const ySpan = yMaximum - yMinimum || 1
  const x = (value: number) => margin.left + (value - xMinimum) / xSpan * chartWidth
  const y = (value: number) => margin.top + chartHeight - (value - yMinimum) / ySpan * chartHeight
  const points = chartSamples.map(sample => `${x(sample.elapsedDays)},${y(sample[metric])}`).join(' ')
  const xTicks = axisTicks(xMinimum, xMaximum)
  const yTicks = axisTicks(yMinimum, yMaximum)
  const unit = METRICS[metric].unit

  return (
    <svg aria-label={`${METRICS[metric].label} versus ElapsedDays`} className="gmat-analysis-chart" viewBox={`0 0 ${width} ${height}`} role="img">
      <g className="gmat-analysis-grid">
        {yTicks.map(tick => <line key={`y-grid-${tick}`} x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />)}
        {xTicks.map(tick => <line key={`x-grid-${tick}`} x1={x(tick)} x2={x(tick)} y1={margin.top} y2={height - margin.bottom} />)}
      </g>
      <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} />
      <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} />
      {yTicks.map(tick => <text key={`y-label-${tick}`} textAnchor="end" x={margin.left - 8} y={y(tick) + 4}>{axisValue(tick)}</text>)}
      {xTicks.map(tick => <text key={`x-label-${tick}`} textAnchor="middle" x={x(tick)} y={height - margin.bottom + 20}>{axisValue(tick)}</text>)}
      <text textAnchor="middle" x={margin.left + chartWidth / 2} y={height - 10}>ElapsedDays (days)</text>
      <text textAnchor="middle" transform={`translate(18 ${margin.top + chartHeight / 2}) rotate(-90)`}>{METRICS[metric].label}{unit ? ` (${unit})` : ''}</text>
      <polyline fill="none" points={points} stroke="currentColor" strokeWidth="3" />
    </svg>
  )
}

function orbitKeepingSamples(samples: OrbitKeepingTimeSeriesSample[]): AnalysisSample[] {
  const firstEpoch = samples[0]?.epochA1ModJulian ?? 0
  return samples.map(sample => ({
    altitudeKm: sample.altitudeKm,
    eccentricity: sample.eccentricity,
    elapsedDays: sample.epochA1ModJulian - firstEpoch,
    fuelMassKg: sample.fuelMassKg,
    semiMajorAxisKm: sample.semiMajorAxisKm,
  }))
}
function electricTransferSamples(samples: ElectricPropulsionTimeSeriesSample[]): AnalysisSample[] {
  return samples.map(sample => ({
    eccentricity: sample.eccentricity,
    elapsedDays: sample.elapsedDays,
    fuelMassKg: sample.fuelMassKg,
    massFlowRateKgPerSec: sample.massFlowRateKgPerSec,
    powerAvailableKw: sample.powerAvailableKw,
    semiMajorAxisKm: sample.semiMajorAxisKm,
  }))
}

function metricRange(samples: AnalysisSample[], metric: Metric) {
  const values = samples.filter(sample => hasMetric(sample, metric)).map(sample => sample[metric])
  return values.length ? { maximum: Math.max(...values), minimum: Math.min(...values) } : null
}

function metricValue(value: number | null, unit = '', digits = 1) {
  return value === null ? 'Unavailable' : `${value.toFixed(digits)}${unit ? ` ${unit}` : ''}`
}

function OpalisResultsCard({ result }: { result: OpalisResultSummary }) {
  return <section className="opalis-results-card">
    <strong>OPALIS electrical results</strong>
    <span>Calculated from this run&apos;s CIC ephemeris and satellite.json configuration.</span>
    <div className="gmat-analysis-metrics">
      <span>Initial SoC: {metricValue(result.initialSocPercent, '%')}</span>
      <span>Final SoC: {metricValue(result.finalSocPercent, '%')}</span>
      <span>Max depth of discharge: {metricValue(result.maxDepthOfDischargePercent, '%')}</span>
      <span>Solar energy: {metricValue(result.solarArrayEnergy, ' Wh', 2)}</span>
      <span>Solar sections: {metricValue(result.solarSections, '', 0)}</span>
      <span>Samples: {metricValue(result.resultRows, '', 0)}</span>
      <span>Computed duration: {metricValue(result.computedDurationSeconds === null ? null : result.computedDurationSeconds / 3600, ' h', 2)}</span>
    </div>
    <p className={result.stopCondition === 'eBattMin reached' ? 'opalis-result-warning' : 'opalis-result-info'}>Stop condition: {result.stopCondition ?? 'Unavailable'}</p>
    {result.alerts.map(alert => <p className={alert.level === 'warning' ? 'opalis-result-warning' : 'opalis-result-info'} key={alert.message}>{alert.message}</p>)}
  </section>
}

export function GmatAnalysisPanel({ runPath, template, runs = [] }: { runPath?: string; template?: 'electric-propulsion-transfer' | 'orbit-keeping'; runs?: Array<{ result: { finalFuelMassKg?: number; fuelUsedBetweenReportsKg?: number; minimumReportedAltitudeKm?: number; status: string }; runId: string }> }) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [metric, setMetric] = useState<Metric>('altitudeKm')
  const [samples, setSamples] = useState<AnalysisSample[]>([])
  const [opalisResult, setOpalisResult] = useState<OpalisResultSummary | null>(null)
  const isElectricTransfer = template ? template === 'electric-propulsion-transfer' : Boolean(runPath && /gmat[\\/]electric-propulsion-transfer[\\/]/u.test(runPath))
  const availableMetrics: Metric[] = isElectricTransfer ? ELECTRIC_TRANSFER_METRICS : ['altitudeKm', 'semiMajorAxisKm', 'fuelMassKg']
  const selectedMetric = availableMetrics.includes(metric) ? metric : availableMetrics[0]

  useEffect(() => {
    if (!runPath) {
      setSamples([])
      setOpalisResult(null)
      return
    }
    setLoading(true)
    setError('')
    const load = isElectricTransfer
      ? getElectricPropulsionTimeSeries(runPath).then(electricTransferSamples)
      : getOrbitKeepingTimeSeries(runPath).then(orbitKeepingSamples)
    void load
      .then(setSamples)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to load GMAT analysis data'))
      .finally(() => setLoading(false))
    void getOpalisResults(runPath).then(setOpalisResult).catch(() => setOpalisResult(null))
  }, [isElectricTransfer, runPath])

  const summary = useMemo(() => metricRange(samples, selectedMetric), [samples, selectedMetric])
  const electricMetrics = useMemo(() => ELECTRIC_TRANSFER_METRICS.filter(key => samples.some(sample => hasMetric(sample, key))), [samples])

  if (!runPath) return <div className="agent-empty-state">Select a GMAT run in Files, then open this analysis tab.</div>
  if (loading) return <div className="agent-empty-state">Loading GMAT report dataâ€¦</div>
  if (error) return <div className="agent-empty-state">{error}</div>
  if (!samples.length && !opalisResult) return <div className="agent-empty-state">This run has no GMAT time-series report or calculated OPALIS result.</div>
  return (
    <div className="gmat-analysis-panel">
      {opalisResult ? <OpalisResultsCard result={opalisResult} /> : null}
      {runs.length > 1 ? <section className="gmat-analysis-comparison">
        <strong>Linked run comparison</strong>
        <div>{runs.map(run => <span key={run.runId}>{run.runId} Â· {run.result.status} Â· min altitude {run.result.minimumReportedAltitudeKm?.toFixed(3) ?? 'â€”'} km Â· fuel used {run.result.fuelUsedBetweenReportsKg?.toFixed(3) ?? 'â€”'} kg</span>)}</div>
      </section> : null}
      {samples.length && isElectricTransfer ? <>
        <section className="gmat-electric-analysis-intro">
          <strong>Electric-propulsion diagnostics</strong>
          <span>{samples.length} deterministic GMAT samples - X axis: ElapsedDays (days)</span>
          {!electricMetrics.includes('massFlowRateKgPerSec') ? <span className="gmat-analysis-note">Mass-flow data is unavailable for this older run. Generate a new run to include it.</span> : null}
        </section>
        {electricMetrics.map(key => {
          const range = metricRange(samples, key)
          return <section key={key}>
            <strong>{METRICS[key].label} vs ElapsedDays</strong>
            <span>{samples.filter(sample => hasMetric(sample, key)).length} samples - X axis: ElapsedDays (days)</span>
            <LineChart metric={key} samples={samples} />
            {range ? <div className="gmat-analysis-metrics">
              <span>Minimum: {axisValue(range.minimum)} {METRICS[key].unit}</span>
              <span>Maximum: {axisValue(range.maximum)} {METRICS[key].unit}</span>
            </div> : null}
          </section>
        })}
      </> : null}
      {samples.length && !isElectricTransfer ? <>
      <section>
        <strong>{METRICS[selectedMetric].label} vs ElapsedDays</strong>
        <span>{samples.length} deterministic GMAT samples · X axis: ElapsedDays (days)</span>
        <div className="gmat-analysis-metric-picker">{availableMetrics.map(key => <button className={selectedMetric === key ? 'active' : ''} key={key} onClick={() => setMetric(key)} type="button">{METRICS[key].label}</button>)}</div>
        <LineChart metric={selectedMetric} samples={samples} />
      </section>
      {summary ? <div className="gmat-analysis-metrics">
        <span>Minimum {METRICS[selectedMetric].label.toLowerCase()}: {summary.minimum.toFixed(3)} {METRICS[selectedMetric].unit}</span>
        <span>Maximum {METRICS[selectedMetric].label.toLowerCase()}: {summary.maximum.toFixed(3)} {METRICS[selectedMetric].unit}</span>
        <span>Final fuel: {samples.at(-1)?.fuelMassKg.toFixed(3)} kg</span>
      </div> : null}
      </> : <div className="gmat-analysis-metrics"><span>Final fuel: {samples.at(-1)?.fuelMassKg.toFixed(3)} kg</span></div>}
    </div>
  )
}
