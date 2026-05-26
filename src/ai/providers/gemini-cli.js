/**
 * src/ai/providers/gemini-cli.js — Gemini CLI provider.
 *
 * Uses the `gemini` CLI for executing agent tasks.
 * Prompt is piped via stdin — never argv (diffs exceed ARG_MAX).
 * Auth is managed by the user's Gemini CLI installation (~/.gemini/).
 */

import { spawnAndPipe } from './_base.js'
import { AIError } from '../error.js'

// ── Provider metadata ─────────────────────────────────────────────────────────

export const id          = 'gemini-cli'
export const displayName = 'Gemini CLI'
export const authSource  = '~/.gemini'

// ── Capability flags ──────────────────────────────────────────────────────────

export const capabilities = {
  systemPrompt:   true,
  jsonMode:       true,
  promptCaching:  false,
}

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Detect whether the Gemini CLI is available on PATH.
 * @returns {Promise<{available: boolean, version?: string, reason?: string}>}
 */
export async function detect() {
  try {
    const stdout = await spawnAndPipe({
      cmd:       'gemini',
      args:      ['--version'],
      stdin:     '',
      timeoutMs: 5_000,
    })
    const version = stdout.trim().split('\n')[0] || 'unknown'
    return { available: true, version }
  } catch (err) {
    if (err.isNotFound) {
      return { available: false, reason: 'gemini CLI not found on PATH' }
    }
    return { available: false, reason: err.message }
  }
}

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Run the prompt through the Gemini CLI.
 *
 * The combined system+user prompt is piped via stdin in the format:
 *   <system>\n\n<user>
 *
 * Gemini outputs a single JSON object. We extract assistant text from
 * response.text if present, otherwise from candidates[0].content.parts[0].text.
 *
 * @param {object} opts
 * @param {string}  opts.system      - System prompt text
 * @param {string}  opts.user        - User message text
 * @param {number}  [opts.maxTokens] - Ignored (CLI controls max tokens)
 * @param {string}  [opts._model]    - Model override (not applicable to Gemini CLI)
 * @param {number}  [opts.timeoutMs] - Timeout override
 * @returns {Promise<{text: string, modelUsed: string, tokensIn: null, tokensOut: null}>}
 */
export async function complete({ system, user, _model, timeoutMs }) {
  // Combine system + user into a single stdin payload
  const stdinPayload = system
    ? `${system}\n\n${user}`
    : user

  const argv = [
    '-p',
    '-',
    '--output-format', 'json',
  ]

  let rawOutput
  try {
    rawOutput = await spawnAndPipe({
      cmd:       'gemini',
      args:      argv,
      stdin:     stdinPayload,
      timeoutMs: timeoutMs || 60_000,
    })
  } catch (err) {
    if (err.isTimeout) {
      throw new AIError('Gemini CLI timed out', { code: 'timeout', provider: id })
    }
    if (err.isNotFound) {
      throw new AIError('gemini CLI not found on PATH', { code: 'spawn-failed', provider: id })
    }
    if (err.isOutputCap) {
      throw new AIError('Gemini CLI output exceeded size cap', { code: 'malformed-response', provider: id })
    }
    // Non-zero exit — could be auth failure or other error
    const msg = err.message || 'gemini CLI failed'
    if (/not logged in|unauthenticated|login/i.test(msg)) {
      throw new AIError('Gemini CLI not logged in — run `gemini auth`', { code: 'auth-required', provider: id })
    }
    throw new AIError(`Gemini CLI error: ${msg}`, { code: 'provider-unavailable', provider: id })
  }

  // Parse JSON output: single object
  let parsed
  try {
    parsed = JSON.parse(rawOutput.trim())
  } catch {
    throw new AIError('Could not parse Gemini CLI output as JSON', { code: 'malformed-response', provider: id })
  }

  // Extract text from response.text or candidates[0].content.parts[0].text
  let text
  if (parsed?.response?.text) {
    text = parsed.response.text
  } else if (parsed?.candidates?.[0]?.content?.parts?.[0]?.text) {
    text = parsed.candidates[0].content.parts[0].text
  } else {
    throw new AIError('Could not extract assistant text from Gemini response', { code: 'malformed-response', provider: id })
  }

  if (typeof text !== 'string') {
    throw new AIError('Unexpected Gemini CLI response shape', { code: 'malformed-response', provider: id })
  }

  return {
    text,
    modelUsed: 'gemini',  // Gemini CLI doesn't expose model name
    tokensIn:  null,      // CLI doesn't expose token counts
    tokensOut: null,
  }
}
