import type { RunView } from './runViewApi'
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
  'fuelMassKg',
  'massFlowRateKgPerSec',
]

// Threshold lines drawn on time-series charts. `transform` converts raw missionValues to chart units.
const THRESHOLDS: Partial<Record<Metric, { key: string; label: string; transform?: (v: number) => number }[]>> = {
  altitudeKm: [
    { key: 'initialOrbit.altitudeKm', label: 'Base altitude' },
    { key: 'stationKeeping.targetSmaKm', label: 'Target altitude', transform: sma => sma - 6378.1363 },
    { key: 'stationKeeping.minimumAltitudeKm', label: 'Reboost threshold' },
    { key: 'endOfLife.finalAltitudeKm', label: 'Final altitude' },
    { key: 'transfer.finalAltitudeKm', label: 'Target altitude' },
  ],
  fuelMassKg: [
    { key: 'stationKeeping.fuelReserveKg', label: 'Fuel reserve' },
  ],
}

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

/** Parse overview scalar values like "12.50 min" or "Beijing: 12.50 min; Svalbard: 8.30 min" into structured data. */
function parsePerStation(value: string): { station: string; minutes: number }[] {
  // Format: "Station1: 12.50 min; Station2: 8.30 min" or just "12.50 min"
  if (!value) return []
  const parts = value.split(';').map(s => s.trim())
  return parts.map(part => {
    const match = part.match(/^(?:(.+?):\s*)?([\d.]+)\s*min$/u)
    if (!match) return null
    return { station: match[1] ?? 'Contact', minutes: parseFloat(match[2]) }
  }).filter((x): x is { station: string; minutes: number } => x !== null)
}

/** Parses normalized Simu-CIC values written by the backend, for example
 * "kourou: 4.20 min/rev". These values make runs of different duration comparable. */
function parsePerRevolution(value: string): { station: string; minutes: number }[] {
  if (!value) return []
  return value.split(';').map(part => {
    const match = part.trim().match(/^(?:(.+?):\s*)?([\d.]+)\s*min\/rev$/u)
    return match ? { station: match[1] ?? 'Mission', minutes: parseFloat(match[2]) } : null
  }).filter((item): item is { station: string; minutes: number } => item !== null)
}

