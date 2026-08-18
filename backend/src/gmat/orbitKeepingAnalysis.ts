import fs from "node:fs/promises"
import path from "node:path"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import type { OrbitKeepingDraftRun } from "./orbitKeepingDraft.js"
import { buildDraftRunComparisonEntries } from "./draftRunComparison.js"
import { analysisContextForPrompt, loadRunAnalysisContext, writeRunAnalysisContext } from "../analysis/runAnalysisContext.js"

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
  const [manifestSource, analysisContext] = await Promise.all([
    fs.readFile(path.join(runDir, "run_manifest.json"), "utf8"),
    loadRunAnalysisContext(runDir).then(context => context ?? writeRunAnalysisContext(runDir).then(result => result.context)),
  ])
  const conversationPath = path.join(runDir, "conversation.json")
  const previousTurns = await loadOrbitKeepingRunConversation(runDir)
  const prompt = [
    "You are an engineering assistant analyzing immutable GMAT orbit-keeping runs from one mission discussion.",
    "Answer only from the supplied analysis context. Do not claim that GMAT was rerun.",
    "For each conclusion, identify the tool and source file. Separate reported facts from engineering interpretation; state missing evidence explicitly.",
    "Use units and identify the run ID or IDs. Be concise and technically precise.",
    `Question: ${question}`,
    `Run manifest:\n${manifestSource}`,
    analysisContextForPrompt(analysisContext),
    relatedRuns.length ? `Mission run comparison index. Each entry is immutable, includes the exact inputs used, and lists every changed input relative to the preceding run. The current run is included for traceability; compare normalized results only and do not invent report details not shown here:\n${JSON.stringify(buildDraftRunComparisonEntries(relatedRuns), null, 2)}` : "No other GMAT run is linked to this mission discussion yet.",
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
