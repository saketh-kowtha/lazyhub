/**
 * src/ai.js — Anthropic API client for AI-powered code review
 *
 * IMPORTANT: This is NOT in executor.js. executor.js is gh-CLI-only.
 * This module makes direct HTTP calls to the Anthropic API using Node's
 * built-in fetch() (Node 20+). All calls must originate here.
 *
 * Usage:
 *   import { getAICodeReview, AIError } from './ai.js'
 *   const result = await getAICodeReview({ diff, prTitle, prBody, apiKey })
 *   // result: { summary: string, suggestions: [{file, line, severity, comment}] }
 */

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MODEL      = 'claude-sonnet-4-6-20260218'
const MAX_TOKENS         = 4096
const MAX_DIFF_CHARS     = 8000

const VALID_SEVERITIES = new Set(['bug', 'warning', 'suggestion'])

const SYSTEM_PROMPT = `You are a senior code reviewer. Analyze the unified diff and return ONLY a JSON object with exactly this shape:
{
  "summary": "<1-3 sentence overall assessment of the changes>",
  "suggestions": [
    {
      "file": "<filename relative path>",
      "line": <new line number as integer, or null if not line-specific>,
      "severity": "bug" | "warning" | "suggestion",
      "comment": "<concise, actionable comment>"
    }
  ]
}

Rules:
- Return ONLY the JSON object. No markdown fences, no explanation outside the JSON.
- "bug" = likely runtime error or security issue
- "warning" = potential problem or poor practice
- "suggestion" = style, performance, or readability improvement
- Keep each comment under 100 characters.
- If the diff looks correct, return an empty suggestions array with a positive summary.`

/**
 *
 */
export class AIError extends Error {
  /**
   *
   * @param message
   * @param root0
   * @param root0.status
   * @param root0.code
   */
  constructor(message, { status, code } = {}) {
    super(message)
    this.name = 'AIError'
    this.status = status
    this.code = code
  }
}

/**
 * Send a unified diff to Claude and get structured code review feedback.
 *
 * @param {object} opts
 * @param {string} opts.diff       - Unified diff text (truncated to MAX_DIFF_CHARS)
 * @param {string} opts.prTitle    - PR title for context
 * @param {string} opts.prBody     - PR description (first 500 chars recommended)
 * @param {string} opts.apiKey     - Anthropic API key (sk-ant-...)
 * @param {string} [opts.model]    - Model override (defaults to claude-haiku)
 * @returns {Promise<{ summary: string, suggestions: Array }>}
 * @throws {AIError}
 */
export async function getAICodeReview({ diff, prTitle, prBody, apiKey, model }) {
  if (!apiKey) throw new AIError('No API key provided')

  const truncatedDiff = (diff || '').slice(0, MAX_DIFF_CHARS)

  const userMessage = [
    `PR Title: ${prTitle || '(untitled)'}`,
    prBody ? `PR Description: ${prBody}` : null,
    '',
    '--- Diff ---',
    truncatedDiff || '(empty diff)',
  ].filter(s => s !== null).join('\n')

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
        model:      model || DEFAULT_MODEL,
        max_tokens: MAX_TOKENS,
        system:     SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })
  } catch (err) {
    throw new AIError(`Network error: ${err.message}`)
  }

  if (!response.ok) {
    const status = response.status
    if (status === 401) throw new AIError('Invalid API key', { status })
    if (status === 429) throw new AIError('Rate limit exceeded — try again shortly', { status })
    if (status >= 500)  throw new AIError('Anthropic service error — try again', { status })
    throw new AIError(`API error: ${status}`, { status })
  }

  let body
  try {
    body = await response.json()
  } catch {
    throw new AIError('Could not parse API response as JSON')
  }

  const rawText = body?.content?.[0]?.text
  if (typeof rawText !== 'string') {
    throw new AIError('AI response format was unexpected')
  }

  // Strip accidental markdown fences
  const cleaned = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new AIError('Could not parse AI response as JSON')
  }

  if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.suggestions)) {
    throw new AIError('AI response format was unexpected')
  }

  const suggestions = parsed.suggestions.map(s => ({
    file:     typeof s.file    === 'string' ? s.file    : '',
    line:     typeof s.line    === 'number' ? Math.floor(s.line) : null,
    severity: VALID_SEVERITIES.has(s.severity) ? s.severity : 'suggestion',
    comment:  typeof s.comment === 'string' ? s.comment : '',
  }))

  return {
    summary:     parsed.summary,
    suggestions,
  }
}
