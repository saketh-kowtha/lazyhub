/**
 * src/ai/providers/anthropic-api.js — Anthropic HTTP API provider.
 *
 * This is the ONLY file that makes Anthropic HTTP calls.
 * HTTP logic extracted unchanged from src/ai.js.
 * Preserves the cache_control ephemeral header on the system prompt.
 */

import { AIError } from '../error.js'
import { SYSTEM_PROMPT, DEFAULT_MODEL, MAX_TOKENS } from '../prompt.js'

// ── Provider metadata ─────────────────────────────────────────────────────────

export const id          = 'anthropic-api'
export const displayName = 'Anthropic API'
export const authSource  = 'ANTHROPIC_API_KEY'

const ANTHROPIC_API_URL  = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION  = '2023-06-01'

// ── Capability flags ──────────────────────────────────────────────────────────

export const capabilities = {
  systemPrompt:   true,
  jsonMode:       false,
  promptCaching:  true,  // cache_control ephemeral on system prompt
}

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Detect whether the Anthropic API provider is available.
 * @returns {Promise<{available: boolean, reason?: string}>}
 */
export async function detect() {
  const key = process.env.ANTHROPIC_API_KEY
  if (key && key.trim()) {
    return { available: true }
  }
  return { available: false, reason: 'ANTHROPIC_API_KEY is not set' }
}

// ── Transport ─────────────────────────────────────────────────────────────────

/**
 * POST one Messages API request and return the parsed JSON body. The only
 * place in the codebase that talks to Anthropic over HTTP.
 * @param {string} apiKey
 * @param {object} payload
 * @param {AbortSignal} [signal]
 * @returns {Promise<object>}
 */
async function postMessages(apiKey, payload, signal) {
  let response
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type':      'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    if (err.name === 'TimeoutError') throw new AIError('Anthropic request timed out', { code: 'timeout', provider: id })
    throw new AIError(`Network error: ${err.message}`, { code: 'provider-unavailable', provider: id })
  }

  if (!response.ok) {
    const status = response.status
    if (status === 401) throw new AIError('Invalid API key', { code: 'auth-required', provider: id, status })
    if (status === 429) throw new AIError('Rate limit exceeded — try again shortly', { code: 'rate-limited', provider: id, status })
    if (status >= 500)  throw new AIError('Anthropic service error — try again', { code: 'provider-unavailable', provider: id, status })
    throw new AIError(`API error: ${status}`, { code: 'provider-unavailable', provider: id, status })
  }

  try {
    return await response.json()
  } catch {
    throw new AIError('Could not parse API response', { code: 'malformed-response', provider: id })
  }
}

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Call the Anthropic Messages API with the given prompt.
 * @param {object} opts
 * @param {string}      opts.system     - System prompt text
 * @param {string}      opts.user       - User message text
 * @param {number}      opts.maxTokens  - Maximum tokens to generate
 * @param {string}      [opts.model]    - Model override
 * @param {AbortSignal} [opts.signal]   - Optional abort signal
 * @returns {Promise<{text: string, modelUsed: string, tokensIn: number, tokensOut: number}>}
 */
export async function complete({ system, user, maxTokens, model, signal }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new AIError('No Anthropic API key', { code: 'auth-required', provider: id })
  }

  const resolvedModel = model || DEFAULT_MODEL
  const resolvedMax   = maxTokens || MAX_TOKENS

  const body = await postMessages(apiKey, {
    model:      resolvedModel,
    max_tokens: resolvedMax,
    system: [
      {
        type: 'text',
        text: system || SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },  // cached — free on repeated calls
      },
    ],
    messages: [{ role: 'user', content: user }],
  }, signal)

  const text = body?.content?.[0]?.text
  if (typeof text !== 'string') {
    throw new AIError('Unexpected API response format', { code: 'malformed-response', provider: id })
  }

  return {
    text,
    modelUsed:  body.model || resolvedModel,
    tokensIn:   body.usage?.input_tokens  ?? null,
    tokensOut:  body.usage?.output_tokens ?? null,
  }
}

// ── Tool-use chat (assistant) ─────────────────────────────────────────────────

/**
 * One round of a multi-turn, tool-capable conversation. Messages and tool
 * definitions are Anthropic-native; the returned `message` is appended to the
 * history as-is.
 * @param {object} opts
 * @param {string}      opts.system     - System prompt text
 * @param {Array}       opts.messages   - Conversation so far (Anthropic format)
 * @param {Array}       [opts.tools]    - Tool definitions ({name, description, input_schema})
 * @param {number}      opts.maxTokens  - Maximum tokens to generate
 * @param {string}      [opts.model]    - Model override
 * @param {string}      [opts.apiKey]   - Key from lazyhub config; falls back to ANTHROPIC_API_KEY
 * @param {AbortSignal} [opts.signal]   - Optional abort signal
 * @returns {Promise<{message: object, text: string, toolCalls: Array<{id: string, name: string, input: object}>, modelUsed: string, tokensIn: number|null, tokensOut: number|null}>}
 */
export async function chat({ system, messages, tools, maxTokens, model, apiKey: configuredKey, signal }) {
  const apiKey = configuredKey || process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new AIError('No Anthropic API key', { code: 'auth-required', provider: id })
  }
  const resolvedModel = model || DEFAULT_MODEL

  const body = await postMessages(apiKey, {
    model:      resolvedModel,
    max_tokens: maxTokens || MAX_TOKENS,
    system:     [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
    ...(tools?.length ? { tools } : {}),
    messages,
  }, signal)

  if (!Array.isArray(body?.content)) {
    throw new AIError('Unexpected API response format', { code: 'malformed-response', provider: id })
  }
  return {
    message:   { role: 'assistant', content: body.content },
    text:      body.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(),
    toolCalls: body.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input })),
    modelUsed: body.model || resolvedModel,
    tokensIn:  body.usage?.input_tokens  ?? null,
    tokensOut: body.usage?.output_tokens ?? null,
  }
}

/**
 * Build the Anthropic-format message carrying a tool result.
 * @param {string} toolCallId
 * @param {string} content
 * @returns {object}
 */
export function toolResultMessage(toolCallId, content) {
  return { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolCallId, content }] }
}
