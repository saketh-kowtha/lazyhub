/**
 * src/utils-core.js — UI-free helpers (logger, path + text sanitizing).
 *
 * Split out of utils.js so CLI commands (doctor, watch-only, serve, --mcp, ...)
 * can use them without loading ink/react/highlight.js (#302). utils.js
 * re-exports everything here, so existing imports keep working.
 */
import { readFileSync, existsSync } from 'fs'
import { join, isAbsolute, dirname } from 'path'
import { homedir } from 'os'
import stringWidth from 'string-width'
import { appendPrivateFile, ensurePrivateDir } from './secure-fs.js'

const LOG_FILE = join(homedir(), '.config', 'lazyhub', 'debug.log')

/**
 * Global logger for debugging. Provides methods for different log levels.
 * Writes logs to ~/.config/lazyhub/debug.log in JSON format.
 */
export const logger = {
  /**
   * Logs an informational message.
   * @param {string} msg - The message to log.
   * @param {Object} [meta] - Additional metadata to include.
   */
  info:  (msg, meta) => log('INFO', msg, meta),

  /**
   * Logs a warning message.
   * @param {string} msg - The warning message.
   * @param {Object} [meta] - Additional metadata.
   */
  warn:  (msg, meta) => log('WARN', msg, meta),

  /**
   * Logs an error message with stack trace if available.
   * @param {string} msg - The error description.
   * @param {Error|any} err - The error object.
   * @param {Object} [meta] - Additional metadata.
   */
  error: (msg, err, meta) => log('ERROR', msg, { 
    ...meta, 
    error: err?.message || String(err),
    stack: err?.stack 
  }),

  /**
   * Logs a debug message.
   * @param {string} msg - The debug message.
   * @param {Object} [meta] - Additional metadata.
   */
  debug: (msg, meta) => log('DEBUG', msg, meta),
}

/**
 * Internal logging helper that writes to the log file.
 * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG).
 * @param {string} message - The message body.
 * @param {Object} [meta] - Extra fields to merge into the JSON entry.
 */
function log(level, message, meta = {}) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    }
    const line = JSON.stringify(entry) + '\n'
    ensurePrivateDir(dirname(LOG_FILE))
    appendPrivateFile(LOG_FILE, line)
  } catch {
    // ignore logging failures
  }
}

/**
 * Reads and parses logs from the log file. Returns them newest first.
 * @returns {Array<Object>} Array of parsed log objects.
 */
export function getLogs() {
  if (!existsSync(LOG_FILE)) return []
  try {
    const content = readFileSync(LOG_FILE, 'utf8')
    return content.trim().split('\n').map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean).reverse() // Newest first
  } catch {
    return []
  }
}

/**
 * Resolves paths starting with ~/ or relative paths to absolute paths.
 * @param {string} p - The path to resolve.
 * @returns {string} The absolute resolved path.
 */
export function resolvePath(p) {
  if (!p) return p
  if (typeof p !== 'string') return p
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  if (isAbsolute(p)) return p
  return join(process.cwd(), p)
}

// Ink draws text in cells using a wide-character table that predates emoji presentation. A
// BMP emoji such as U+2705 is ONE Ink cell but TWO terminal columns, so every line it sits on
// comes out a column wider than Ink believes and shoves the pane border off-screen (#512).
// Following it with a zero-width space gives Ink the second cell the terminal uses.
// Unicode Emoji_Presentation=Yes, BMP only (astral emoji are already two cells in Ink).
const BMP_EMOJI = /([\u231A\u231B\u23E9-\u23EC\u23F0\u23F3\u25FD\u25FE\u2614\u2615\u2648-\u2653\u267F\u2693\u26A1\u26AA\u26AB\u26BD\u26BE\u26C4\u26C5\u26CE\u26D4\u26EA\u26F2\u26F3\u26F5\u26FA\u26FD\u2705\u270A\u270B\u2728\u274C\u274E\u2753-\u2755\u2757\u2795-\u2797\u27B0\u27BF\u2B1B\u2B1C\u2B50\u2B55])(?!\u200B)/g

// Joiners, emoji variation selectors and skin tones glue several code points into one glyph. Ink
// measures per code point and terminals per glyph, so a family emoji can be columns off. Dropping
// the glue draws the parts side by side, which every layer measures the same way.
const GLUE = /[\u200D\uFE0F\u{1F3FB}-\u{1F3FF}]/gu

/**
 * Make text measure the same in Ink and in the terminal: no glyph-gluing code points, and a
 * zero-width space after BMP emoji so Ink reserves both of their columns.
 * @param {string} str text to draw
 * @returns {string} text whose width is the same in Ink and the terminal
 */
export function inkSafe(str) {
  return String(str ?? '').replace(GLUE, '').replace(BMP_EMOJI, '$1\u200B')
}

