const DEFAULT_NO_PROXY = ["localhost", "127.0.0.1", "::1", "0.0.0.0"]

function normalizeHost(value) {
  return String(value ?? "").trim().replace(/^\[/u, "").replace(/\]$/u, "").toLowerCase()
}

function isPrivateHost(host) {
  const value = normalizeHost(host)
  if (!value) return false
  if (value === "localhost" || value.endsWith(".local") || (!value.includes(".") && !value.includes(":"))) return true
  const parts = value.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/u)?.slice(1).map(Number)
  if (parts) return parts[0] === 10 || parts[0] === 127 || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168) || (parts[0] === 169 && parts[1] === 254)
  return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80:")
}

function addPrivateUrlHost(entries, value) {
  if (!value) return
  try {
    const host = normalizeHost(new URL(value).hostname)
    if (isPrivateHost(host)) entries.add(host)
  } catch {}
}

export async function configureGlobalFetchProxy({ config = {} } = {}) {
  const entries = new Set(DEFAULT_NO_PROXY)
  for (const value of (process.env.no_proxy ?? process.env.NO_PROXY ?? "").split(/[,\s]/u)) {
    if (normalizeHost(value)) entries.add(normalizeHost(value))
  }
  const chatModel = config.chatModel ?? config.chat_model ?? {}
  addPrivateUrlHost(entries, chatModel.baseUrl ?? chatModel.base_url)
  addPrivateUrlHost(entries, config.funasr?.apiUrl)
  addPrivateUrlHost(entries, config.cosyvoice?.apiUrl)
  addPrivateUrlHost(entries, config.tools?.gnc?.url)
  const noProxy = [...entries].join(",")
  process.env.NO_PROXY = noProxy
  process.env.no_proxy = noProxy
  const proxyUrl = process.env.HTTPS_PROXY?.trim() || process.env.https_proxy?.trim() || process.env.HTTP_PROXY?.trim() || process.env.http_proxy?.trim() || process.env.ALL_PROXY?.trim() || process.env.all_proxy?.trim()
  if (!proxyUrl) return null
  const { EnvHttpProxyAgent, setGlobalDispatcher } = await import("../backend/node_modules/undici/index.js")
  setGlobalDispatcher(new EnvHttpProxyAgent({ noProxy }))
  return { noProxy, proxyUrl }
}
