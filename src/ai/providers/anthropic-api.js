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

  let response
  try {
    response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type':      'application/json',
      },
      body: JSON.stringify({
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
      }),
      signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') throw err
    throw new AIError(`Network error: ${err.message}`, { code: 'provider-unavailable', provider: id })
  }

  if (!response.ok) {
    const status = response.status
    if (status === 401) throw new AIError('Invalid API key', { code: 'auth-required', provider: id, status })
    if (status === 429) throw new AIError('Rate limit exceeded — try again shortly', { code: 'rate-limited', provider: id, status })
    if (status >= 500)  throw new AIError('Anthropic service error — try again', { code: 'provider-unavailable', provider: id, status })
    throw new AIError(`API error: ${status}`, { code: 'provider-unavailable', provider: id, status })
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new AIError('Could not parse API response', { code: 'malformed-response', provider: id })
  }

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
