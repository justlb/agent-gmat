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

export type RunWorkflowStatus = 'not_started' | 'running' | 'completed' | 'failed' | 'not_visible'
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

export async function openPreparedOpalisScenario(runPath: string) {
  const response = await fetch(joinApiPath(undefined, "/opalis/open-prepared-scenario"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await responseError(response))
}
