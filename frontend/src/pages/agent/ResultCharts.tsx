import type { ResultSample } from './runResultsApi'

type Metric =
  | 'altitudeKm'
  | 'eccentricity'
  | 'fuelMassKg'
  | 'massFlowRateKgPerSec'
  | 'powerAvailableKw'
  | 'semiMajorAxisKm'

type ChartSeries = {
  color: string
  label: string
  samples: ResultSample[]
}

const METRICS: Record<Metric, { label: string; unit: string }> = {
  altitudeKm: { label: 'Altitude', unit: 'km' },
  eccentricity: { label: 'Eccentricity', unit: '' },
  fuelMassKg: { label: 'Fuel mass', unit: 'kg' },
  massFlowRateKgPerSec: { label: 'Mass flow rate', unit: 'kg/s' },
  powerAvailableKw: { label: 'Thrust power available', unit: 'kW' },
  semiMajorAxisKm: { label: 'Semi-major axis', unit: 'km' },
}

const RESULT_METRICS: Metric[] = [
  'altitudeKm',
  'semiMajorAxisKm',
  'eccentricity',
  'fuelMassKg',
  'powerAvailableKw',
  'massFlowRateKgPerSec',
]

function hasMetric(sample: ResultSample, metric: Metric): sample is ResultSample & Record<Metric, number> {
  return typeof sample[metric] === 'number' && Number.isFinite(sample[metric])
}

function axisTicks(minimum: number, maximum: number, count = 5) {
  const span = maximum - minimum || 1
  return Array.from({ length: count + 1 }, (_, index) => minimum + (span * index) / count)
}

function axisValue(value: number) {
  const magnitude = Math.abs(value)
  if (magnitude > 0 && magnitude < 0.01) return value.toExponential(2)
  if (magnitude >= 1000) return value.toFixed(0)
  if (magnitude >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

function metricRange(samples: ResultSample[], metric: Metric) {
  const values = samples.filter(sample => hasMetric(sample, metric)).map(sample => sample[metric])
  if (!values.length) return null

  return values.reduce(
    (range, value) => ({ maximum: Math.max(range.maximum, value), minimum: Math.min(range.minimum, value) }),
    { maximum: Number.NEGATIVE_INFINITY, minimum: Number.POSITIVE_INFINITY },
  )
}

function LineChart({ metric, series }: { metric: Metric; series: ChartSeries[] }) {
  const width = 760
  const height = 300
  const margin = { bottom: 58, left: 74, right: 24, top: 26 }
  const chartWidth = width - margin.left - margin.right
  const chartHeight = height - margin.top - margin.bottom
  const usable = series
    .map(entry => ({ ...entry, samples: entry.samples.filter(sample => hasMetric(sample, metric)) }))
    .filter(entry => entry.samples.length)
  const samples = usable.flatMap(entry => entry.samples)

  if (!samples.length) {
    return <p className="gmat-analysis-note">This GMAT report does not contain {METRICS[metric].label.toLowerCase()} samples.</p>
  }

  const { xMin, xMax, yMin, yMax } = samples.reduce(
    (range, sample) => ({
      xMin: Math.min(range.xMin, sample.elapsedDays),
      xMax: Math.max(range.xMax, sample.elapsedDays),
      yMin: Math.min(range.yMin, sample[metric]),
      yMax: Math.max(range.yMax, sample[metric]),
    }),
    { xMin: Infinity, xMax: -Infinity, yMin: Infinity, yMax: -Infinity },
  )
  const xSpan = xMax - xMin || 1
  const ySpan = yMax - yMin || 1
  const x = (value: number) => margin.left + ((value - xMin) / xSpan) * chartWidth
  const y = (value: number) => margin.top + chartHeight - ((value - yMin) / ySpan) * chartHeight
  const xTicks = axisTicks(xMin, xMax)
  const yTicks = axisTicks(yMin, yMax)
  const unit = METRICS[metric].unit

  return <>
    <svg aria-label={`${METRICS[metric].label} from GMAT output`} className="gmat-analysis-chart" viewBox={`0 0 ${width} ${height}`} role="img">
      <g className="gmat-analysis-grid">
        {yTicks.map(tick => <line key={`y-${tick}`} x1={margin.left} x2={width - margin.right} y1={y(tick)} y2={y(tick)} />)}
        {xTicks.map(tick => <line key={`x-${tick}`} x1={x(tick)} x2={x(tick)} y1={margin.top} y2={height - margin.bottom} />)}
      </g>
      <line x1={margin.left} x2={margin.left} y1={margin.top} y2={height - margin.bottom} />
      <line x1={margin.left} x2={width - margin.right} y1={height - margin.bottom} y2={height - margin.bottom} />
      {yTicks.map(tick => <text key={`yl-${tick}`} textAnchor="end" x={margin.left - 8} y={y(tick) + 4}>{axisValue(tick)}</text>)}
      {xTicks.map(tick => <text key={`xl-${tick}`} textAnchor="middle" x={x(tick)} y={height - margin.bottom + 20}>{axisValue(tick)}</text>)}
      <text textAnchor="middle" x={margin.left + chartWidth / 2} y={height - 10}>Elapsed time (days)</text>
      <text textAnchor="middle" transform={`translate(18 ${margin.top + chartHeight / 2}) rotate(-90)`}>{METRICS[metric].label}{unit ? ` (${unit})` : ''}</text>
      {usable.map(entry => (
        <polyline
          fill="none"
          key={entry.label}
          points={entry.samples.map(sample => `${x(sample.elapsedDays)},${y(sample[metric])}`).join(' ')}
          stroke={entry.color}
          strokeWidth="3"
        />
      ))}
    </svg>
    {usable.length > 1 ? <div className="gmat-analysis-legend">{usable.map(entry => <span key={entry.label}><i style={{ background: entry.color }} />{entry.label}</span>)}</div> : null}
  </>
}

/** Renders immutable time-series artifacts only; it never triggers a new GMAT calculation. */
export function ResultCharts({ samples, comparison = [], label, comparisonLabel }: {
  samples: ResultSample[]
  comparison?: ResultSample[]
  label: string
  comparisonLabel?: string
}) {
  const series: ChartSeries[] = [
    { color: '#60a5fa', label, samples },
    ...(comparisonLabel ? [{ color: '#f59e0b', label: comparisonLabel, samples: comparison }] : []),
  ]

  if (!samples.length) {
    return <p className="results-notice">No saved GMAT time-series data for this run. Its summary and discussion remain available.</p>
  }

  return <div className="gmat-analysis-panel results-charts">
    {RESULT_METRICS.filter(metric => samples.some(sample => hasMetric(sample, metric))).map(metric => {
      const range = metricRange(samples, metric)!
      return <section key={metric}>
        <strong>{METRICS[metric].label} vs elapsed time</strong>
        <span>Saved GMAT output · elapsed time in days</span>
        <LineChart metric={metric} series={series} />
        <div className="gmat-analysis-metrics">
          <span>Minimum: {axisValue(range.minimum)} {METRICS[metric].unit}</span>
          <span>Maximum: {axisValue(range.maximum)} {METRICS[metric].unit}</span>
        </div>
      </section>
    })}
  </div>
}
