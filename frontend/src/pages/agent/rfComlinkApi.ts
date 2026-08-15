import { joinApiPath } from "../../app/apiBase"

async function responseError(response: Response) {
  const payload = await response.json().catch(() => ({})) as { error?: unknown; message?: unknown }
  return typeof payload.error === "string"
    ? payload.error
    : typeof payload.message === "string"
      ? payload.message
      : `RF-COMLINK request failed: ${response.status}`
}

/** Opens the generated run-local RF-COMLINK scenario in the Windows GUI. */
export async function openRfComlinkGui(runPath: string) {
  const response = await fetch(joinApiPath(undefined, "/rf-comlink/open-gui"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<{ ok: true; scenario: string }>
}

/** Writes the run-local RF input manifest after verifying the actual CIC files. */
export async function prepareRfComlinkInputs(runPath: string) {
  const response = await fetch(joinApiPath(undefined, "/rf-comlink/prepare-inputs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<{
    output: string
    validation: { missing: string[]; status: "blocked" | "ready"; warnings: string[] }
  }>
}

/** Builds the run-local .rfcl package after input validation succeeds. */
export async function prepareRfComlinkScenario(runPath: string) {
  const response = await fetch(joinApiPath(undefined, "/rf-comlink/prepare-scenario"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ runPath }),
  })
  if (!response.ok) throw new Error(await responseError(response))
  return response.json() as Promise<{
    scenario: string
    validation: { missing: string[]; status: "blocked" | "ready"; warnings: string[] }
  }>
}
