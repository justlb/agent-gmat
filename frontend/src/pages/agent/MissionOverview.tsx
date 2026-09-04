import type { RunView } from './runViewApi'

export const RESULT_STAGES = [['gmat', 'GMAT'], ['simu_cic', 'Simu-CIC'], ['opalis', 'OPALIS'], ['rf_comlink', 'RF-COMLINK']] as const
export type ResultWorkflow = { stages: Partial<Record<(typeof RESULT_STAGES)[number][0], { status: string; message?: string | null }>> }
const rows = [
  ['lifetime', 'Lifetime', 'gmat'], ['fuelMassConsumed', 'Fuel mass consumed', 'gmat'],
  ['averageAltitude', 'Average altitude', 'gmat'], ['contactTime', 'Contact time with GS', 'simu_cic'],
  ['latency', 'Latency (one-way / round-trip)', 'simu_cic'], ['eclipseTime', 'Eclipse time', 'simu_cic'],
  ['electricalConfiguration', 'Electrical configuration OK?', 'opalis'],
] as const

/** Shared by New simulation and Results so the same run evidence has the same presentation. */
export function MissionOverview({ overview, stages = {}, saved = false }: {
  overview?: RunView['overview'] | null
  stages?: ResultWorkflow['stages']
  saved?: boolean
}) {
  return <section className="mission-v2-card mission-v2-overview">
    <span>KEY MISSION RESULTS</span><h2>Mission overview</h2>
    <p>{saved ? 'Saved engineering indicators for the selected run.' : 'Live engineering indicators for this run.'}</p>
    <div className="mission-v2-metrics">{rows.map(([key, label, stage]) => {
      const status = stages[stage]?.status ?? 'not_started'
      const reported = overview?.[key]
      const tool = RESULT_STAGES.find(([id]) => id === stage)![1]
      const fallback = status === 'failed' ? 'Unavailable' : status === 'running' ? `${tool} running` : `Waiting for ${tool}`
      // Never show a misleading "waiting" label for an already failed stage.
      const value = reported && !(status === 'failed' && reported.value.startsWith('Waiting')) ? reported.value : fallback
      return <div key={key} className={`metric-${status}`}><label>{label}</label><b title={reported?.source}>{value}</b><small>{status.replaceAll('_', ' ')}</small></div>
    })}</div>
  </section>
}
