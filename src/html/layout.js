/**
 * src/html/layout.js - node tree -> lines of styled runs. Pure: no React, no theme, no colours.
 *
 * A Line is { runs: Run[] } (no runs = blank line); a Run is { text, st? } where st holds style
 * KEYS only: b i u s (bold italic underline strikethrough) and c, a token name resolved against
 * the theme later (rows.jsx): dim muted sel border code block mark.
 * Every line measures at most `width` columns, text is already clean (tree.js), and links never
 * carry OSC 8 sequences: a link is its text followed by the real host in a dim marker.
 */
import stringWidth from 'string-width'
import { LIMITS, NOTICE } from './types.js'
import { cleanHtmlText } from './spoof.js'
import { resolveUrl } from './url.js'

const DIM = Object.freeze({ c: 'dim' })
const BLANK = Object.freeze({ runs: [] })
const BLOCKS = new Set([
  'p', 'div', 'section', 'article', 'center', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote',
  'pre', 'hr', 'details', 'summary', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'caption', 'dl', 'dt', 'dd',
  'figure', 'figcaption',
])

const WIDTHS = new Map()

/** @param {string} s */
export function textWidth(s) {
  let wide = false
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 126 || s.charCodeAt(i) < 32) { wide = true; break }
  if (!wide) return s.length
  let w = 0
  for (const ch of s) {
    if (ch.charCodeAt(0) < 127 && ch.charCodeAt(0) > 31) { w++; continue }
    let cw = WIDTHS.get(ch)
    if (cw === undefined) {
      cw = stringWidth(ch)
      if (WIDTHS.size < 4096) WIDTHS.set(ch, cw)
    }
    w += cw
  }
  return w
}

/**
 * Longest prefix of s (by code points) that fits in `max` columns.
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
function cut(s, max) {
  let w = 0
  let i = 0
  for (const ch of s) {
    const cw = textWidth(ch)
    if (w + cw > max) return s.slice(0, i)
    w += cw
    i += ch.length
  }
  return s
}

function ellipsize(s, max) {
  if (max <= 0) return ''
  if (textWidth(s) <= max) return s
  return `${cut(s, max - 1)}\u2026`
}

function marker(text) {
  return { text: `\u2039${text}\u203a`, st: DIM }
}

function isSpaceCode(c) {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12
}

/**
 * Collapse runs of white space to one space (HTML text semantics).
 * @param {string} s
 * @returns {string}
 */
function collapse(s) {
  if (!s.includes('\n') && !s.includes('\t') && !s.includes('\r') && !s.includes('\f') && !s.includes('  ')) return s
  let out = ''
  let inSpace = false
  for (let i = 0; i < s.length; i++) {
    if (isSpaceCode(s.charCodeAt(i))) {
      if (!inSpace) out += ' '
      inSpace = true
    } else {
      out += s[i]
      inSpace = false
    }
  }
  return out
}

function splitMark(parts, mark, style) {
  const out = []
  for (const p of parts) {
    if (p.done) { out.push(p); continue }
    const s = p.text
    let pos = 0
    for (;;) {
      const a = s.indexOf(mark, pos)
      const b = a < 0 ? -1 : s.indexOf(mark, a + mark.length)
      if (a < 0 || b < 0 || b === a + mark.length) break
      if (a > pos) out.push({ text: s.slice(pos, a), st: p.st })
      out.push({ text: s.slice(a + mark.length, b), st: { ...p.st, ...style }, done: true })
      pos = b + mark.length
    }
    if (pos < s.length) out.push({ text: s.slice(pos), st: p.st })
  }
  return out
}

/**
 * Inline Markdown inside a text node: **bold** and *italic* only (code spans were split off by the
 * tokenizer). indexOf only, so a stray marker costs one scan.
 * @param {string} text
 * @param {object} st
 * @returns {Array<{text: string, st: object}>}
 */
function emphasis(text, st) {
  return splitMark(splitMark([{ text, st }], '**', { b: true }), '*', { i: true })
}

/**
 * @typedef {{width: number, base: string, md: boolean, st0: object, pre?: boolean, inList?: boolean, cap?: {left: number}, urls?: Map<string, any>}} Ctx
 */

