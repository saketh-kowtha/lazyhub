/** index.js — Public API for AI code review and provider management. */
/**
 * src/ai/index.js — Public API for AI-powered code review.
 *
 * This is the ONLY entry point callers should use.
 * Provider selection, prompt building, and parsing are all internal.
 *
 * Usage:
 *   import { getAICodeReview, AIError, listProviders } from './ai/index.js'
 *   const result = await getAICodeReview({ diff, prTitle, prBody, opts })
 *   // result: { summary: string, suggestions: [{file, line, severity, comment}] }
 */

export { AIError } from './error.js'

import { selectProvider, listProviderStatus } from './detect.js'
import { SYSTEM_PROMPT, MAX_TOKENS, DEFAULT_MODEL, buildUserPrompt } from './prompt.js'
import { parseReviewResponse } from './parse.js'
import { logAiUsage } from './usage.js'

// ── getAICodeReview ───────────────────────────────────────────────────────────

/**
 * Send a unified diff to an AI provider and get structured code review feedback.
 *
 * Signature is backward-compatible with the old src/ai.js function.
 * `apiKey` is accepted but ignored — the provider reads it from env directly.
 *
 * @param {object} opts
 * @param {string} opts.diff       - Unified diff text
 * @param {string} opts.prTitle    - PR title for context
 * @param {string} opts.prBody     - PR description (most impactful context — +72% F1)
 * @param {string} [opts.apiKey]   - Ignored (kept for backward compat); provider reads ANTHROPIC_API_KEY
 * @param {string} [opts.model]    - Model override
 * @param {number} [opts.timeoutMs] - Timeout override for CLI providers
 * @returns {Promise<{ summary: string, suggestions: Array }>}
 */
export async function getAICodeReview({ diff, prTitle, prBody, apiKey: _apiKey, model, timeoutMs }) {
  const provider = await selectProvider()

  const system = SYSTEM_PROMPT
  const user   = buildUserPrompt({ diff, prTitle, prBody })

  const startMs = Date.now()
  let result, tokensIn = null, tokensOut = null, success = false

  try {
    result = await provider.complete({
      system,
      user,
      maxTokens:  MAX_TOKENS,
      model:      model || DEFAULT_MODEL,
      timeoutMs,
    })
    tokensIn  = result.tokensIn
    tokensOut = result.tokensOut
    success   = true
  } finally {
    logAiUsage({
      provider:  provider.id,
      model:     model || DEFAULT_MODEL,
      tokensIn,
      tokensOut,
      latencyMs: Date.now() - startMs,
      success,
    })
  }

  return parseReviewResponse(result.text)
}

// ── listProviders ─────────────────────────────────────────────────────────────

/**
 * Return detection status for all known providers.
 * Useful for settings UI and diagnostics.
 *
 * @returns {Promise<Array<{id: string, displayName: string, available: boolean, version?: string, reason?: string}>>}
 */
export async function listProviders() {
  return listProviderStatus()
}

// ── Backward-compat: re-export AIError so old code using AIError.code still works ──
// (AIError is already exported above; this comment is a marker for audit purposes)
