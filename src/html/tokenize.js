/**
 * src/html/tokenize.js - bounded, linear-time HTML tokenizer (no dependency, no regex over input).
 *
 * Input is one segment of UNDECODED text (control characters were already removed by the caller).
 * Output is a token list; see types.js. Nothing is interpreted: no entity expansion, no DOCTYPE
 * internals. Everything that is not a well-formed tag stays literal text, so nothing is hidden
 * silently. The only time-unbounded loops are guarded by a scan budget and by "not found" memos.
 */
import { LIMITS, NOTICE } from './types.js'

/** Elements dropped together with their content. A single marker is shown per element. */
const DROP = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'template', 'noscript', 'textarea', 'title',
  'xmp', 'plaintext', 'noembed', 'noframes', 'frameset', 'frame', 'head', 'select', 'form', 'input', 'button',
  'video', 'audio', 'canvas',
])
/** Dropped elements that have no content to skip. */
const DROP_VOID = new Set(['embed', 'frame', 'input'])
const ATTRS = {
  a: ['href'], img: ['src', 'alt'], ol: ['start'], details: ['open'], td: ['colspan'], th: ['colspan'],
}
const VOID = new Set(['br', 'hr', 'img', 'source', 'wbr'])

function isSpace(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12
}
function isAlpha(c) {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90)
}
function isNameChar(c) {
  return isAlpha(c) || (c >= 48 && c <= 57) || c === 45
}

/**
 * Case-insensitive (ASCII) search for `</name`, from `from`. Returns the index or -1.
 * @param {string} src
 * @param {string} name
 * @param {number} from
 * @returns {number}
 */
function indexOfClose(src, name, from) {
  const n = src.length
  const m = name.length + 2
  for (let i = src.indexOf('</', from); i >= 0 && i + m <= n; i = src.indexOf('</', i + 2)) {
    let k = 0
    while (k < name.length && (src.charCodeAt(i + 2 + k) | 32) === name.charCodeAt(k)) k++
    if (k === name.length) {
      const after = src.charCodeAt(i + m)
      if (i + m === n || !isNameChar(after)) return i
    }
  }
  return -1
}

/**
 * Read one attribute at p (p is on its first character). Returns null for an unterminated quote.
 * @param {string} src
 * @param {number} start
 * @returns {{name: string, value: string, end: number} | null}
 */
function readAttribute(src, start) {
  const n = src.length
  let p = start
  while (p < n) {
    const d = src.charCodeAt(p)
    if (isSpace(d) || d === 61 || d === 62 || d === 47) break
    p++
  }
  const name = src.slice(start, p).toLowerCase()
  while (p < n && isSpace(src.charCodeAt(p))) p++
  if (src.charCodeAt(p) !== 61) return { name, value: '', end: p }
  p++
  while (p < n && isSpace(src.charCodeAt(p))) p++
  const q = src.charCodeAt(p)
  if (q === 34 || q === 39) {
    const close = src.indexOf(q === 34 ? '"' : "'", p + 1)
    if (close < 0) return null
    return { name, value: src.slice(p + 1, close), end: close + 1 }
  }
  const vStart = p
  while (p < n && !isSpace(src.charCodeAt(p)) && src.charCodeAt(p) !== 62) p++
  return { name, value: src.slice(vStart, p), end: p }
}

/**
 * Parse a tag starting at `<` (index i). Returns null when it must stay literal text; `token` is
 * null when it failed after scanning (the caller charges the scan to its budget).
 * @param {string} src
 * @param {number} i
 * @returns {{token: object | null, end: number, scanned: number} | null}
 */
function parseTag(src, i) {
  const n = src.length
  let p = i + 1
  const closing = src.charCodeAt(p) === 47
  if (closing) p++
  if (!isAlpha(src.charCodeAt(p))) return null
  const nameStart = p
  while (p < n && isNameChar(src.charCodeAt(p))) {
    p++
    if (p - nameStart > LIMITS.MAX_TAG_NAME) return null
  }
  const name = src.slice(nameStart, p).toLowerCase()
  const allowed = ATTRS[name]
  const attrs = {}
  let count = 0
  let selfClosing = false
  const failed = { token: null, end: n, scanned: n - i }
  for (;;) {
    while (p < n && isSpace(src.charCodeAt(p))) p++
    if (p >= n) return failed
    const c = src.charCodeAt(p)
    if (c === 62) { p++; break }
    if (c === 47) {
      p++
      if (src.charCodeAt(p) === 62) { selfClosing = true; p++; break }
      continue
    }
    const attr = readAttribute(src, p)
    if (!attr) return failed
    p = attr.end > p ? attr.end : p + 1
    if (closing || !attr.name) continue
    count++
    if (count > LIMITS.MAX_ATTRS || !allowed || !allowed.includes(attr.name) || Object.hasOwn(attrs, attr.name)) continue
    attrs[attr.name] = attr.value.length > LIMITS.MAX_ATTR_LEN ? attr.value.slice(0, LIMITS.MAX_ATTR_LEN) : attr.value
  }
  const token = closing ? { type: 'close', name } : { type: 'open', name, attrs, selfClosing: selfClosing || VOID.has(name) }
  return { token, end: p, scanned: p - i }
}