function LineChart({ metric, series, thresholds = [] }: {
  metric: Metric
  series: ChartSeries[]
  thresholds?: { value: number; label: string; color: string }[]
}) {
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

  // Compute Y range including thresholds so they're always visible.
  const dataMin = Math.min(...samples.map(s => s[metric]))
  const dataMax = Math.max(...samples.map(s => s[metric]))
  const thresholdValues = thresholds.map(t => t.value)
  const yMin = Math.min(dataMin, ...thresholdValues)
  const yMax = Math.max(dataMax, ...thresholdValues)

  const xMin = Math.min(...samples.map(s => s.elapsedDays))
  const xMax = Math.max(...samples.map(s => s.elapsedDays))
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
      {/* Threshold lines */}
      {thresholds.map(t => (
        <g key={t.label}>
          <line x1={margin.left} x2={width - margin.right} y1={y(t.value)} y2={y(t.value)} stroke={t.color} strokeWidth="2" strokeDasharray="8 4" />
          <text x={width - margin.right - 4} y={y(t.value) - 5} textAnchor="end" fill={t.color} fontSize="10" fontWeight="700">{t.label}: {axisValue(t.value)} {unit}</text>
        </g>
      ))}
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

// --- Bar chart components ---

function BarChart({ title, subtitle, bars, unit, color = '#60a5fa' }: {
  title: string
  subtitle: string
  bars: { label: string; value: number; color?: string }[]
  unit: string
  color?: string
}) {
  if (!bars.length || bars.every(b => b.value === 0)) {
    return <p className="results-notice">No {title.toLowerCase()} data available for this run.</p>
  }
  const maxVal = Math.max(...bars.map(b => b.value))
  const width = 760
  const barHeight = 22
  const gap = 6
  const labelWidth = 140
  const chartWidth = width - labelWidth - 60
  const totalHeight = bars.length * (barHeight + gap) + 40

  return <section className="results-bar-chart">
    <strong>{title}</strong>
    <span>{subtitle}</span>
    <svg viewBox={`0 0 ${width} ${totalHeight}`} className="gmat-analysis-chart" role="img" aria-label={title}>
      {bars.map((bar, i) => {
        const barY = i * (barHeight + gap) + 10
        const barW = maxVal > 0 ? (bar.value / maxVal) * chartWidth : 0
        const barColor = bar.color ?? color
        return <g key={bar.label}>
          <text x={0} y={barY + barHeight / 2 + 4} fontSize="11" fill="#9fb3cb">{bar.label}</text>
          <rect x={labelWidth} y={barY} width={chartWidth} height={barHeight} fill="rgba(56,189,248,.07)" rx="3" />
          <rect x={labelWidth} y={barY} width={barW} height={barHeight} fill={barColor} rx="3" />
          <text x={labelWidth + barW + 8} y={barY + barHeight / 2 + 4} fontSize="11" fill={barColor} fontWeight="700">{axisValue(bar.value)} {unit}</text>
        </g>
      })}
    </svg>
  </section>
}

/** Fuel budget bar chart: consumed vs remaining vs reserve, per run. */
function FuelBudgetChart({ runs, views, seriesColors }: {
  runs: { runId: string; runPath: string }[]
  views: Record<string, RunView | null>
  seriesColors: string[]
}) {
  const bars: { label: string; value: number; color?: string }[] = []
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]
    const overview = views[run.runPath]?.overview
    const missionValues = views[run.runPath]?.missionValues
    if (!overview || !missionValues) continue

    // Fuel consumed: parse from overview.fuelMassConsumed (e.g. "3.20 kg")
    const consumedStr = overview.fuelMassConsumed?.value ?? ''
    const consumedMatch = consumedStr.match(/([\d.]+)\s*kg/u)
    const consumed = consumedMatch ? parseFloat(consumedMatch[1]) : 0

    // Initial fuel from missionValues
    const initialFuel = typeof missionValues['spacecraft.initialFuelMassKg'] === 'number'
      ? missionValues['spacecraft.initialFuelMassKg']
      : null
    const remaining = initialFuel !== null ? Math.max(0, initialFuel - consumed) : 0
    const reserve = typeof missionValues['stationKeeping.fuelReserveKg'] === 'number'
      ? missionValues['stationKeeping.fuelReserveKg']
      : 0

    const color = seriesColors[i % seriesColors.length]
    bars.push({ label: `${run.runId} consumed`, value: consumed, color })
    bars.push({ label: `${run.runId} remaining`, value: remaining, color })
    if (reserve > 0) bars.push({ label: `${run.runId} reserve`, value: reserve, color: '#f87171' })
  }

  if (!bars.length) return null
  return <BarChart title="Fuel budget" subtitle="Consumed vs remaining vs reserve per run" bars={bars} unit="kg" />
}

/** Eclipse duration bar chart per run. */
function EclipseChart({ runs, views, seriesColors }: {
  runs: { runId: string; runPath: string }[]
  views: Record<string, RunView | null>
  seriesColors: string[]
}) {
  const bars: { label: string; value: number; color?: string }[] = []
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]
    const overview = views[run.runPath]?.overview
    if (!overview?.eclipseTime) continue
    const match = overview.eclipseTime.value.match(/([\d.]+)\s*min/u)
    if (!match) continue
    bars.push({ label: run.runId, value: parseFloat(match[1]), color: seriesColors[i % seriesColors.length] })
  }
  if (!bars.length) return null
  return <BarChart title="Eclipse duration" subtitle="Cumulative Earth eclipse time per run" bars={bars} unit="min" />
}

/** Contact time per station bar chart. Supports multi-station values. */
function ContactTimeChart({ runs, views, seriesColors }: {
  runs: { runId: string; runPath: string }[]
  views: Record<string, RunView | null>
  seriesColors: string[]
}) {
  const bars: { label: string; value: number; color?: string }[] = []
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i]
    const overview = views[run.runPath]?.overview
    if (!overview?.contactTime) continue
    const stations = parsePerStation(overview.contactTime.value)
    for (const s of stations) {
      bars.push({ label: `${run.runId} · ${s.station}`, value: s.minutes, color: seriesColors[i % seriesColors.length] })
    }
  }
  if (!bars.length) return null
  return <BarChart title="Ground station contact time" subtitle="Cumulative visibility time per station per run" bars={bars} unit="min" />
}

/** Normalizes total Simu-CIC eclipse time by the GMAT OEM revolution count. */
function EclipsePerRevolutionChart({ runs, views, seriesColors }: {
  runs: { runId: string; runPath: string }[]
  views: Record<string, RunView | null>
  seriesColors: string[]
}) {
  const bars = runs.flatMap((run, index) => {
    const value = views[run.runPath]?.overview.eclipseTimePerRevolution?.value ?? ''
    const parsed = parsePerRevolution(value)[0]
    return parsed ? [{ label: run.runId, value: parsed.minutes, color: seriesColors[index % seriesColors.length] }] : []
  })
  return bars.length ? <BarChart title="Eclipse time per revolution" subtitle="Simu-CIC eclipse duration ÷ estimated GMAT revolutions" bars={bars} unit="min/rev" /> : null
}

