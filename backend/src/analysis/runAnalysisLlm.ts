import fs from "node:fs/promises"
import path from "node:path"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import { appendRunConversation } from "../digitalThread/missionConversationStore.js"
import { analysisContextForPrompt, loadRunAnalysisContext, writeRunAnalysisContext } from "./runAnalysisContext.js"

function responseText(payload: unknown) {
  if (payload && typeof payload === "object" && typeof (payload as { output_text?: unknown }).output_text === "string") return (payload as { output_text: string }).output_text.trim()
  const output = payload && typeof payload === "object" ? (payload as { output?: unknown }).output : undefined
  const texts: string[] = []
  for (const item of Array.isArray(output) ? output : []) for (const part of Array.isArray(item && typeof item === "object" ? (item as { content?: unknown }).content : undefined) ? (item as { content: unknown[] }).content : []) if (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string") texts.push((part as { text: string }).text.trim())
  return texts.filter(Boolean).join("\n")
}

/** Generic analysis path for templates that do not have a dedicated report parser yet. */
export async function analyzeRunWithAnalysisContext({ connection, question, runDir, timeoutMs = 60_000 }: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">
  question: string
  runDir: string
  timeoutMs?: number
}) {
  const [manifest, context, conversation] = await Promise.all([
    fs.readFile(path.join(runDir, "run_manifest.json"), "utf8").catch(() => "{}"),
    loadRunAnalysisContext(runDir).then(item => item ?? writeRunAnalysisContext(runDir).then(result => result.context)),
    fs.readFile(path.join(runDir, "conversation.json"), "utf8").catch(() => "[]"),
  ])
  const response = await fetch(`${connection.baseUrl.replace(/\/+$/u, "")}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${connection.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: connection.model,
      input: [
        "You are a spacecraft engineering assistant analyzing one immutable mission run.",
        "Use only the supplied run-analysis context. Do not claim any tool was rerun. Cite the tool and source file for every factual conclusion, distinguish interpretation from reported facts, and state missing evidence explicitly.",
        `Question: ${question}`,
        `Run manifest:\n${manifest}`,
        analysisContextForPrompt(context),
        `Previous discussion:\n${conversation}`,
      ].join("\n\n"),
      max_output_tokens: 1600,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const source = await response.text()
  if (!response.ok) throw new Error(`run analysis failed: HTTP ${response.status}`)
  const answer = responseText(JSON.parse(source))
  if (!answer) throw new Error("run analysis returned no text")
  await appendRunConversation(runDir, { answer, askedAt: new Date().toISOString(), channel: "gmat-draft", question })
  return { answer, runId: JSON.parse(manifest).runId as string }
}
