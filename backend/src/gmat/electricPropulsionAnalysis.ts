import fs from "node:fs/promises"
import path from "node:path"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import type { ElectricPropulsionDraftRun } from "./electricPropulsionDraft.js"

export type ElectricPropulsionRunConversationTurn = { answer: string; askedAt: string; question: string }

export async function loadElectricPropulsionRunConversation(runDir: string): Promise<ElectricPropulsionRunConversationTurn[]> {
  const parsed = JSON.parse(await fs.readFile(path.join(runDir, "conversation.json"), "utf8").catch(() => "[]")) as unknown
  if (!Array.isArray(parsed)) throw new Error("GMAT electric-propulsion run conversation is invalid")
  return parsed.filter((turn): turn is ElectricPropulsionRunConversationTurn => Boolean(turn && typeof turn === "object" && typeof (turn as ElectricPropulsionRunConversationTurn).question === "string" && typeof (turn as ElectricPropulsionRunConversationTurn).answer === "string"))
}
function extractResponseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") return (payload as { output_text: string }).output_text.trim()
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const texts: string[] = []
  for (const item of Array.isArray(output) ? output : []) for (const part of Array.isArray(item && typeof item === "object" ? (item as { content?: unknown }).content : undefined) ? (item as { content: unknown[] }).content : []) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") texts.push((part as { text: string }).text.trim())
  return texts.filter(Boolean).join("\n")
}
export async function analyzeElectricPropulsionRunWithLlm({ connection, question, relatedRuns = [], runDir, fetchImpl = fetch, timeoutMs = 60_000 }: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">
  question: string
  relatedRuns?: ElectricPropulsionDraftRun[]
  runDir: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}) {
  const [manifest, result, report] = await Promise.all([
    fs.readFile(path.join(runDir, "run_manifest.json"), "utf8"), fs.readFile(path.join(runDir, "gmat_result.json"), "utf8"), fs.readFile(path.join(runDir, "ElectricTransferReport.txt"), "utf8").catch(() => ""),
  ])
  const previousTurns = await loadElectricPropulsionRunConversation(runDir)
  const prompt = [
    "You are an engineering assistant analyzing an immutable GMAT finite-burn electric-propulsion transfer.",
    "Answer only from the supplied data. Do not claim that GMAT was rerun and do not claim this non-targeted template reaches a particular final orbit unless the report demonstrates it.",
    "The report columns are elapsed days, Keplerian elements (SMA km, ECC, INC/RAAN/AOP/TA degrees), electric propellant mass (kg), total mass (kg), thrust power available after the spacecraft bus load and power margin (kW), and electric-thruster mass flow rate (kg/s). State when data is unavailable.",
    `Question: ${question}`, `Run manifest:\n${manifest}`, `Normalized result:\n${result}`,
    report ? `GMAT electric transfer report:\n${report.slice(0, 100_000)}` : "GMAT electric transfer report: unavailable",
    relatedRuns.length ? `Other immutable runs in this mission discussion:\n${JSON.stringify(relatedRuns, null, 2)}` : "No linked comparison runs.",
    previousTurns.length ? `Previous discussion:\n${JSON.stringify(previousTurns.slice(-10), null, 2)}` : "",
  ].filter(Boolean).join("\n\n")
  const startedAt = Date.now()
  const response = await fetchImpl(`${connection.baseUrl.replace(/\/+$/u, "")}/responses`, { method: "POST", headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: connection.model, input: prompt, max_output_tokens: 1600 }), signal: AbortSignal.timeout(timeoutMs) })
  const body = await response.text()
  if (!response.ok) throw new Error(`LLM analysis failed: HTTP ${response.status}`)
  let payload: unknown
  try { payload = JSON.parse(body) } catch { throw new Error("LLM analysis returned invalid JSON") }
  const answer = extractResponseText(payload)
  if (!answer) throw new Error("LLM analysis returned no text")
  const turn = { answer, askedAt: new Date().toISOString(), question }
  await fs.writeFile(path.join(runDir, "conversation.json"), `${JSON.stringify([...previousTurns, turn], null, 2)}\n`, "utf8")
  return { answer, latencyMs: Date.now() - startedAt, runId: JSON.parse(manifest).runId as string }
}
