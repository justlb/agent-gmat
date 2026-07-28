import net from "node:net"
import { EnvHttpProxyAgent, setGlobalDispatcher } from "undici"

import type { AppConfig } from "./config.js"
import type { Logger } from "./logger.js"

const DEFAULT_NO_PROXY = ["localhost", "127.0.0.1", "::1", "0.0.0.0"]
const PROXY_ENV_KEYS = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"] as const

function normalizeHost(value: string) {
  return value.trim().replace(/^\[/u, "").replace(/\]$/u, "").toLowerCase()
}

function isPrivateHost(value: string) {
  const host = normalizeHost(value)
  if (!host) return false
  if (host === "localhost" || host.endsWith(".local")) return true
  if (!host.includes(".") && !host.includes(":")) return true
  if (net.isIP(host) === 4) {
    const [first, second] = host.split(".").map(Number)
    return first === 10 || first === 127 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 169 && second === 254)
  }
  return net.isIP(host) === 6 && (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"))
}

function addPrivateUrlHost(entries: Set<string>, value: string | null | undefined) {
  if (!value) return
  try {
    const host = normalizeHost(new URL(value).hostname)
    if (isPrivateHost(host)) entries.add(host)
  } catch {
    // Optional endpoint validation is handled elsewhere.
  }
}

function configuredNoProxy(config: AppConfig) {
  const entries = new Set<string>()
  for (const item of DEFAULT_NO_PROXY) entries.add(item)
  for (const item of (process.env.no_proxy ?? process.env.NO_PROXY ?? "").split(/[,\s]/u)) {
    const normalized = normalizeHost(item)
    if (normalized) entries.add(normalized)
  }
  addPrivateUrlHost(entries, config.chatModel.baseUrl)
  addPrivateUrlHost(entries, config.funasr.apiUrl)
  addPrivateUrlHost(entries, config.cosyvoice.apiUrl)
  addPrivateUrlHost(entries, config.tools.gnc.url)
  if (isPrivateHost(config.workspace.rpcHost)) entries.add(normalizeHost(config.workspace.rpcHost))
  if (isPrivateHost(config.compliance.database.host)) entries.add(normalizeHost(config.compliance.database.host))
  return [...entries].join(",")
}

function proxyFromEnvironment() {
  for (const key of PROXY_ENV_KEYS) {
    const value = process.env[key]?.trim()
    if (value) return { key, value }
  }
  return null
}

function maskProxyUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.username) url.username = "***"
    if (url.password) url.password = "***"
    return url.toString()
  } catch {
    return value.replace(/\/\/([^/@]+)@/u, "//***@")
  }
}

/** Configure Node's global fetch to use the conventional proxy environment variables. */
export function configureGlobalFetchProxy(logger: Logger, config: AppConfig) {
  const noProxy = configuredNoProxy(config)
  process.env.NO_PROXY = noProxy
  process.env.no_proxy = noProxy
  const proxy = proxyFromEnvironment()
  if (!proxy) {
    logger.info("global fetch proxy disabled", { noProxy })
    return
  }
  try {
    setGlobalDispatcher(new EnvHttpProxyAgent({ noProxy }))
    logger.info("global fetch proxy enabled", { envKey: proxy.key, noProxy, proxyUrl: maskProxyUrl(proxy.value) })
  } catch (err) {
    logger.error("global fetch proxy setup failed", { err, envKey: proxy.key, proxyUrl: maskProxyUrl(proxy.value) })
  }
}
