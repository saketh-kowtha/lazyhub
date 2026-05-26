/**
 * src/ai/parse.js — Response parsing for AI code review.
 *
 * Extracted unchanged from src/ai.js.
 * Handles JSON extraction, markdown fence stripping, and suggestion shape normalization.
 */

import { AIError } from './error.js'
import { VALID_SEVERITIES } from './prompt.js'

/**
 * Parse the raw text response from any AI provider into a structured review object.
 * @param {string} rawText - Raw text from the AI provider
 * @returns {{ summary: string, suggestions: Array }} Parsed review
 */
export function parseReviewResponse(rawText) {
  if (typeof rawText !== 'string') {
    throw new AIError('Unexpected API response format', { code: 'malformed-response' })
  }

  const cleaned = rawText
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new AIError('Could not parse AI response as JSON', { code: 'malformed-response' })
  }

  if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.suggestions)) {
    throw new AIError('AI response structure was unexpected', { code: 'malformed-response' })
  }

  const suggestions = parsed.suggestions
    .filter(s => s && typeof s.comment === 'string' && s.comment.trim())
    .slice(0, 6)
    .map(s => ({
      file:     typeof s.file    === 'string' ? s.file    : '',
      line:     typeof s.line    === 'number' ? Math.floor(s.line) : null,
      severity: VALID_SEVERITIES.has(s.severity) ? s.severity : 'suggestion',
      comment:  s.comment.trim(),
    }))

  return { summary: parsed.summary, suggestions }
}