/** Shows each station's visibility time per GMAT revolution, so mission length
 * cannot dominate the comparison. */
function ContactTimePerRevolutionChart({ runs, views, seriesColors }: {
  runs: { runId: string; runPath: string }[]
  views: Record<string, RunView | null>
  seriesColors: string[]
}) {
  const bars = runs.flatMap((run, index) => parsePerRevolution(views[run.runPath]?.overview.contactTimePerRevolution?.value ?? '')
    .map(station => ({ label: `${run.runId} · ${station.station}`, value: station.minutes, color: seriesColors[index % seriesColors.length] })))
  return bars.length ? <BarChart title="Ground-station contact per revolution" subtitle="Simu-CIC visibility duration ÷ estimated GMAT revolutions" bars={bars} unit="min/rev" /> : null
}

const SERIES_COLORS = ['#60a5fa', '#f59e0b', '#34d399', '#f87171', '#c084fc']
const THRESHOLD_COLORS = { base: '#34d399', target: '#fbbf24', danger: '#f87171', final: '#c084fc' }

/** Renders immutable time-series artifacts only; it never triggers a new GMAT calculation. */
export function ResultCharts({ series, runs, views }: {
  series: { label: string; samples: ResultSample[]; color?: string }[]
  runs?: { runId: string; runPath: string }[]
  views?: Record<string, RunView | null>
}) {
  const colored = series.map((entry, index) => ({
    ...entry,
    color: entry.color ?? SERIES_COLORS[index % SERIES_COLORS.length],
  }))

  if (!colored.some(entry => entry.samples.length)) {
    return <p className="results-notice">No saved GMAT time-series data for this run. Its summary and discussion remain available.</p>
  }

  const primary = colored.find(entry => entry.samples.length)?.samples ?? []
  const missionValues = runs && views ? views[runs[0]?.runPath]?.missionValues : null

  // Build threshold lines for metrics that support them.
  const buildThresholds = (metric: Metric): { value: number; label: string; color: string }[] => {
    const config = THRESHOLDS[metric]
    if (!config || !missionValues) return []
    return config.map(t => {
      const raw = missionValues[t.key]
      if (typeof raw !== 'number' || raw === 0) return null
      const value = t.transform ? t.transform(raw) : raw
      const color = t.key.includes('initial') ? THRESHOLD_COLORS.base
        : t.key.includes('target') ? THRESHOLD_COLORS.target
        : t.key.includes('minimum') ? THRESHOLD_COLORS.danger
        : THRESHOLD_COLORS.final
      return { value, label: t.label, color }
    }).filter((x): x is { value: number; label: string; color: string } => x !== null)
  }

  // Has at least one bar chart to show?
  const hasBarCharts = runs && views && runs.length > 0

  return <div className="gmat-analysis-panel results-charts">
    {RESULT_METRICS.filter(metric => primary.some(sample => hasMetric(sample, metric))).map(metric => {
      const range = metricRange(primary, metric)!
      return <section key={metric}>
        <strong>{METRICS[metric].label} vs elapsed time</strong>
        <span>Saved GMAT output · elapsed time in days</span>
        <LineChart metric={metric} series={colored} thresholds={buildThresholds(metric)} />
        <div className="gmat-analysis-metrics">
          <span>Minimum: {axisValue(range.minimum)} {METRICS[metric].unit}</span>
          <span>Maximum: {axisValue(range.maximum)} {METRICS[metric].unit}</span>
        </div>
      </section>
    })}
    {/* Bar charts — only when runs/views are provided */}
    {hasBarCharts && runs && views ? <>
      <FuelBudgetChart runs={runs} views={views} seriesColors={SERIES_COLORS} />
      <EclipseChart runs={runs} views={views} seriesColors={SERIES_COLORS} />
      <ContactTimeChart runs={runs} views={views} seriesColors={SERIES_COLORS} />
      <EclipsePerRevolutionChart runs={runs} views={views} seriesColors={SERIES_COLORS} />
      <ContactTimePerRevolutionChart runs={runs} views={views} seriesColors={SERIES_COLORS} />
    </> : null}
  </div>
}
