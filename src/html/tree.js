/**
 * src/html/tree.js - tokens -> allowlisted node tree (see types.js).
 *
 * Only the tags below have meaning; any other tag is dropped and its text kept. Dropped elements
 * (script, style, iframe, ...) already became a single `drop` token in the tokenizer. Text and
 * attribute-derived values are decoded once and cleaned here, so later stages only see clean text.
 * `details` and `blockquote` left open at the end of a segment are carried to the next segment
 * (carryOut); a stray close tag for a carried element closes it (carryIn).
 */
import { LIMITS, NOTICE } from './types.js'
import { cleanHtmlText } from './spoof.js'

const ALLOWED = new Set([
  'b', 'strong', 'i', 'em', 'u', 'ins', 's', 'del', 'strike', 'mark', 'code', 'tt', 'pre', 'kbd', 'sub', 'sup',
  'small', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'section', 'article', 'center', 'br', 'hr',
  'blockquote', 'ul', 'ol', 'li', 'details', 'summary', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'caption', 'img', 'picture', 'a', 'span', 'font', 'abbr', 'cite', 'q', 'dfn', 'var', 'samp', 'dl', 'dt', 'dd',
  'figure', 'figcaption',
])
const VOID = new Set(['br', 'hr', 'img'])
const CLOSES_P = new Set([
  'p', 'div', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'hr', 'details',
  'section', 'article', 'center', 'dl', 'figure',
])
const CARRIED = new Set(['details', 'blockquote'])
const SECTIONS = new Set(['thead', 'tbody', 'tfoot'])

function lastIndexOfName(stack, name) {
  for (let k = stack.length - 1; k >= 1; k--) if (stack[k].name === name) return k
  return -1
}

/**
 * Implied end tags: pop the elements that `name` cannot be nested in.
 * @param {Array<{name: string}>} stack
 * @param {string} name
 */
function implicitClose(stack, name) {
  const topName = () => stack[stack.length - 1].name
  if (CLOSES_P.has(name) && topName() === 'p') stack.pop()
  const popTo = (targets, stops) => {
    for (let k = stack.length - 1; k >= 1; k--) {
      const nm = stack[k].name
      if (targets.has(nm)) { stack.length = k; return }
      if (stops.has(nm)) return
    }
  }
  if (name === 'li') popTo(new Set(['li']), new Set(['ul', 'ol']))
  else if (name === 'td' || name === 'th') popTo(new Set(['td', 'th']), new Set(['tr', 'table']))
  else if (name === 'tr') popTo(new Set(['tr']), new Set(['table']))
  else if (SECTIONS.has(name)) popTo(SECTIONS, new Set(['table']))
  else if (name === 'dt' || name === 'dd') popTo(new Set(['dt', 'dd']), new Set(['dl']))
}

function wrapSynthetic(children, name) {
  return [{ type: 'el', name, attrs: {}, synthetic: true, children }]
}

/**
 * @param {Array<object>} tokens
 * @param {{deepNoticed: boolean}} budget per-body state (only the nesting notice is used here)
 * @param {string[]} [carryIn] names of details/blockquote opened in an earlier segment and still open
 * @returns {{children: object[], carryOut: string[]}}
 */
export function buildTree(tokens, budget, carryIn = []) {
  const root = { type: 'el', name: '#root', attrs: {}, children: [] }
  const stack = [root]
  const carry = carryIn.slice()

  const add = node => {
    const parent = stack[stack.length - 1]
    if (node.type === 'text') {
      const prev = parent.children[parent.children.length - 1]
      if (prev && prev.type === 'text') { prev.value += node.value; return }
    }
    parent.children.push(node)
  }

  for (const tok of tokens) {
    if (tok.type === 'text') {
      const value = cleanHtmlText(tok.value)
      if (value) add({ type: 'text', value })
    } else if (tok.type === 'code') {
      add({ type: 'el', name: 'code', attrs: {}, children: [{ type: 'text', value: cleanHtmlText(tok.value) }] })
    } else if (tok.type === 'drop') {
      add({ type: 'notice', value: NOTICE.EMBEDDED })
    } else if (tok.type === 'notice') {
      add({ type: 'notice', value: tok.value })
    } else if (tok.type === 'open') {
      if (!ALLOWED.has(tok.name)) continue
      if (stack.length - 1 >= LIMITS.MAX_DEPTH && !VOID.has(tok.name)) {
        if (!budget.deepNoticed) { budget.deepNoticed = true; add({ type: 'notice', value: NOTICE.TOO_DEEP }) }
        continue
      }
      implicitClose(stack, tok.name)
      const node = { type: 'el', name: tok.name, attrs: tok.attrs, children: [] }
      add(node)
      if (!tok.selfClosing && !VOID.has(tok.name)) stack.push(node)
    } else if (tok.type === 'close') {
      if (!ALLOWED.has(tok.name) || VOID.has(tok.name)) continue
      const k = lastIndexOfName(stack, tok.name)
      if (k >= 1) { stack.length = k; continue }
      const c = carry.lastIndexOf(tok.name)
      if (c >= 0) {
        // Closes an element opened in an earlier segment: everything so far sits inside it.
        stack.length = 1
        for (let level = carry.length - 1; level >= c; level--) root.children = wrapSynthetic(root.children, carry[level])
        carry.length = c
      }
    }
  }

  const keep = []
  for (let k = 1; k < stack.length && CARRIED.has(stack[k].name); k++) keep.push(stack[k].name)
  let children = root.children
  for (let level = carry.length - 1; level >= 0; level--) children = wrapSynthetic(children, carry[level])
  return { children, carryOut: [...carry, ...keep] }
}
