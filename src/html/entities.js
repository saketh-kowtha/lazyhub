/**
 * src/html/entities.js - the single character-reference decoder of the HTML path.
 *
 * Applied exactly once per text node or attribute value, to text that was never decoded before.
 * Its output never re-enters the tokenizer, this decoder or the Markdown inline parser.
 * Handles decimal and hex numeric references plus a small named set; everything else stays text.
 * Linear time: one pass, and each reference looks at most MAX_REF characters ahead.
 */
import { LIMITS } from './types.js'

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  colon: ':', Tab: '\t', NewLine: '\n', lpar: '(', rpar: ')', sol: '/', period: '.',
  copy: '\u00a9', reg: '\u00ae', trade: '\u2122', hellip: '\u2026', mdash: '\u2014', ndash: '\u2013',
  lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d', bull: '\u2022', middot: '\u00b7',
  times: '\u00d7', rarr: '\u2192', larr: '\u2190',
}

const MAX_REF = 14

function isDigit(c, hex) {
  return (c >= 48 && c <= 57) || (hex && ((c >= 97 && c <= 102) || (c >= 65 && c <= 70)))
}

function scalar(n) {
  if (!Number.isSafeInteger(n) || n === 0 || n > 0x10ffff) return '\ufffd'
  if (n >= 0xd800 && n <= 0xdfff) return '\ufffd'
  if ((n >= 0xfdd0 && n <= 0xfdef) || (n & 0xfffe) === 0xfffe) return '\ufffd'
  return String.fromCodePoint(n)
}

/**
 * Decode character references once.
 * @param {string} str
 * @returns {string}
 */
export function decodeEntitiesOnce(str) {
  if (typeof str !== 'string') return ''
  let at = str.indexOf('&')
  if (at < 0) return str
  let out = ''
  let last = 0
  while (at >= 0) {
    // The terminator must be close: never scan far for a ';'.
    let semi = -1
    const stop = Math.min(str.length, at + 1 + MAX_REF)
    for (let k = at + 1; k < stop; k++) {
      if (str.charCodeAt(k) === 59) { semi = k; break }
    }
    let replacement = null
    if (semi > at) {
      const body = str.slice(at + 1, semi)
      if (body.charCodeAt(0) === 35) {
        const hex = body.charCodeAt(1) === 120 || body.charCodeAt(1) === 88
        const digits = body.slice(hex ? 2 : 1)
        let ok = digits.length > 0
        for (let k = 0; k < digits.length && ok; k++) ok = isDigit(digits.charCodeAt(k), hex)
        if (ok) replacement = digits.length > LIMITS.MAX_NUMERIC_DIGITS ? '\ufffd' : scalar(parseInt(digits, hex ? 16 : 10))
      } else if (Object.hasOwn(NAMED, body)) {
        replacement = NAMED[body]
      }
    }
    if (replacement === null) {
      at = str.indexOf('&', at + 1)
      continue
    }
    out += str.slice(last, at) + replacement
    last = semi + 1
    at = str.indexOf('&', last)
  }
  return out + str.slice(last)
}
