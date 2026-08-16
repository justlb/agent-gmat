import fs from "node:fs/promises"
import path from "node:path"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { appendRunConversation } from "../digitalThread/missionConversationStore.js"
import { loadRFComlinkResultSummary } from "./rfComlinkResults.js"

function responseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") return (payload as { output_text: string }).output_text.trim()
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const texts: string[] = []
  for (const item of Array.isArray(output) ? output : []) for (const part of Array.isArray(item && typeof item === "object" ? (item as { content?: unknown }).content : undefined) ? (item as { content: unknown[] }).content : []) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") texts.push((part as { text: string }).text.trim())
  return texts.filter(Boolean).join("\n")
}

export async function analyzeRFComlinkRunWithLlm({ connection, question, runDir, fetchImpl = fetch, timeoutMs = 60_000 }: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">
  question: string
  runDir: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}) {
  const summary = await loadRFComlinkResultSummary(runDir)
  if (!summary) throw new Error("RF-COMLINK results are not saved for this run. Run the calculation and select Save RF-COMLINK results first.")
  const [manifest, conversation] = await Promise.all([
    fs.readFile(path.join(runDir, "run_manifest.json"), "utf8").catch(() => "{}"),
    fs.readFile(path.join(runDir, "conversation.json"), "utf8").catch(() => "[]"),
  ])
  const response = await fetchImpl(`${connection.baseUrl.replace(/\/+$/u, "")}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: connection.model,
      input: [
        "You are an RF systems engineering assistant analyzing a saved RF-COMLINK calculation.",
        "Answer only from the supplied reports. State clearly when a requested metric is absent; do not claim RF-COMLINK was rerun.",
        `Question: ${question}`,
        `GMAT run manifest:\n${manifest}`,
        `RF-COMLINK result summary and extracted reports:\n${JSON.stringify(summary)}`,
        `Previous run discussion:\n${conversation}`,
      ].join("\n\n"),
      max_output_tokens: 1600,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`RF-COMLINK analysis failed: HTTP ${response.status}`)
  const answer = responseText(JSON.parse(body))
  if (!answer) throw new Error("RF-COMLINK analysis returned no text")
  await appendRunConversation(runDir, { answer, askedAt: new Date().toISOString(), channel: "rf-comlink", question })
  return { answer, latencyMs: 0, runId: JSON.parse(manifest).runId as string }
}