// \u2500\u2500 Text cleanup for GitHub-provided content \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
//
// One shared cleanup pipeline for every string that comes from GitHub (titles,
// bodies, diffs, logs, annotations, names) before it is drawn in the terminal:
//
//   decode entities (prose only, one pass) -> repair lone surrogates ->
//   remove whole escape strings -> normalise line breaks -> per-code-point
//   filter -> newline/tab handling.
//
// Nothing decodes after the filter, so one pass is enough. Output of the
// markdown renderer, the highlighter and chalk is never passed back through
// here: clean the INPUT to those components. inkSafe() (width only) is applied
// last, at render, and its output is never cleaned again.
//
// Kinds:
//   sanitize       prose line   (decodes entities, newline and tab -> space)
//   sanitizeBlock  prose block  (decodes entities, keeps newlines)
//   sanitizeRaw    raw line     (no decoding)
//   sanitizeLog    raw block    (no decoding, keeps newlines, tabs expanded)
//   sanitizeCode   code line    (control characters are shown as markers)
//   sanitizePath   identifier   (control characters are shown as markers)

/* eslint-disable no-control-regex */

// Code points removed ('strip') or shown as a marker ('mark'). TAB, LF and CR are
// handled separately; ZWJ, variation selectors and skin tones are kept (inkSafe's job).
const FILTER_SRC = [
  '\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f\\x7f-\\x9f',
  '\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180f',
  '\\u200b\\u200c\\u200e\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u206f',
  '\\u3164\\ufeff\\uffa0\\ufff9-\\ufffb\\ufffe\\uffff',
  '\\u{1d173}-\\u{1d17a}\\u{e0000}-\\u{e007f}',
].join('')
const FILTER_RE = new RegExp(`[${FILTER_SRC}]`, 'gu')
// Anything that needs work at all; text without a match is returned as is.
const NEEDS_WORK_RE = new RegExp(`[${FILTER_SRC}\\t\\n\\r\\u2028\\u2029\\ud800-\\udfff]`, 'u')

// Whole escape strings, 7-bit and 8-bit forms. Every body class stops at the next
// introducer (ESC or any C1), so each scan is bounded and the whole pass is linear.
// An unterminated string loses only its introducer; the body stays as text.
const ESCAPE_STRING_RE = new RegExp([
  '(?:\\x1b\\[|\\x9b)[\\x30-\\x3f]*[\\x20-\\x2f]*[\\x40-\\x7e]',
  '(?:\\x1b\\]|\\x9d)[^\\x07\\x1b\\x80-\\x9f]*(?:\\x07|\\x1b\\\\|\\x9c)',
  '(?:\\x1b[PX^_]|[\\x90\\x98\\x9e\\x9f])[^\\x1b\\x80-\\x9f]*(?:\\x1b\\\\|\\x9c)',
  '\\x1b[\\x20-\\x2f]*[\\x30-\\x7e]',
].join('|'), 'g')

/* eslint-enable no-control-regex */