function plainText(runs) {
  let s = ''
  for (const r of runs) s += r.br ? ' ' : r.text
  return s
}

/**
 * Append the inline content of nodes to `out` as runs.
 * @param {object[]} nodes
 * @param {object} st
 * @param {Ctx} ctx
 * @param {Array<object>} out
 */
function inline(nodes, st, ctx, out) {
  for (const n of nodes) {
    if (n.type === 'text') {
      const value = ctx.pre ? n.value : collapse(n.value)
      if (!value) continue
      if (ctx.md && !ctx.pre) out.push(...emphasis(value, st))
      else out.push({ text: value, st })
    } else if (n.type === 'notice') {
      out.push({ text: ' ' }, marker(n.value), { text: ' ' })
    } else if (n.type === 'el') {
      inlineElement(n, st, ctx, out)
    }
  }
}

const STYLE_OF = {
  b: { b: true }, strong: { b: true }, i: { i: true }, em: { i: true }, u: { u: true }, ins: { u: true },
  s: { s: true }, del: { s: true }, strike: { s: true }, mark: { c: 'mark' }, sub: { c: 'dim' }, sup: { c: 'dim' },
  small: { c: 'dim' }, code: { c: 'code' }, tt: { c: 'code' }, dt: { b: true },
}

function linkRuns(n, st, ctx, out) {
  const start = out.length
  inline(n.children, st, ctx, out)
  if (n.attrs.href === undefined) return
  const res = cachedUrl(n.attrs.href, ctx)
  if (!res.ok) {
    out.push({ text: ' ' }, marker(NOTICE.UNSAFE_LINK))
    return
  }
  const label = plainText(out.slice(start)).trim()
  const sameUrl = label !== '' && (stripSlash(label) === stripSlash(res.href) || label === res.display)
  if (!sameUrl) out.push({ text: ' ' }, marker(res.display))
  if (res.credentials) out.push({ text: ' ' }, marker(NOTICE.CREDENTIALS))
}

function cachedUrl(value, ctx) {
  if (!ctx.urls) ctx.urls = new Map()
  let res = ctx.urls.get(value)
  if (!res) {
    res = resolveUrl(value, { base: ctx.base })
    if (ctx.urls.size < 2048) ctx.urls.set(value, res)
  }
  return res
}

function stripSlash(s) {
  return s.endsWith('/') ? s.slice(0, -1) : s
}

function inlineElement(n, st, ctx, out) {
  const name = n.name
  if (name === 'br') {
    out.push({ br: true })
  } else if (name === 'img') {
    const alt = ellipsize(collapse(cleanHtmlText(n.attrs.alt ?? '')).trim(), 80)
    out.push({ text: alt ? `[image: ${alt}]` : '[image]', st: DIM })
    if (n.attrs.src === undefined) return
    const res = cachedUrl(n.attrs.src, ctx)
    out.push({ text: ' ' }, res.ok ? marker(res.host) : marker(NOTICE.UNSAFE_SOURCE))
    if (res.ok && res.credentials) out.push({ text: ' ' }, marker(NOTICE.CREDENTIALS))
  } else if (name === 'a') {
    linkRuns(n, st, ctx, out)
  } else if (name === 'kbd') {
    out.push({ text: '[', st: DIM })
    inline(n.children, { ...st, c: 'code' }, ctx, out)
    out.push({ text: ']', st: DIM })
  } else if (Object.hasOwn(STYLE_OF, name)) {
    inline(n.children, { ...st, ...STYLE_OF[name] }, ctx, out)
  } else {
    inline(n.children, st, ctx, out)
  }
}

/**
 * Greedy word wrap of runs into lines of at most `width` columns. `cap.left` counts the lines still
 * wanted; the wrap stops once it is spent (the caller cuts the body there and says so).
 * @param {Array<object>} runs
 * @param {number} width
 * @param {{left: number}} [cap]
 * @returns {Array<{runs: object[]}>}
 */
