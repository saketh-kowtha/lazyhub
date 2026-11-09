/**
 * src/html/types.js - contract for rendering HTML found inside Markdown bodies.
 *
 * Pipeline (each stage only sees the previous stage's output):
 *   tokenize.js  segment text (undecoded)  ->  tokens
 *   tree.js      tokens                    ->  allowlisted node tree (text and attribute values cleaned once)
 *   render.js    node tree                 ->  lines of styled runs  ->  Ink rows
 *
 * Node shape:
 *   { type: 'el',     name: string, attrs: Record<string,string>, children: Node[] }
 *   { type: 'text',   value: string }     already decoded once, cleaned, spoof characters removed
 *   { type: 'notice', value: string }     a dim marker such as "embedded content removed"
 *
 * Token shape (tokenize.js):
 *   { type: 'text', value } | { type: 'code', value } | { type: 'open', name, attrs, selfClosing }
 *   | { type: 'close', name } | { type: 'drop', name } | { type: 'notice', value }
 *
 * Every limit below, when reached, produces a visible notice and never silent loss.
 */

export const LIMITS = Object.freeze({
  /** HTML bytes (UTF-16 units) tokenized per body. */
  MAX_BYTES: 512 * 1024,
  /** Tokens per body. */
  MAX_TOKENS: 50000,
  /** Open-element nesting depth; deeper tags are treated as unknown (their text is kept). */
  MAX_DEPTH: 32,
  /** Attributes kept per tag (extra attributes are parsed and dropped). */
  MAX_ATTRS: 16,
  /** Attribute value length; a value this long is truncated and a URL made from it is rejected. */
  MAX_ATTR_LEN: 2048,
  /** Longest tag name; a longer name makes the whole tag literal text. */
  MAX_TAG_NAME: 32,
  /** Digits accepted in a numeric character reference. */
  MAX_NUMERIC_DIGITS: 8,
  TABLE_COLS: 16,
  TABLE_ROWS: 500,
  TABLE_CELLS: 10000,
  TABLE_CELL_WIDTH: 40,
  /** Output rows per body once HTML was involved. */
  MAX_ROWS: 2000,
  /** Columns of path and query shown after a link host. */
  URL_PATH_COLS: 48,
})

/** Marker texts. The markers use U+2039 and U+203A, which are removed from all untrusted text. */
export const NOTICE = Object.freeze({
  EMBEDDED: 'embedded content removed',
  UNSAFE_LINK: 'unsafe link removed',
  UNSAFE_SOURCE: 'unsafe source removed',
  CREDENTIALS: 'credentials in URL',
  TOO_LARGE: 'HTML rendering stopped: body too large',
  TOO_DEEP: 'nesting too deep',
})

/** @typedef {{bytes: number, tokens: number, stopped: boolean, deepNoticed: boolean}} Budget */

/**
 * A fresh per-body budget, shared by every HTML segment of one body.
 * @returns {Budget}
 */
export function newBudget() {
  return { bytes: 0, tokens: 0, stopped: false, deepNoticed: false }
}
