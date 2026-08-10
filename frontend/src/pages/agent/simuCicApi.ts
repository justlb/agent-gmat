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
