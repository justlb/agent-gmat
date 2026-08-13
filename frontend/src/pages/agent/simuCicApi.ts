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

export type OpalisResultSummary = {
  alerts: Array<{ level: 'info' | 'warning'; message: string }>
  computedDurationSeconds: number | null
  finalSocPercent: number | null
  initialSocPercent: number | null
  maxDepthOfDischargePercent: number | null
  resultRows: number | null
  simulationExecuted: boolean
  solarArrayEnergy: number | null
  solarSections: number | null
  stopCondition: string | null
}

export async function getOpalisResults(runPath: string) {
  const query = new URLSearchParams({ runPath }).toString()
  const response = await fetch(`${joinApiPath(undefined, '/opalis/results')}?${query}`, { cache: 'no-store' })
  if (!response.ok) throw new Error(await responseError(response))
  const payload = await response.json() as { result: OpalisResultSummary }
  return payload.result
}

export async function openPreparedOpalisScenario(runPath: string) {
  const response = await fetch(joinApiPath(undefined, "/opalis/open-prepared-scenario"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await responseError(response))
}
