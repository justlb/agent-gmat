import { joinApiPath } from "../../app/apiBase"

async function responseError(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown }
  return typeof payload.error === "string"
    ? payload.error
    : typeof payload.message === "string"
      ? payload.message
      : "Simu-CIC request failed: " + response.status
}

export async function runSimuCic(runPath: string) {
  const response = await fetch(joinApiPath(undefined, "/opalis/simu-cic/run"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<{ cicSatDir: string; scenarioPath: string | null }>
}

export async function convertSimuCicEphemeris(runPath: string) {
  const response = await fetch(joinApiPath(undefined, "/opalis/simu-cic/convert-ephemeris"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<{ convertedEphemeris: string; sourceEphemeris: string }>
}

export async function openSimuCicGui(runPath: string) {
  const response = await fetch(joinApiPath(undefined, "/opalis/simu-cic/open-gui"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await responseError(response))
}

export async function prepareOpalisScenario(runPath: string) {
  const response = await fetch(joinApiPath(undefined, "/opalis/prepare-scenario"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<{ parameters: string; scenario: string; summary: string }>
}

export async function runOpalisScenario(runPath: string) {
  const response = await fetch(joinApiPath(undefined, "/opalis/run-scenario"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<{ parameters: string; scenario: string; summary: string }>
}

export type RunWorkflowStatus = 'not_started' | 'running' | 'completed' | 'failed'
export type RunWorkflowLog = {
  updated_at: string
  stages: {
    gmat: { message: string | null; status: RunWorkflowStatus; updated_at: string | null }
    simu_cic: { message: string | null; status: RunWorkflowStatus; updated_at: string | null }
    opalis: { message: string | null; status: RunWorkflowStatus; updated_at: string | null }
    rf_comlink: { message: string | null; status: RunWorkflowStatus; updated_at: string | null }
  }
}

export async function getRunWorkflowLog(runPath: string) {
  const response = await fetch(joinApiPath(undefined, "/opalis/workflow-status"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return (await response.json() as { workflow: RunWorkflowLog }).workflow
}

export async function cancelGmatCalculations(runPath?: string) {
  const response = await fetch(joinApiPath(undefined, "/gmat/cancel-calculations"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(runPath ? { runPath } : {}),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<{ cancelled: number }>
}

export type OpalisResultSummary = {
  alerts: Array<{ level: 'info' | 'warning'; message: string }>
  completionPercent: number | null
  computedDurationSeconds: number | null
  finalSocPercent: number | null
  initialBatteryVoltageV: number | null
  initialSocPercent: number | null
  lowVoltageLimitV: number | null
  maxDepthOfDischargePercent: number | null
  orbitCount: number | null
  resultRows: number | null
  satelliteName: string | null
  simulationExecuted: boolean
  solarArrayEnergy: number | null
  solarSections: number | null
  stopCondition: string | null
  timeStepSeconds: number | null
  voltageControlMode: string | null
}

export type OpalisTimeSeriesSample = {
  battery_voltage_v?: number
  depth_of_discharge_percent?: number
  index: number
  soc_percent?: number
  solar_energy_wh?: number
  time_seconds?: number
}

export type OpalisTimeSeries = {
  availableRowProperties: string[]
  sampleIntervalRows: number | null
  samples: OpalisTimeSeriesSample[]
  sourceRowCount: number
}

export async function getOpalisResults(runPath: string) {
  const query = new URLSearchParams({ runPath }).toString()
  const response = await fetch(`${joinApiPath(undefined, '/opalis/results')}?${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(await responseError(response))
  const payload = await response.json() as { result: OpalisResultSummary }
  return payload.result
}

export async function getOpalisTimeSeries(runPath: string) {
  const query = new URLSearchParams({ runPath }).toString()
  const response = await fetch(`${joinApiPath(undefined, '/opalis/timeseries')}?${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(await responseError(response))
  const payload = await response.json() as { result: OpalisTimeSeries }
  return { ...payload.result, runPath }
}

export async function openPreparedOpalisScenario(runPath: string) {
  const response = await fetch(joinApiPath(undefined, "/opalis/open-prepared-scenario"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await responseError(response))
}
