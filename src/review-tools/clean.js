/**
 * src/review-tools/clean.js - the last cleanup before a review-tool result leaves lazyhub
 * (MCP or `--json` CLI, #603 / #627). UI-free.
 *
 * The engines already clean the fields they own (titles with sanitize(), paths with
 * sanitizePath(), log lines with the redacting excerpt code). This pass is the safety net
 * over the whole result: every string, at any depth, goes through sanitizeLog(), which
 * removes terminal escapes (CSI, OSC, DCS), C0/C1 controls, bidi overrides and zero-width
 * characters, keeps line breaks and never decodes entities (THREAT_MODEL T20). The helpers
 * are idempotent, so a field that was already cleaned is unchanged.
 */

import { sanitizeLog } from '../utils-core.js'

/** Deeper than any result shape; past it a value is dropped rather than walked. */
const MAX_DEPTH = 16

/**
 * A copy of `value` with every string cleaned. Non-finite numbers become null (JSON has no
 * NaN), functions and undefined are dropped, and object keys keep their order.
 *
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {any}
 */
export function cleanDeep(value, depth = 0) {
  if (typeof value === 'string') return sanitizeLog(value)
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (value === null || typeof value === 'boolean') return value
  if (depth >= MAX_DEPTH) return null
  if (Array.isArray(value)) return value.map(v => (v === undefined || typeof v === 'function' ? null : cleanDeep(v, depth + 1)))
  if (typeof value === 'object') {
    /** @type {Record<string, any>} */
    const out = {}
    for (const [k, v] of Object.entries(/** @type {Record<string, any>} */ (value))) {
      if (v === undefined || typeof v === 'function') continue
      out[sanitizeLog(k)] = cleanDeep(v, depth + 1)
    }
    return out
  }
  return null
}