/**
 * End index of a comment starting at i, or -1 when it is unterminated. `memo` remembers
 * terminators known to be absent, so repeated unterminated comments cost one scan in total.
 * @param {string} src
 * @param {number} i
 * @param {{noDash: boolean, noBang: boolean}} memo
 * @returns {number}
 */
function commentEnd(src, i, memo) {
  if (src.startsWith('<!-->', i)) return i + 5
  if (src.startsWith('<!--->', i)) return i + 6
  const a = memo.noDash ? -1 : src.indexOf('-->', i + 4)
  const b = memo.noBang ? -1 : src.indexOf('--!>', i + 4)
  if (a < 0) memo.noDash = true
  if (b < 0) memo.noBang = true
  if (a < 0 && b < 0) return -1
  if (a < 0) return b + 4
  if (b < 0) return a + 3
  return Math.min(a + 3, b + 4)
}

/**
 * End index of a Markdown code span opening at i (a run of backticks), or -1. Looks at most 2000
 * characters ahead; a run length that found no closer to the end of input is remembered.
 * @param {string} src
 * @param {number} i
 * @param {number} run
 * @param {Set<number>} noClose
 * @returns {number}
 */
function codeSpanEnd(src, i, run, noClose) {
  if (noClose.has(run)) return -1
  const n = src.length
  const limit = Math.min(n, i + run + 2000)
  for (let k = src.indexOf('`', i + run); k >= 0 && k < limit;) {
    let r = 1
    while (src.charCodeAt(k + r) === 96) r++
    if (r === run) return k
    k = src.indexOf('`', k + r)
  }
  if (limit >= n) noClose.add(run)
  return -1
}

/**
 * End of a dropped element: after its closer, or the end of the segment when there is none.
 * @param {string} src
 * @param {{name: string, selfClosing: boolean}} tok
 * @param {number} afterOpen
 * @returns {number}
 */
function dropEnd(src, tok, afterOpen) {
  if (DROP_VOID.has(tok.name) || tok.selfClosing) return afterOpen
  const close = indexOfClose(src, tok.name, afterOpen)
  if (close < 0) return src.length
  const gt = src.indexOf('>', close)
  return gt < 0 ? src.length : gt + 1
}

/**
 * @param {string} src undecoded segment text
 * @param {{md?: boolean, budget: {tokens: number, stopped: boolean}}} opts md: also recognise Markdown code spans (kept literal)
 * @returns {Array<object>}
 */
export function tokenize(src, opts) {
  const budget = opts.budget
  const tokens = []
  const n = src.length
  let i = 0
  let textStart = 0
  let scanBudget = 2 * n + 4096
  let noBogusEnd = false
  const commentMemo = { noDash: false, noBang: false }
  const noCodeClose = new Set()

  const flush = to => {
    if (to > textStart) tokens.push({ type: 'text', value: src.slice(textStart, to) })
  }
  const push = tok => {
    flush(i)
    tokens.push(tok)
    budget.tokens++
  }
  const skipTo = end => {
    flush(i)
    i = textStart = end
  }
  const stop = () => {
    // The remainder becomes plain text plus a visible notice; nothing is parsed from here on.
    flush(i)
    if (i < n) tokens.push({ type: 'text', value: src.slice(i) })
    tokens.push({ type: 'notice', value: NOTICE.TOO_LARGE })
    budget.stopped = true
    i = textStart = n
  }
  // <!-- comment -->, <!bogus>, <?pi>, <![CDATA[ ... >
  const markup = () => {
    if (src.startsWith('<!--', i)) {
      const end = commentEnd(src, i, commentMemo)
      if (end < 0) i += 4 // unterminated: stays literal text
      else skipTo(end)
      return
    }
    const gt = noBogusEnd ? -1 : src.indexOf('>', i + 2)
    if (gt < 0) { noBogusEnd = true; i++ } else skipTo(gt + 1)
  }
  const tag = () => {
    const parsed = parseTag(src, i)
    if (!parsed || !parsed.token) {
      if (parsed) scanBudget -= parsed.scanned
      i++
      return
    }
    const tok = parsed.token
    if (tok.type === 'open' && DROP.has(tok.name)) {
      const end = dropEnd(src, tok, parsed.end)
      push({ type: 'drop', name: tok.name })
      i = textStart = end
    } else if (tok.type === 'close' && DROP.has(tok.name)) {
      skipTo(parsed.end) // a stray close of a dropped element shows nothing
    } else {
      push(tok)
      i = textStart = parsed.end
    }
  }

  while (i < n) {
    if (budget.tokens >= LIMITS.MAX_TOKENS || scanBudget < 0) { stop(); break }
    const c = src.charCodeAt(i)
    if (c === 96 && opts.md) {
      let run = 1
      while (src.charCodeAt(i + run) === 96) run++
      const end = codeSpanEnd(src, i, run, noCodeClose)
      if (end >= 0) {
        push({ type: 'code', value: src.slice(i + run, end) })
        i = textStart = end + run
      } else {
        i += run
      }
    } else if (c !== 60) {
      i++
    } else if (src.charCodeAt(i + 1) === 33 || src.charCodeAt(i + 1) === 63) {
      markup()
    } else {
      tag()
    }
  }
  flush(n)
  return tokens
}