const NONCHARACTER_RE = /[\ufffe\uffff]/g
const BREAKS_STRIP_RE = /\r\n?|[\u2028\u2029\u0085]/g
const BREAKS_MARK_RE = /\r\n?|[\u2028\u2029]/g
const PRINTABLE_ASCII_RE = /^[\x20-\x7e]*$/
const ENTITY_RE = /&(?:amp|lt|gt|quot|#(\d+));/g
const NAMED_ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"' }

/**
 * Single-pass entity decoder: the five common entities plus decimal references.
 * A reference that is not a usable character becomes U+FFFD. Never throws.
 * @param {string} str
 * @returns {string}
 */
function decodeEntities(str) {
  if (!str.includes('&')) return str
  return str.replace(ENTITY_RE, (match, digits) => {
    if (digits === undefined) return NAMED_ENTITIES[match]
    const n = Number(digits)
    if (!Number.isSafeInteger(n) || n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '\ufffd'
    return String.fromCodePoint(n)
  })
}

/**
 * Decode HTML character entities (&amp; &lt; &gt; &quot; and decimal &#NNN;).
 * Only these are decoded; hex references stay as text. A malformed or unusable
 * numeric reference becomes U+FFFD instead of throwing. Decoding happens once.
 * This is NOT a display cleaner: never render its output without sanitize().
 * @param {string} str - String possibly containing HTML entities.
 * @returns {string} String with entities decoded.
 */
export function decodeHtmlEntities(str) {
  if (typeof str !== 'string') return String(str || '')
  return decodeEntities(str)
}

/** @param {string} ch one matched code point */
function markReplacer(ch) {
  const cp = /** @type {number} */ (ch.codePointAt(0))
  if (cp < 0x20) return String.fromCharCode(0x2400 + cp)
  if (cp === 0x7f) return '\u2421'
  if (cp === 0xfffe || cp === 0xffff) return '\ufffd'
  return `<U+${cp.toString(16).toUpperCase().padStart(4, '0')}>`
}

/** @param {string} seg */
function segmentWidth(seg) {
  return PRINTABLE_ASCII_RE.test(seg) ? seg.length : stringWidth(seg)
}

/**
 * Expand TABs to 4-column stops, line by line.
 * @param {string} text
 * @returns {string}
 */
function expandTabStops(text) {
  if (!text.includes('\t')) return text
  return text.split('\n').map(line => {
    if (!line.includes('\t')) return line
    const segs = line.split('\t')
    let out = segs[0]
    let col = segmentWidth(segs[0])
    for (let i = 1; i < segs.length; i++) {
      const pad = 4 - (col % 4)
      out += ' '.repeat(pad) + segs[i]
      col += pad + segmentWidth(segs[i])
    }
    return out
  }).join('\n')
}

/**
 * The shared pipeline behind every exported cleanup function. Total: it never throws.
 * @param {unknown} input
 * @param {{decode: boolean, multiline: boolean, mark: boolean, tabs: 'space'|'expand'|'keep'}} opts
 * @returns {string}
 */
function cleanText(input, opts) {
  let s = typeof input === 'string' ? input : String(input ?? '')
  if (opts.decode) s = decodeEntities(s)
  if (!NEEDS_WORK_RE.test(s)) return s
  if (!s.isWellFormed()) s = s.toWellFormed()
  if (opts.mark) {
    s = s.replace(BREAKS_MARK_RE, '\n').replace(FILTER_RE, markReplacer)
  } else {
    s = s.replace(ESCAPE_STRING_RE, '').replace(BREAKS_STRIP_RE, '\n').replace(NONCHARACTER_RE, '\ufffd').replace(FILTER_RE, '')
  }
  if (!opts.multiline) s = s.replace(/\n/g, ' ')
  if (opts.tabs === 'space') s = s.replace(/\t/g, ' ')
  else if (opts.tabs === 'expand') s = expandTabStops(s)
  return s
}

const PROSE_LINE = { decode: true, multiline: false, mark: false, tabs: /** @type {const} */ ('space') }
const PROSE_BLOCK = { decode: true, multiline: true, mark: false, tabs: /** @type {const} */ ('expand') }
const RAW_LINE = { decode: false, multiline: false, mark: false, tabs: /** @type {const} */ ('space') }
const RAW_BLOCK = { decode: false, multiline: true, mark: false, tabs: /** @type {const} */ ('expand') }
const CODE_LINE = { decode: false, multiline: false, mark: true, tabs: /** @type {const} */ ('expand') }
const IDENTIFIER = { decode: false, multiline: false, mark: true, tabs: /** @type {const} */ ('space') }

/**
 * A label colour from GitHub as a drawable hex colour: exactly six hex digits, else undefined.
 * @param {unknown} color
 * @returns {string|undefined}
 */
export function safeHex(color) {
  return typeof color === 'string' && /^[0-9a-fA-F]{6}$/.test(color) ? `#${color}` : undefined
}

/**
 * Clean one line of GitHub prose (titles, user, repo, label and workflow names,
 * notification subjects): entities decoded once, escape strings and control
 * characters removed, newlines and tabs become spaces. Apply once, at render.
 * @param {unknown} str - The string from the API.
 * @returns {string} Text that is safe to draw.
 */
export function sanitize(str) {
  return cleanText(str, PROSE_LINE)
}

/**
 * Clean a block of GitHub prose (bodies, comments): like sanitize() but keeps
 * line breaks. This is the input to the markdown renderer.
 * @param {unknown} str
 * @returns {string}
 */
export function sanitizeBlock(str) {
  return cleanText(str, PROSE_BLOCK)
}

/**
 * Clean one line of raw text that is not HTML-escaped (commit subjects, check
 * names, annotation titles, error text). No entity decoding. Idempotent.
 * @param {unknown} str
 * @returns {string}
 */
export function sanitizeRaw(str) {
  return cleanText(str, RAW_LINE)
}

/**
 * Clean raw multi-line text (CI logs, annotation messages, AI provider output):
 * no entity decoding, line breaks kept, tabs expanded. Idempotent.
 * @param {unknown} str
 * @returns {string}
 */
export function sanitizeLog(str) {
  return cleanText(str, RAW_BLOCK)
}

/**
 * Clean one line of code (diff content, hunk headers). Control characters are
 * shown as visible markers so a reviewer can see they are there. Idempotent.
 * @param {unknown} str
 * @returns {string}
 */
export function sanitizeCode(str) {
  return cleanText(str, CODE_LINE)
}

/**
 * Clean an identifier shown to a person (file path, branch or ref name). Control
 * characters are shown as visible markers. Display only: keep the raw value for
 * writes and lookups. Idempotent.
 * @param {unknown} str
 * @returns {string}
 */
export function sanitizePath(str) {
  return cleanText(str, IDENTIFIER)
}

/**
 * Remove escape strings and control characters from text, keeping newlines and
 * tabs. Non-strings are returned unchanged. Idempotent.
 * @param {string} str - The string to clean.
 * @returns {string} The cleaned string.
 */
export function stripAnsi(str) {
  if (typeof str !== 'string') return str
  return cleanText(str, { decode: false, multiline: true, mark: false, tabs: 'keep' })
}
