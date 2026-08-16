import fs from "node:fs/promises"
import path from "node:path"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { appendRunConversation } from "../digitalThread/missionConversationStore.js"
import { buildDraftRunComparisonEntries } from "./draftRunComparison.js"
import type { ChemicalHohmannDraftRun } from "./chemicalHohmannDraft.js"

function responseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") return (payload as { output_text: string }).output_text.trim()
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const texts: string[] = []
  for (const item of Array.isArray(output) ? output : []) for (const part of Array.isArray(item && typeof item === "object" ? (item as { content?: unknown }).content : undefined) ? (item as { content: unknown[] }).content : []) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") texts.push((part as { text: string }).text.trim())
  return texts.filter(Boolean).join("\n")
}

export async function analyzeChemicalHohmannRunWithLlm({ connection, question, relatedRuns = [], runDir, fetchImpl = fetch, timeoutMs = 60_000 }: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">
  question: string
  relatedRuns?: ChemicalHohmannDraftRun[]
  runDir: string
  fetchImpl?: typeof fetch
  timeoutMs?: number
}) {
  const [manifest, result, conversation] = await Promise.all([
    fs.readFile(path.join(runDir, "run_manifest.json"), "utf8"),
    fs.readFile(path.join(runDir, "gmat_result.json"), "utf8"),
    fs.readFile(path.join(runDir, "conversation.json"), "utf8").catch(() => "[]"),
  ])
  const response = await fetchImpl(`${connection.baseUrl.replace(/\/+$/u, "")}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: connection.model,
      input: [
        "You are an engineering assistant analyzing immutable chemical Hohmann GMAT executions from one mission discussion.",
        "Answer only from the supplied data. Do not claim GMAT was rerun. State when a requested orbital metric is unavailable.",
        `Question: ${question}`,
        `GMAT run manifest:\n${manifest}`,
        `Normalized result:\n${result}`,
        relatedRuns.length ? `Mission run comparison index. Each entry has exact inputs and every changed input relative to the preceding execution. The artifact path identifies its immutable snapshot:\n${JSON.stringify(buildDraftRunComparisonEntries(relatedRuns), null, 2)}` : "No linked Hohmann comparison executions.",
        `Previous run discussion:\n${conversation}`,
      ].join("\n\n"),
      max_output_tokens: 1600,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`chemical Hohmann analysis failed: HTTP ${response.status}`)
  const answer = responseText(JSON.parse(body))
  if (!answer) throw new Error("chemical Hohmann analysis returned no text")
  await appendRunConversation(runDir, { answer, askedAt: new Date().toISOString(), channel: "gmat-draft", question })
  return { answer, latencyMs: 0, runId: JSON.parse(manifest).runId as string }
}
