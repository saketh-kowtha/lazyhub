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
import * as anthropicApi from './providers/anthropic-api.js'
import * as openaiCompatible from './providers/openai-compatible.js'

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
 * @param {object|string} [opts.authorHint] - Optional PR author hint for cross-model review routing
 * @returns {Promise<{ summary: string, suggestions: Array, secondOpinion?: { authorFamily: string, selected: string, fallback: boolean, note?: string } }>}
 */
export async function getAICodeReview({ diff, prTitle, prBody, apiKey: _apiKey, model, timeoutMs, authorHint }) {
  const { provider, secondOpinion } = await selectProvider({ authorHint })

  const system = SYSTEM_PROMPT
  const user   = buildUserPrompt({ diff, prTitle, prBody })

  const startMs = Date.now()
  let result, tokensIn = null, tokensOut = null, success = false

  try {
    result = await provider.complete({
      system,
      user,
      maxTokens:  MAX_TOKENS,
      model,
      timeoutMs,
    })
    tokensIn  = result.tokensIn
    tokensOut = result.tokensOut
    success   = true
  } finally {
    logAiUsage({
      provider:  provider.id,
      model:     result?.modelUsed || model || DEFAULT_MODEL,
      tokensIn,
      tokensOut,
      latencyMs: Date.now() - startMs,
      success,
    })
  }

  const parsed = parseReviewResponse(result.text)
  return { ...parsed, secondOpinion: secondOpinion || undefined }
}

// ── runAIChat ─────────────────────────────────────────────────────────────────

const CHAT_TIMEOUT_MS = 60_000

/**
 * Map the user's `[ai]` settings to the HTTP provider that serves tool-use
 * chat plus its connection details. Chat honours the explicit `ai.provider`
 * choice (CLI providers cannot do tool use, so auto-detection does not apply).
 * @param {object} aiConfig
 * @returns {{provider: object, conn: object}}
 */
function resolveChatProvider(aiConfig = {}) {
  const compat = aiConfig.openai_compatible || aiConfig.openaiCompatible
  switch (aiConfig.provider) {
    case 'openai':
      return { provider: openaiCompatible, conn: {
        baseUrl: (aiConfig.openaiBaseUrl || 'https://api.openai.com/v1').replace(/\/$/, ''),
        apiKey:  aiConfig.openaiApiKey,
        model:   aiConfig.model || 'gpt-4o',
      } }
    case 'ollama':
      return { provider: openaiCompatible, conn: {
        baseUrl: (aiConfig.openaiBaseUrl || 'http://localhost:11434/v1').replace(/\/$/, ''),
        apiKey:  aiConfig.openaiApiKey,
        model:   aiConfig.model || 'llama3',
      } }
    case 'openai-compatible':
      return { provider: openaiCompatible, conn: {
        baseUrl: compat?.base_url,
        apiKey:  compat?.api_key,
        model:   compat?.model,
      } }
    default:
      return { provider: anthropicApi, conn: { apiKey: aiConfig.anthropicApiKey, model: aiConfig.model || undefined } }
  }
}

/**
 * Run ONE round of a tool-capable conversation (the in-TUI assistant) through
 * the configured HTTP provider and record its usage. The caller owns the loop,
 * history and tool execution; this never executes tools. Usage is logged here,
 * once per round, and callers must not log it again. Prompts, tool payloads and
 * credentials are never logged.
 *
 * @param {object} opts
 * @param {object} opts.aiConfig   - The `[ai]` settings (provider, keys, model, ...)
 * @param {string} opts.system     - System prompt
 * @param {Array}  opts.messages   - Conversation in the selected provider's native format
 * @param {Array}  [opts.tools]    - Tool definitions ({name, description, input_schema})
 * @param {number} [opts.maxTokens]
 * @param {number} [opts.timeoutMs]
 * @param {AbortSignal} [opts.signal]
 * @returns {Promise<{message: object, text: string, toolCalls: Array<{id: string, name: string, input: object}>, toolResultMessage: (id: string, content: string) => object}>}
 */
export async function runAIChat({ aiConfig, system, messages, tools, maxTokens, timeoutMs, signal }) {
  const { provider, conn } = resolveChatProvider(aiConfig)
  const timeout = AbortSignal.timeout(timeoutMs || aiConfig?.openai_compatible?.timeout_ms || CHAT_TIMEOUT_MS)

  const startMs = Date.now()
  let result, success = false
  try {
    result = await provider.chat({
      ...conn,
      system,
      messages,
      tools,
      maxTokens,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    })
    success = true
  } finally {
    logAiUsage({
      provider:  provider.id,
      model:     result?.modelUsed || conn.model || DEFAULT_MODEL,
      tokensIn:  result?.tokensIn ?? null,
      tokensOut: result?.tokensOut ?? null,
      latencyMs: Date.now() - startMs,
      success,
    })
  }
  return {
    message:   result.message,
    text:      result.text,
    toolCalls: result.toolCalls,
    toolResultMessage: provider.toolResultMessage,
  }
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
