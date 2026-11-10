/**
 * src/html/detect.js - where does HTML start inside a Markdown body? (CommonMark/GFM HTML-block rules)
 *
 * Works on lines of UNDECODED text and never looks inside fenced code (the caller tracks fences).
 * Pure string scanning: no regex over input.
 */

const RAW_TEXT = ['script', 'pre', 'style', 'textarea']
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col', 'colgroup',
  'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form',
  'frame', 'frameset', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'head', 'header', 'hr', 'html', 'iframe', 'legend',
  'li', 'link', 'main', 'menu', 'menuitem', 'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param',
  'section', 'source', 'summary', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
])

function isAlpha(c) {
  return (c >= 97 && c <= 122) || (c >= 65 && c <= 90)
}
function isNameChar(c) {
  return isAlpha(c) || (c >= 48 && c <= 57) || c === 45
}

/**
 * True when the line may contain a tag, comment or declaration: a `<` followed by a letter, `/`, `!` or `?`.
 * @param {string} line
 * @returns {boolean}
 */
export function hasMarkup(line) {
  for (let i = line.indexOf('<'); i >= 0 && i + 1 < line.length; i = line.indexOf('<', i + 1)) {
    const c = line.charCodeAt(i + 1)
    if (isAlpha(c) || c === 47 || c === 33 || c === 63) return true
  }
  return false
}

function lowerName(s, from) {
  let end = from
  while (end < s.length && isNameChar(s.charCodeAt(end))) end++
  return { name: s.slice(from, end).toLowerCase(), end }
}

function endsRawText(line) {
  const lower = line.toLowerCase()
  return RAW_TEXT.some(n => lower.includes(`</${n}>`))
}

function indent(line) {
  let n = 0
  while (n < line.length && line.charCodeAt(n) === 32) n++
  return n
}

const DECLARATIONS = [
  { open: '<!--', close: '-->', kind: 'comment' },
  { open: '<?', close: '?>', kind: 'pi' },
  { open: '<![CDATA[', close: ']]>', kind: 'cdata' },
]

/**
 * HTML block types 2 to 5: comment, processing instruction, CDATA and declaration.
 * @param {string} s the line without its indentation
 * @returns {null | {end: 'blank'} | {end: 'line', kind: string, done: (line: string) => boolean}}
 */
function declarationBlock(s) {
  for (const d of DECLARATIONS) {
    if (s.startsWith(d.open)) {
      return s.includes(d.close, d.open.length) ? { end: 'blank' } : { end: 'line', kind: d.kind, done: l => l.includes(d.close) }
    }
  }
  if (s.charCodeAt(1) === 33 && isAlpha(s.charCodeAt(2))) {
    return s.includes('>', 2) ? { end: 'blank' } : { end: 'line', kind: 'decl', done: l => l.includes('>') }
  }
  return null
}

/**
 * Does an HTML block start at this line? Returns how it ends, or null.
 * @param {string} line
 * @param {boolean} afterBlank true at the start of the body or after a blank line (type 7 cannot interrupt a paragraph)
 * @returns {null | {end: 'blank'} | {end: 'line', kind: string, done: (line: string) => boolean}}
 */
export function htmlBlockStart(line, afterBlank) {
  const sp = indent(line)
  if (sp > 3 || line.charCodeAt(sp) !== 60) return null
  const s = line.slice(sp)
  const closing = s.charCodeAt(1) === 47
  const { name, end } = lowerName(s, closing ? 2 : 1)
  const after = s.charCodeAt(end)
  const delimited = end >= s.length || after === 32 || after === 9 || after === 62 || (after === 47 && s.charCodeAt(end + 1) === 62)
  if (!closing && RAW_TEXT.includes(name) && (end >= s.length || after === 32 || after === 9 || after === 62)) {
    return endsRawText(s) ? { end: 'blank' } : { end: 'line', kind: 'raw', done: endsRawText }
  }
  const decl = declarationBlock(s)
  if (decl) return decl
  if (name && BLOCK_TAGS.has(name) && delimited) return { end: 'blank' }
  if (afterBlank && name && !RAW_TEXT.includes(name)) {
    const trimmed = s.trimEnd()
    if (trimmed.endsWith('>') && trimmed.indexOf('>') === trimmed.length - 1) return { end: 'blank' }
  }
  return null
}
