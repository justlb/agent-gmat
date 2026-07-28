#!/usr/bin/env node

import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..")
const DEFAULT_CONFIG_PATH = path.join(PROJECT_ROOT, "config.json")
const DEFAULT_TIMEOUT_MS = 30_000
const PROBE_PROMPT = "Reply with exactly: GMAT_PROBE_OK"

function parsePositiveInteger(value, flag) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`)
  }
  return parsed
}

export function parseArgs(argv) {
  const args = {
    configPath: DEFAULT_CONFIG_PATH,
    json: false,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--config") {
      const value = argv[++index]
      if (!value) throw new Error("--config requires a path")
      args.configPath = path.resolve(value)
    } else if (arg === "--timeout-ms") {
      args.timeoutMs = parsePositiveInteger(argv[++index], "--timeout-ms")
    } else if (arg === "--json") {
      args.json = true
    } else if (arg === "-h" || arg === "--help") {
      args.help = true
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }

  return args
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is missing`)
  }
  return value.trim()
}

function rejectPlaceholder(value, field) {
  if (/^(?:xxx|sk-replace-me)$/iu.test(value)) {
    throw new Error(`${field} still contains a placeholder`)
  }
  return value
}

export async function loadProbeConfig(configPath, env = process.env) {
  let config = {}
  try {
    config = JSON.parse(await fs.readFile(configPath, "utf8"))
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw new Error(`cannot read ${configPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const chatModel = config.chatModel ?? config.chat_model ?? {}
  const apiKey = rejectPlaceholder(
    requiredString(env.CHAT_MODEL_API_KEY ?? chatModel.apiKey ?? chatModel.api_key, "chatModel.apiKey"),
    "chatModel.apiKey",
  )
  const baseUrl = requiredString(
    env.CHAT_MODEL_BASE_URL ?? chatModel.baseUrl ?? chatModel.base_url,
    "chatModel.baseUrl",
  ).replace(/\/+$/u, "")
  const model = requiredString(env.CHAT_MODEL_NAME ?? chatModel.model, "chatModel.model")

  try {
    new URL(baseUrl)
  } catch {
    throw new Error("chatModel.baseUrl is not a valid URL")
  }

  return { apiKey, baseUrl, model }
}

export function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim()
  }

  const texts = []
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (typeof content?.text === "string" && content.text.trim()) {
        texts.push(content.text.trim())
      }
    }
  }
  return texts.join("\n")
}

function safeEndpoint(baseUrl) {
  const url = new URL(`${baseUrl}/responses`)
  if (url.username) url.username = "***"
  if (url.password) url.password = "***"
  for (const key of ["api_key", "apikey", "key", "token"]) {
    if (url.searchParams.has(key)) url.searchParams.set(key, "***")
  }
  return url.toString()
}

export async function runChatModelProbe({ config, fetchImpl = fetch, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const startedAt = Date.now()
  const endpoint = `${config.baseUrl}/responses`
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: PROBE_PROMPT,
      max_output_tokens: 16,
      model: config.model,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  const body = await response.text()

  if (!response.ok) {
    throw new Error(`chat model probe failed: HTTP ${response.status}`)
  }

  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    throw new Error("chat model probe returned invalid JSON")
  }

  const responseText = extractResponseText(payload)
  if (!responseText) {
    throw new Error("chat model probe returned no text")
  }

  return {
    endpoint: safeEndpoint(config.baseUrl),
    latencyMs: Date.now() - startedAt,
    model: config.model,
    ok: true,
    responseText,
  }
}

function printHelp() {
  process.stdout.write(`Usage:
  node scripts/check_chat_model_endpoint.mjs [options]

Options:
  --config <path>       Config file. Defaults to ./config.json.
  --timeout-ms <ms>     Request timeout. Defaults to 30000.
  --json                Print machine-readable JSON.
  -h, --help            Show this help.

The probe sends exactly one POST request to chatModel.baseUrl/responses.
Environment overrides: CHAT_MODEL_API_KEY, CHAT_MODEL_BASE_URL, CHAT_MODEL_NAME.
`)
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv)
  if (args.help) {
    printHelp()
    return 0
  }

  try {
    const config = await loadProbeConfig(args.configPath)
    const result = await runChatModelProbe({ config, timeoutMs: args.timeoutMs })
    if (args.json) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    } else {
      process.stdout.write(`LLM probe OK — model=${result.model} latency=${result.latencyMs}ms response=${JSON.stringify(result.responseText)}\n`)
    }
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (args.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, error: message }, null, 2)}\n`)
    } else {
      process.stderr.write(`LLM probe FAILED — ${message}\n`)
    }
    return 1
  }
}

const isDirectRun = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href

if (isDirectRun) {
  process.exitCode = await main()
}
