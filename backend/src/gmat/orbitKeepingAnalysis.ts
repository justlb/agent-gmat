import fs from "node:fs/promises"
import path from "node:path"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import type { OrbitKeepingDraftRun } from "./orbitKeepingDraft.js"

const DEFAULT_TIMEOUT_MS = 60_000

type RunConversationTurn = {
  answer: string
  askedAt: string
  question: string
}

export type OrbitKeepingRunConversationTurn = RunConversationTurn

export async function loadOrbitKeepingRunConversation(runDir: string): Promise<RunConversationTurn[]> {
  const source = await fs.readFile(path.join(runDir, "conversation.json"), "utf8").catch(() => "[]")
  const parsed = JSON.parse(source) as unknown
  if (!Array.isArray(parsed)) throw new Error("GMAT run conversation is invalid")
  return parsed.filter((turn): turn is RunConversationTurn => Boolean(
    turn && typeof turn === "object" && typeof (turn as RunConversationTurn).question === "string" && typeof (turn as RunConversationTurn).answer === "string",
  ))
}

function extractResponseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") {
    return (payload as { output_text: string }).output_text.trim()
  }
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const texts: string[] = []
  for (const item of Array.isArray(output) ? output : []) {
    const content = item && typeof item === "object" ? (item as { content?: unknown }).content : undefined
    for (const part of Array.isArray(content) ? content : []) {
      if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") {
        texts.push((part as { text: string }).text.trim())
      }
    }
  }
  return texts.filter(Boolean).join("\n")
}

export async function analyzeOrbitKeepingRunWithLlm({
  connection,
  question,
  relatedRuns = [],
  runDir,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">
  question: string
  relatedRuns?: OrbitKeepingDraftRun[]
  runDir: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}) {
  const [manifestSource, resultSource, reportSource, timeSeriesSource] = await Promise.all([
    fs.readFile(path.join(runDir, "run_manifest.json"), "utf8"),
    fs.readFile(path.join(runDir, "gmat_result.json"), "utf8"),
    fs.readFile(path.join(runDir, "ReboostReport.txt"), "utf8").catch(() => ""),
    fs.readFile(path.join(runDir, "orbit_timeseries.json"), "utf8").catch(() => ""),
  ])
  const conversationPath = path.join(runDir, "conversation.json")
  const previousTurns = await loadOrbitKeepingRunConversation(runDir)
  const prompt = [
    "You are an engineering assistant analyzing immutable GMAT orbit-keeping runs from one mission discussion.",
    "Answer only from the supplied run data. Do not claim that GMAT was rerun.",
    "State clearly when the available report does not contain enough information.",
    "Use units and identify the run ID or IDs. Be concise and technically precise.",
    `Question: ${question}`,
    `Run manifest:\n${manifestSource}`,
    `Normalized result:\n${resultSource}`,
    reportSource ? `GMAT report samples:\n${reportSource.slice(0, 100_000)}` : "GMAT report samples: unavailable",
    timeSeriesSource ? `GMAT engineering time series (epoch A1ModJulian; altitude km; fuel kg; total mass kg; SMA km; eccentricity; inclination deg):\n${timeSeriesSource.slice(0, 100_000)}` : "GMAT engineering time series: unavailable",
    relatedRuns.length ? `Other immutable runs linked to this same mission discussion. Their normalized summaries may be compared with the current run, but do not invent report details not shown here:\n${JSON.stringify(relatedRuns.filter(run => run.runId !== JSON.parse(manifestSource).runId), null, 2)}` : "No other GMAT run is linked to this mission discussion yet.",
    previousTurns.length ? `Previous discussion:\n${JSON.stringify(previousTurns.slice(-10), null, 2)}` : "",
  ].filter(Boolean).join("\n\n")
  const startedAt = Date.now()
  const response = await fetchImpl(`${connection.baseUrl.replace(/\/+$/u, "")}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: connection.model,
      input: prompt,
      max_output_tokens: 1600,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`LLM analysis failed: HTTP ${response.status}`)
  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new Error("LLM analysis returned invalid JSON")
  }
  const answer = extractResponseText(payload)
  if (!answer) throw new Error("LLM analysis returned no text")
  const turn = { answer, askedAt: new Date().toISOString(), question }
  await fs.writeFile(conversationPath, `${JSON.stringify([...previousTurns, turn], null, 2)}\n`, "utf8")
  return {
    answer,
    latencyMs: Date.now() - startedAt,
    runId: JSON.parse(manifestSource).runId as string,
  }
}
