/**
 * src/ai/providers/claude-code.js — Claude Code CLI provider.
 *
 * Uses the `claude` CLI in non-interactive (-p) mode.
 * Prompt is piped via stdin — never argv (diffs exceed ARG_MAX).
 * Auth is managed by the user's Claude Code installation (~/.claude/).
 */

import { spawnAndPipe } from './_base.js'
import { AIError } from '../error.js'
import { DEFAULT_MODEL } from '../prompt.js'

// ── Provider metadata ─────────────────────────────────────────────────────────

export const id          = 'claude-code'
export const displayName = 'Claude Code'
export const authSource  = '~/.claude'

// ── Capability flags ──────────────────────────────────────────────────────────

export const capabilities = {
  systemPrompt:   true,
  jsonMode:       false,
  promptCaching:  false,  // CLI handles caching internally
}

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Detect whether the Claude Code CLI is available on PATH.
 * @returns {Promise<{available: boolean, version?: string, reason?: string}>}
 */
export async function detect() {
  try {
    const stdout = await spawnAndPipe({
      cmd:       'claude',
      args:      ['--version'],
      stdin:     '',
      timeoutMs: 5_000,
    })
    const version = stdout.trim().split('\n')[0] || 'unknown'
    return { available: true, version }
  } catch (err) {
    if (err.isNotFound) {
      return { available: false, reason: 'claude CLI not found on PATH' }
    }
    return { available: false, reason: err.message }
  }
}

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Run the prompt through the Claude Code CLI.
 *
 * The combined system+user prompt is piped via stdin in the format:
 *   <system>\n\n<user>
 *
 * `--output-format json` returns { type, result, ... } where `result` is the
 * assistant text. `--max-turns 1` prevents agent tool-use loops.
 *
 * @param {object} opts
 * @param {string}  opts.system     - System prompt text
 * @param {string}  opts.user       - User message text
 * @param {number}  [opts.maxTokens] - Ignored (CLI controls max tokens)
 * @param {string}  [opts.model]    - Model override (default: claude-haiku-4-5)
 * @param {number}  [opts.timeoutMs] - Timeout override
 * @returns {Promise<{text: string, modelUsed: string, tokensIn: null, tokensOut: null}>}
 */
export async function complete({ system, user, model, timeoutMs }) {
  const resolvedModel = model || DEFAULT_MODEL

  // Combine system + user into a single stdin payload
  const stdinPayload = system
    ? `${system}\n\n${user}`
    : user

  const argv = [
    '-p',
    '--output-format', 'json',
    '--max-turns', '1',
    '--model', resolvedModel,
  ]

  let rawOutput
  try {
    rawOutput = await spawnAndPipe({
      cmd:       'claude',
      args:      argv,
      stdin:     stdinPayload,
      timeoutMs: timeoutMs || 60_000,
    })
  } catch (err) {
    if (err.isTimeout) {
      throw new AIError('Claude Code CLI timed out', { code: 'timeout', provider: id })
    }
    if (err.isNotFound) {
      throw new AIError('claude CLI not found on PATH', { code: 'spawn-failed', provider: id })
    }
    if (err.isOutputCap) {
      throw new AIError('Claude Code CLI output exceeded size cap', { code: 'malformed-response', provider: id })
    }
    // Non-zero exit — could be auth failure or other error
    const msg = err.message || 'claude CLI failed'
    if (/not logged in|unauthenticated|login/i.test(msg)) {
      throw new AIError('Claude Code not logged in — run `claude login`', { code: 'auth-required', provider: id })
    }
    throw new AIError(`Claude Code CLI error: ${msg}`, { code: 'provider-unavailable', provider: id })
  }

  // Parse JSON output: { type: 'result', result: '<assistant text>', ... }
  let parsed
  try {
    parsed = JSON.parse(rawOutput.trim())
  } catch {
    throw new AIError('Could not parse Claude Code CLI output as JSON', { code: 'malformed-response', provider: id })
  }

  const text = parsed?.result
  if (typeof text !== 'string') {
    throw new AIError('Unexpected Claude Code CLI response shape', { code: 'malformed-response', provider: id })
  }

  return {
    text,
    modelUsed: parsed?.model || resolvedModel,
    tokensIn:  null,  // CLI doesn't expose token counts
    tokensOut: null,
  }
}