export function flow(runs, width, cap = { left: Infinity }) {
  const W = Math.max(1, width)
  const lines = []
  let cur = []
  let curW = 0
  let space = false
  let word = []
  let wordW = 0
  const newline = () => { lines.push({ runs: cur }); cap.left--; cur = []; curW = 0 }
  const splitWord = () => {
    for (const r of word) {
      let piece = ''
      for (const ch of r.text) {
        const cw = textWidth(ch)
        if (curW + cw > W) {
          if (piece) cur.push({ text: piece, st: r.st })
          piece = ''
          newline()
        }
        piece += ch
        curW += cw
      }
      if (piece) cur.push({ text: piece, st: r.st })
    }
  }
  const place = () => {
    if (!word.length) return
    const gap = space && curW > 0 ? 1 : 0
    if (curW + gap + wordW <= W) {
      if (gap) cur.push({ text: ' ' })
      cur.push(...word)
      curW += gap + wordW
    } else if (wordW <= W) {
      if (curW > 0) newline()
      cur.push(...word)
      curW = wordW
    } else {
      if (curW > 0) newline()
      splitWord()
    }
    word = []
    wordW = 0
    space = false
  }
  for (const r of runs) {
    if (cap.left <= 0) break
    if (r.br) { place(); newline(); space = false; continue }
    const pieces = r.text.split(' ')
    for (let k = 0; k < pieces.length && cap.left > 0; k++) {
      if (k > 0) { place(); space = true }
      if (pieces[k]) { word.push({ text: pieces[k], st: r.st }); wordW += textWidth(pieces[k]) }
    }
  }
  place()
  if (cur.length && cap.left > 0) { lines.push({ runs: cur }); cap.left-- }
  return lines
}

function prefixLines(lines, first, rest, blankGutter) {
  return lines.map((line, i) => {
    if (line.runs.length === 0) return blankGutter ? { runs: [{ text: blankGutter.text.trimEnd(), st: blankGutter.st }] } : line
    return { runs: [...(i === 0 ? first : rest), ...line.runs] }
  })
}

function rawText(nodes) {
  let s = ''
  for (const n of nodes) {
    if (n.type === 'text') s += n.value
    else if (n.type === 'el') s += n.name === 'br' ? '\n' : rawText(n.children)
  }
  return s
}

const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6'])
const GUTTER = Object.freeze({ text: '\u2502 ', st: { c: 'border' } })
const QUOTE = Object.freeze({ text: '\u2502 ', st: { c: 'muted' } })

function digitsOnly(s, max) {
  if (!s || s.length > max) return false
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) < 48 || s.charCodeAt(i) > 57) return false
  return true
}

function cellText(children, ctx) {
  const runs = []
  inline(children, {}, { ...ctx, md: false }, runs)
  return collapse(plainText(runs)).trim()
}

function fit(text, w) {
  const t = ellipsize(text, w)
  return t + ' '.repeat(Math.max(0, w - textWidth(t)))
}

function collectRows(table, ctx) {
  const rows = []
  let cells = 0
  let dropped = 0
  let caption = ''
  const visit = (nodes, inHead) => {
    for (const n of nodes) {
      if (n.type !== 'el') continue
      if (n.name === 'caption') caption = cellText(n.children, ctx)
      else if (n.name === 'thead' || n.name === 'tbody' || n.name === 'tfoot') visit(n.children, n.name === 'thead')
      else if (n.name === 'tr') {
        if (rows.length >= LIMITS.TABLE_ROWS || cells >= LIMITS.TABLE_CELLS) { dropped++; continue }
        const row = { head: inHead, cells: [], allTh: true }
        for (const c of n.children) {
          if (c.type !== 'el' || (c.name !== 'td' && c.name !== 'th')) continue
          cells++
          if (c.name !== 'th') row.allTh = false
          const span = cleanHtmlText(c.attrs.colspan ?? '1')
          const k = digitsOnly(span, 3) ? Math.min(LIMITS.TABLE_COLS, Math.max(1, Number(span))) : 1
          row.cells.push(cellText(c.children, ctx))
          for (let s = 1; s < k; s++) row.cells.push('')
        }
        row.allTh = row.allTh && row.cells.length > 0
        rows.push(row)
      } else visit(n.children, inHead)
    }
  }
  visit(table.children, false)
  return { rows, dropped, caption }
}

