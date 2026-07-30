import { useEffect, useMemo, useState } from 'react'
import { getOrbitKeepingTimeSeries, type OrbitKeepingTimeSeriesSample } from './orbitKeepingApi'

function LineChart({ samples }: { samples: OrbitKeepingTimeSeriesSample[] }) {
  const width = 760
  const height = 260
  const padding = 34
  const altitudes = samples.map(sample => sample.altitudeKm)
  const min = Math.min(...altitudes)
  const max = Math.max(...altitudes)
  const span = max - min || 1
  const points = samples.map((sample, index) => {
    const x = padding + (index / Math.max(samples.length - 1, 1)) * (width - padding * 2)
    const y = height - padding - ((sample.altitudeKm - min) / span) * (height - padding * 2)
    return `${x},${y}`
  }).join(' ')
  return (
    <svg aria-label="Altitude over GMAT report samples" className="gmat-analysis-chart" viewBox={`0 0 ${width} ${height}`} role="img">
      <line x1={padding} x2={padding} y1={padding} y2={height - padding} />
      <line x1={padding} x2={width - padding} y1={height - padding} y2={height - padding} />
      <text x={padding} y={20}>{max.toFixed(2)} km</text>
      <text x={padding} y={height - 8}>{min.toFixed(2)} km</text>
      <polyline fill="none" points={points} stroke="currentColor" strokeWidth="3" />
    </svg>
  )
}

export function GmatAnalysisPanel({ runPath }: { runPath?: string }) {
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [samples, setSamples] = useState<OrbitKeepingTimeSeriesSample[]>([])
  useEffect(() => {
    if (!runPath) {
      setSamples([])
      return
    }
    setLoading(true)
    setError('')
    void getOrbitKeepingTimeSeries(runPath)
      .then(setSamples)
      .catch(reason => setError(reason instanceof Error ? reason.message : 'Unable to load GMAT analysis data'))
      .finally(() => setLoading(false))
  }, [runPath])
  const summary = useMemo(() => samples.length ? {
    minimum: Math.min(...samples.map(sample => sample.altitudeKm)),
    maximum: Math.max(...samples.map(sample => sample.altitudeKm)),
  } : null, [samples])

  if (!runPath) return <div className="agent-empty-state">Select a GMAT run in Files, then open this analysis tab.</div>
  if (loading) return <div className="agent-empty-state">Loading GMAT report data…</div>
  if (error) return <div className="agent-empty-state">{error}</div>
  if (!samples.length) return <div className="agent-empty-state">This run has no time-series report. Generate a new GMAT run with the current template.</div>
  return (
    <div className="gmat-analysis-panel">
      <section>
        <strong>Altitude vs report sample</strong>
        <span>{samples.length} deterministic GMAT samples</span>
        <LineChart samples={samples} />
      </section>
      {summary ? <div className="gmat-analysis-metrics">
        <span>Minimum altitude: {summary.minimum.toFixed(3)} km</span>
        <span>Maximum altitude: {summary.maximum.toFixed(3)} km</span>
        <span>Final fuel: {samples.at(-1)?.fuelMassKg.toFixed(3)} kg</span>
      </div> : null}
    </div>
  )
}
