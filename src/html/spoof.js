/**
 * src/html/spoof.js - text cleanup for everything that comes out of HTML.
 *
 * cleanHtmlText = decode references once -> remove escape strings and control characters (the shared
 * sanitizeLog, which does NOT decode again) -> remove characters that hide or reorder text.
 */
import { sanitizeLog } from '../utils-core.js'
import { decodeEntitiesOnce } from './entities.js'

// Bidi controls, zero-width and joiner characters, variation selectors, tag characters, and the two
// angle quotes that frame our own markers (untrusted text must not be able to draw a marker).
const SPOOF_RE = /[\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufe00-\ufe0f\ufeff\u2039\u203a\u{e0000}-\u{e007f}]/gu
const SPOOF_TEST_RE = /[\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufe00-\ufe0f\ufeff\u{e0000}-\u{e007f}]/u

/** @param {string} s */
export function stripSpoofChars(s) {
  return String(s ?? '').replace(SPOOF_RE, '')
}

/**
 * True when the text holds a character that hides or reorders text (used for URLs: reject, not strip).
 * @param {string} s
 * @returns {boolean}
 */
export function hasSpoofChars(s) {
  return SPOOF_TEST_RE.test(String(s ?? ''))
}

/**
 * Clean untrusted HTML text: undecoded in, display-safe out.
 * @param {string} raw
 * @returns {string}
 */
export function cleanHtmlText(raw) {
  const clean = sanitizeLog(decodeEntitiesOnce(raw))
  return SPOOF_TEST_RE.test(clean) || clean.includes('\u2039') || clean.includes('\u203a') ? stripSpoofChars(clean) : clean
}