function tableLines(table, ctx) {
  const { rows, dropped, caption } = collectRows(table, ctx)
  const lines = []
  if (caption) lines.push(...flow([{ text: caption, st: DIM }], ctx.width, ctx.cap))
  if (!rows.length) return lines
  const maxCols = Math.max(1, ...rows.map(r => r.cells.length))
  const shown = Math.min(maxCols, LIMITS.TABLE_COLS)
  const extra = maxCols - shown
  const extraLabel = `+${extra} cols`
  const ncols = shown + (extra > 0 ? 1 : 0)
  let sepW = 3
  const reserve = extra > 0 ? textWidth(extraLabel) : 0
  const room = () => Math.floor((ctx.width - sepW * (ncols - 1) - reserve) / shown)
  let cap = room()
  if (cap < 3) { sepW = 1; cap = room() }
  cap = Math.max(1, Math.min(LIMITS.TABLE_CELL_WIDTH, cap))
  const widths = Array.from({ length: ncols }, (_, c) => {
    let w = 1
    if (c >= shown) return reserve
    for (const r of rows) w = Math.max(w, textWidth(r.cells[c] ?? ''))
    return Math.min(cap, w)
  })
  const sep = { text: sepW === 3 ? ' \u2502 ' : ' ', st: { c: 'border' } }
  const header = rows[0].head || rows[0].allTh
  rows.forEach((r, ri) => {
    const bold = (ri === 0 && header) || r.head
    const runs = []
    for (let c = 0; c < ncols; c++) {
      const text = c < shown ? (r.cells[c] ?? '') : (ri === 0 ? extraLabel : '\u2026')
      if (c > 0) runs.push(sep)
      runs.push({ text: c === ncols - 1 ? ellipsize(text, widths[c]) : fit(text, widths[c]), st: bold ? { b: true } : undefined })
    }
    lines.push({ runs })
    if (ri === 0 && header) {
      const dash = widths.map(w => '\u2500'.repeat(w)).join(sepW === 3 ? '\u2500\u253c\u2500' : '\u2500')
      lines.push({ runs: [{ text: dash, st: { c: 'border' } }] })
    }
  })
  if (dropped > 0) lines.push({ runs: [{ text: `\u2026 ${dropped} more rows`, st: DIM }] })
  ctx.cap.left -= lines.length
  return lines
}

function listLines(n, ctx) {
  const ordered = n.name === 'ol'
  const startAttr = ordered && n.attrs.start !== undefined ? cleanHtmlText(n.attrs.start).trim() : ''
  let num = digitsOnly(startAttr, 6) ? Number(startAttr) : 1
  const lines = []
  for (const child of n.children) {
    if (ctx.cap.left <= 0) break
    if (child.type === 'el' && child.name === 'li') {
      const mark = ordered ? `${num}. ` : '\u2022 '
      num++
      const mw = textWidth(mark)
      const body = layout(child.children, { ...ctx, width: Math.max(1, ctx.width - mw), inList: true })
      const items = body.length ? body : [BLANK]
      lines.push(...prefixLines(items, [{ text: mark, st: { c: 'muted' } }], [{ text: ' '.repeat(mw) }], null))
    } else {
      lines.push(...layout([child], ctx))
    }
  }
  return lines
}

function detailsLines(n, ctx) {
  if (n.synthetic) return prefixLines(layout(n.children, { ...ctx, width: Math.max(1, ctx.width - 2) }), [GUTTER], [GUTTER], GUTTER)
  const summary = n.children.find(c => c.type === 'el' && c.name === 'summary')
  const rest = n.children.filter(c => c !== summary)
  const head = []
  if (summary) inline(summary.children, { b: true }, { ...ctx, md: false }, head)
  const headRuns = [{ text: '\u25be ', st: DIM }, ...(plainText(head).trim() ? head : [{ text: 'Details', st: { b: true } }])]
  const body = layout(rest, { ...ctx, width: Math.max(1, ctx.width - 2) })
  return [...flow(headRuns, ctx.width, ctx.cap), ...prefixLines(body, [GUTTER], [GUTTER], GUTTER)]
}

