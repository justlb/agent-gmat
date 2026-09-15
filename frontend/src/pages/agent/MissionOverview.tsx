import type { RunView } from './runViewApi'
import { RESULT_STAGES, type ResultWorkflow } from './runResultsApi'
const rows = [
  ['simulatedMissionDuration', 'Simulated mission duration', 'gmat'], ['terminationCondition', 'GMAT termination condition', 'gmat'], ['fuelMassConsumed', 'Fuel mass consumed', 'gmat'],
  ['averageAltitude', 'Average reported altitude', 'gmat'], ['contactTime', 'Contact time with GS', 'simu_cic'],
  ['latency', 'Latency (one-way / round-trip)', 'simu_cic'], ['eclipseTime', 'Eclipse time', 'simu_cic'],
  ['electricalConfiguration', 'Electrical assessment', 'opalis'],
  ['rfTelecommand', 'Telecommand link', 'rf_comlink'],
  ['rfHousekeepingTelemetry', 'Housekeeping telemetry link', 'rf_comlink'],
  ['rfPayloadTelemetry', 'Payload telemetry link', 'rf_comlink'],
] as const

/** Shared by New simulation and Results so the same run evidence has the same presentation. */
export function MissionOverview({ overview, stages = {}, saved = false, compact = false }: {
  overview?: RunView['overview'] | null
  stages?: ResultWorkflow['stages']
  saved?: boolean
  compact?: boolean
}) {
  return <section className="mission-v2-card mission-v2-overview">
    <span>KEY MISSION RESULTS</span><h2>Mission overview</h2>
    <p>{saved ? 'Saved engineering indicators for the selected run.' : 'Live engineering indicators for this run.'}</p>
    <div className="mission-v2-metrics">{rows.map(([key, label, stage]) => {
      const status = stages[stage]?.status ?? (saved ? 'unknown' : 'not_started')
      const reported = overview?.[key]
      const tool = RESULT_STAGES.find(([id]) => id === stage)![1]
      const finished = status === 'failed' || status === 'completed' || status === 'not_visible' || status === 'unknown'
      const fallback = status === 'not_visible' ? 'Ground station not visible' : finished ? 'Unavailable' : status === 'running' ? `${tool} running` : `Waiting for ${tool}`
      // Missing evidence is not "waiting" after a stage has finished or failed.
      const value = reported && !(finished && reported.value.startsWith('Waiting')) ? reported.value : fallback
      return <div key={key} className={`metric-${status}`}><label>{label}</label><b title={reported?.source}>{value}</b>{!compact && reported?.detail ? <small>{reported.detail}</small> : null}{!compact ? <small>{tool} calculation: {status.replaceAll('_', ' ')}</small> : null}</div>
    })}</div>
  </section>
}
