// @ts-nocheck
// TODO(#197): provider request/response typedefs need cleanup after checkJs gate.
/**
 * src/ai/providers/openai-compatible.js — OpenAI-compatible HTTP provider.
 */

import { AIError } from '../error.js'
import { SYSTEM_PROMPT, DEFAULT_MODEL, MAX_TOKENS } from '../prompt.js'
import { loadConfig } from '../../config/loader.js'

export const id = 'openai-compatible'
export const displayName = 'OpenAI-compatible HTTP'
export const authSource = 'lazyhub.toml [ai.openai_compatible]'

export const capabilities = {
  systemPrompt: true,
  jsonMode: false,
  promptCaching: false,
}

function providerConfig() {
  return loadConfig().ai?.openai_compatible || {}
}

function endpointHost(baseUrl) {
  try { return new URL(baseUrl).host } catch { return baseUrl || 'unknown endpoint' }
}

/**
 * Build the OpenAI Chat Completions endpoint for a base URL.
 * @param {string} baseUrl provider base URL ending at /v1
 * @returns {string} chat completions URL
 */
function completionUrl(baseUrl) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/chat/completions`
}

/**
 *
 */
export async function detect() {
  const cfg = providerConfig()
  if (!cfg.base_url) return { available: false, reason: '[ai.openai_compatible].base_url is empty' }
  if (!cfg.model) return { available: false, reason: '[ai.openai_compatible].model is empty' }
  return { available: true }
}

/**
 *
 * @param root0
 * @param root0.system
 * @param root0.user
 * @param root0.maxTokens
 * @param root0.model
 * @param root0.timeoutMs
 * @param root0.signal
 */
export async function complete({ system, user, maxTokens, model, timeoutMs, signal }) {
  const cfg = providerConfig()
  if (!cfg.base_url) {
    throw new AIError('Missing [ai.openai_compatible].base_url', { code: 'config-error', provider: id })
  }
  const resolvedModel = cfg.model || model || DEFAULT_MODEL
  if (!resolvedModel) {
    throw new AIError('Missing [ai.openai_compatible].model', { code: 'config-error', provider: id })
  }
  const resolvedMax = maxTokens || MAX_TOKENS
  const controller = signal ? null : new AbortController()
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs || cfg.timeout_ms || 60000) : null

  let response
  try {
    const headers = { 'content-type': 'application/json' }
    if (cfg.api_key) headers.authorization = `Bearer ${cfg.api_key}`
    response = await fetch(completionUrl(cfg.base_url), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: resolvedModel,
        messages: [
          { role: 'system', content: system || SYSTEM_PROMPT },
          { role: 'user', content: user },
        ],
        max_tokens: resolvedMax,
        stream: false,
      }),
      signal: signal || controller.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new AIError(`OpenAI-compatible request timed out for ${endpointHost(cfg.base_url)}`, { code: 'timeout', provider: id })
    }
    throw new AIError(`Network error contacting ${endpointHost(cfg.base_url)}: ${err.message}`, { code: 'provider-unavailable', provider: id })
  } finally {
    if (timer) clearTimeout(timer)
  }

  if (!response.ok) {
    const status = response.status
    if (status === 401 || status === 403) throw new AIError(`Auth failed for ${endpointHost(cfg.base_url)}`, { code: 'auth-required', provider: id, status })
    if (status === 429) throw new AIError(`Rate limited by ${endpointHost(cfg.base_url)}`, { code: 'rate-limited', provider: id, status })
    if (status >= 500) throw new AIError(`Provider error from ${endpointHost(cfg.base_url)}`, { code: 'provider-unavailable', provider: id, status })
    throw new AIError(`OpenAI-compatible API error ${status} from ${endpointHost(cfg.base_url)}`, { code: 'provider-unavailable', provider: id, status })
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new AIError('Could not parse OpenAI-compatible response', { code: 'malformed-response', provider: id })
  }

  const text = body?.choices?.[0]?.message?.content
  if (typeof text !== 'string') {
    throw new AIError('Unexpected OpenAI-compatible response format', { code: 'malformed-response', provider: id })
  }

  return {
    text,
    modelUsed: body.model || resolvedModel,
    tokensIn: body.usage?.prompt_tokens ?? null,
    tokensOut: body.usage?.completion_tokens ?? null,
  }
}

// ── Tool-use chat (assistant) ─────────────────────────────────────────────────

/**
 * One round of a multi-turn, tool-capable conversation against any OpenAI
 * Chat Completions endpoint (OpenAI, Ollama, LM Studio, ...). Messages are
 * OpenAI-native; tool definitions are Anthropic-shaped and converted here.
 * The returned `message` is appended to the history as-is (the system prompt
 * is injected per request and never stored).
 * @param {object} opts
 * @param {string}   opts.system
 * @param {Array}    opts.messages
 * @param {Array}    [opts.tools]       - {name, description, input_schema}
 * @param {number}   opts.maxTokens
 * @param {string}   opts.model
 * @param {string}   opts.baseUrl       - Base URL ending at /v1
 * @param {string}   [opts.apiKey]      - Optional (local servers need none)
 * @param {AbortSignal} [opts.signal]   - Abort/timeout signal (the facade supplies the timeout)
 * @returns {Promise<{message: object, text: string, toolCalls: Array<{id: string, name: string, input: object}>, modelUsed: string, tokensIn: number|null, tokensOut: number|null}>}
 */
export async function chat({ system, messages, tools, maxTokens, model, baseUrl, apiKey, signal }) {
  const host = endpointHost(baseUrl)

  let response
  try {
    const headers = { 'content-type': 'application/json' }
    if (apiKey) headers.authorization = `Bearer ${apiKey}`
    response = await fetch(completionUrl(baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: maxTokens || MAX_TOKENS,
        ...(tools?.length ? {
          tools: tools.map(d => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.input_schema } })),
          tool_choice: 'auto',
        } : {}),
        messages: [{ role: 'system', content: system }, ...messages],
        stream: false,
      }),
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    if (err.name === 'TimeoutError') {
      throw new AIError(`OpenAI-compatible request timed out for ${host}`, { code: 'timeout', provider: id })
    }
    const cause = err.cause?.code || err.cause?.message
    throw new AIError(`Network error contacting ${host}: ${cause || err.message}`, { code: 'provider-unavailable', provider: id })
  }

  if (!response.ok) {
    const status = response.status
    if (status === 401 || status === 403) throw new AIError(`Auth failed for ${host}`, { code: 'auth-required', provider: id, status })
    if (status === 429) throw new AIError(`Rate limited by ${host}`, { code: 'rate-limited', provider: id, status })
    if (status >= 500) throw new AIError(`Provider error from ${host}`, { code: 'provider-unavailable', provider: id, status })
    throw new AIError(`OpenAI-compatible API error ${status} from ${host}`, { code: 'provider-unavailable', provider: id, status })
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new AIError('Could not parse OpenAI-compatible response', { code: 'malformed-response', provider: id })
  }

  const message = body?.choices?.[0]?.message
  if (!message || typeof message !== 'object') {
    throw new AIError('Unexpected OpenAI-compatible response format', { code: 'malformed-response', provider: id })
  }
  return {
    message,
    text: (message.content || '').trim(),
    toolCalls: (message.tool_calls || []).map(tc => {
      let input
      try { input = JSON.parse(tc.function.arguments) } catch { input = {} }
      return { id: tc.id, name: tc.function.name, input }
    }),
    modelUsed: body.model || model,
    tokensIn: body.usage?.prompt_tokens ?? null,
    tokensOut: body.usage?.completion_tokens ?? null,
  }
}

/**
 * Build the OpenAI-format message carrying a tool result.
 * @param {string} toolCallId
 * @param {string} content
 * @returns {object}
 */
export function toolResultMessage(toolCallId, content) {
  return { role: 'tool', tool_call_id: toolCallId, content }
}
