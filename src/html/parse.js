/**
 * src/html/parse.js - one HTML segment -> node tree, with the per-body byte and token budget.
 *
 * When the body budget is spent, the rest of the segment is kept as plain (cleaned) text and the
 * tree carries a visible "HTML rendering stopped" notice. At most TAIL_CAP plain characters are
 * kept after a stop; the notice says why the rest is not shown.
 */
import { LIMITS, NOTICE } from './types.js'
import { tokenize } from './tokenize.js'
import { buildTree } from './tree.js'

const TAIL_CAP = 64 * 1024

/**
 * @param {string} src undecoded segment text
 * @param {{budget: import('./types.js').Budget, md?: boolean, carry?: string[]}} opts
 * @returns {{children: object[], carryOut: string[]}}
 */
export function parseSegment(src, opts) {
  const { budget } = opts
  let tokens
  if (budget.stopped) {
    tokens = [{ type: 'text', value: src.slice(0, TAIL_CAP) }]
  } else {
    const room = Math.max(0, LIMITS.MAX_BYTES - budget.bytes)
    if (src.length <= room) {
      budget.bytes += src.length
      tokens = tokenize(src, { md: opts.md, budget })
    } else {
      budget.bytes = LIMITS.MAX_BYTES
      tokens = tokenize(src.slice(0, room), { md: opts.md, budget })
      tokens.push({ type: 'text', value: src.slice(room, room + TAIL_CAP) })
      if (!budget.stopped) tokens.push({ type: 'notice', value: NOTICE.TOO_LARGE })
      budget.stopped = true
    }
  }
  return buildTree(tokens, budget, opts.carry)
}
