import { parseDocument, stringify } from "yaml"

import type { ResolvedModelBackend } from "../modelBackends/modelBackends.js"
import {
  applyOrbitKeepingValueChanges,
  type OrbitKeepingValueChange,
  type OrbitKeepingValues,
} from "./orbitKeepingValues.js"

const DEFAULT_TIMEOUT_MS = 60_000

export type OrbitKeepingLlmEditResult = {
  changes: OrbitKeepingValueChange[]
  latencyMs: number
  values: OrbitKeepingValues
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

function parsePatch(source: string): OrbitKeepingValueChange[] {
  const document = parseDocument(source)
  if (document.errors.length > 0) {
    throw new Error(`LLM returned invalid YAML: ${document.errors[0].message}`)
  }
  const parsed = document.toJS()
  if (!parsed || typeof parsed !== "object" || !Array.isArray((parsed as { changes?: unknown }).changes)) {
    throw new Error("LLM response must contain a YAML changes list")
  }
  return (parsed as { changes: unknown[] }).changes.map((change) => {
    if (!change || typeof change !== "object") throw new Error("LLM patch contains an invalid change")
    const candidate = change as Partial<OrbitKeepingValueChange>
    if (typeof candidate.id !== "string" || typeof candidate.value !== "string") {
      throw new Error("LLM patch changes must contain string id and value fields")
    }
    return { id: candidate.id, value: candidate.value }
  })
}

function buildPrompt(request: string, values: OrbitKeepingValues) {
  return [
    "You edit values for a fixed GMAT orbit-keeping mission.",
    "Return YAML only. Do not use Markdown fences or prose.",
    "Return exactly this shape:",
    "changes:",
    "  - id: existing_slot_id",
    "    value: replacement_gmat_literal",
    "Only change value fields required by the user request. Never add, remove, rename, or alter slots.",
    "The value is injected verbatim into an existing GMAT value position. It must not contain a newline or semicolon.",
    "If one request affects several slots, include each of them.",
    "User request:",
    request,
    "Available fixed slots:",
    stringify(values),
  ].join("\n\n")
}

export async function editOrbitKeepingValuesWithLlm({
  connection,
  request,
  values,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  connection: Pick<ResolvedModelBackend, "apiKey" | "baseUrl" | "model">
  request: string
  values: OrbitKeepingValues
  fetchImpl?: typeof fetch
  timeoutMs?: number
}): Promise<OrbitKeepingLlmEditResult> {
  if (!request.trim()) throw new Error("user request must not be empty")
  if (!connection.model) throw new Error("chat model is not configured")

  const startedAt = Date.now()
  const endpoint = `${connection.baseUrl.replace(/\/+$/u, "")}/responses`
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${connection.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: connection.model,
      input: buildPrompt(request, values),
      max_output_tokens: 1200,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await response.text()
  if (!response.ok) throw new Error(`LLM edit failed: HTTP ${response.status}`)

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    throw new Error("LLM edit returned invalid JSON")
  }
  const patch = parsePatch(extractResponseText(payload))
  return {
    changes: patch,
    latencyMs: Date.now() - startedAt,
    values: applyOrbitKeepingValueChanges(values, patch),
  }
}