function preLines(n, ctx) {
  const text = (() => { const raw = rawText(n.children); return raw.startsWith('\n') ? raw.slice(1) : raw })()
  const out = []
  const src = text.split('\n')
  while (src.length > 1 && src[src.length - 1] === '') src.pop()
  for (const line of src) {
    if (out.length >= ctx.cap.left) break
    let rest = line
    do {
      if (out.length >= ctx.cap.left) break
      const chunk = cut(rest, ctx.width) || rest.slice(0, 1)
      out.push({ runs: [{ text: chunk || ' ', st: { c: 'block' } }] })
      rest = rest.slice(chunk.length)
    } while (rest)
  }
  ctx.cap.left -= out.length
  return out
}

/**
 * Lay out block-level children. Inline content between blocks is gathered into paragraphs.
 * @param {object[]} nodes
 * @param {Ctx} ctx
 * @returns {Array<{runs: object[]}>}
 */
export function layout(nodes, ctx) {
  if (!ctx.cap) ctx.cap = { left: LIMITS.MAX_ROWS + 1 }
  const out = []
  let inl = []
  let pendingGap = false
  const isBlank = line => line.runs.length === 0
  const emit = (lines, margin) => {
    if (!lines.length) return
    if ((margin || pendingGap) && out.length && !isBlank(out[out.length - 1]) && !isBlank(lines[0])) out.push(BLANK)
    out.push(...lines)
    pendingGap = margin
  }
  const flush = () => {
    if (inl.some(r => r.br || (r.text && r.text.trim()))) emit(flow(inl, ctx.width, ctx.cap), false)
    inl = []
  }
  for (const n of nodes) {
    if (ctx.cap.left <= 0) break
    if (n.type !== 'el' || !BLOCKS.has(n.name)) {
      inline([n], ctx.st0, ctx, inl)
      continue
    }
    flush()
    block(n, ctx, emit)
  }
  flush()
  return out
}

function block(n, ctx, emit) {
  const name = n.name
  if (HEADINGS.has(name)) {
    const level = Number(name[1])
    const runs = []
    inline(n.children, { b: true, c: 'sel', u: level === 1 }, { ...ctx, md: false }, runs)
    const shown = level === 1 ? runs.map(r => (r.text ? { ...r, text: r.text.toUpperCase() } : r)) : runs
    emit(flow(shown, ctx.width, ctx.cap), true)
  } else if (name === 'p') {
    const runs = []
    inline(n.children, ctx.st0, ctx, runs)
    emit(flow(runs, ctx.width, ctx.cap), true)
  } else if (name === 'blockquote') {
    const body = layout(n.children, { ...ctx, width: Math.max(1, ctx.width - 2) })
    emit(prefixLines(body, [QUOTE], [QUOTE], QUOTE), !n.synthetic)
  } else if (name === 'details') {
    emit(detailsLines(n, ctx), !n.synthetic)
  } else if (name === 'ul' || name === 'ol' || name === 'li') {
    emit(listLines(name === 'li' ? { ...n, name: 'ul', children: [n] } : n, ctx), !ctx.inList)
  } else if (name === 'pre') {
    emit(preLines(n, ctx), true)
  } else if (name === 'hr') {
    emit([{ runs: [{ text: '\u2500'.repeat(Math.max(1, ctx.width)), st: { c: 'border' } }] }], true)
  } else if (name === 'table') {
    emit(tableLines(n, ctx), true)
  } else if (name === 'dd') {
    emit(prefixLines(layout(n.children, { ...ctx, width: Math.max(1, ctx.width - 2) }), [{ text: '  ' }], [{ text: '  ' }], null), false)
  } else if (name === 'dt') {
    const runs = []
    inline(n.children, { b: true }, ctx, runs)
    emit(flow(runs, ctx.width, ctx.cap), false)
  } else {
    // div section article center figure figcaption summary caption thead tbody tfoot tr
    emit(layout(n.children, ctx), false)
  }
}
