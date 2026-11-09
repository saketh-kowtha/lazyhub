// Short label for an OpenAI-compatible base URL, shown in Settings.
// Matches on the parsed hostname (exact or subdomain), never on substrings of
// the whole URL, so a path or query that merely mentions a provider is ignored.

/** @type {Array<[string[], string]>} */
const PROVIDERS = [
  [['groq.com'], 'Groq'],
  [['together.xyz', 'together.ai'], 'Together'],
  [['fireworks.ai'], 'Fireworks'],
  [['openai.azure.com'], 'Azure OpenAI'],
  [['openai.com'], 'OpenAI'],
  [['mistral.ai'], 'Mistral'],
  [['deepseek.com'], 'DeepSeek'],
  [['x.ai'], 'xAI'],
]

/**
 * @param {string} host lower-case hostname
 * @param {string} domain
 */
function hostIs(host, domain) {
  return host === domain || host.endsWith(`.${domain}`)
}

/**
 * @param {string} baseUrl
 * @returns {string}
 */
export function endpointHint(baseUrl) {
  /** @type {URL | null} */
  let url = null
  try { url = new URL(baseUrl) } catch { url = null }
  if (!url) return baseUrl.replace(/^https?:\/\//, '').split('/')[0]
  const host = url.hostname.toLowerCase()
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') {
    return url.port ? `local :${url.port}` : 'local'
  }
  for (const [domains, label] of PROVIDERS) {
    if (domains.some(d => hostIs(host, d))) return label
  }
  return url.host
}
