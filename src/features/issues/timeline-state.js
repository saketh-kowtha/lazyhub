/**
 * src/features/issues/timeline-state.js — pure state helpers for the issue timeline (#565).
 *
 * Same shape of idea as the PR comments view (#507): pages are appended, never refetched;
 * a newer first page (background revalidation) is folded in by content signature, so a
 * revalidation that changes nothing changes nothing on screen.
 */

/**
 * Content signature of one item: equal signature means nothing visible changed.
 * @param {any} item
 */
export function itemSig(item) { return JSON.stringify(item) }

/**
 * @typedef {object} TimelineState
 * @property {any[]} items         loaded timeline items, oldest first
 * @property {{total: number, hasNextPage: boolean, endCursor: string|null, stalled: boolean}} page  the last page loaded
 * @property {number} liveTotal    newest total reported by GitHub (>= items.length when new items exist)
 */

/**
 * @param {{items?: any[], page?: any}} first  first page result
 * @returns {TimelineState}
 */
export function seedOf(first) {
  const items = first?.items || []
  const page = first?.page || { total: items.length, hasNextPage: false, endCursor: null, stalled: false }
  return { items, page, liveTotal: Math.max(page.total, items.length) }
}

/**
 * Add the items of a later page. Dedupes by key; an incoming copy replaces a changed one.
 * @param {any[]} existing
 * @param {any[]} incoming
 */
export function mergeItems(existing, incoming) {
  const byKey = new Map(incoming.map(i => [i.key, i]))
  const known = new Set(existing.map(i => i.key))
  const kept = existing.map(i => (byKey.has(i.key) && itemSig(byKey.get(i.key)) !== itemSig(i) ? byKey.get(i.key) : i))
  return [...kept, ...incoming.filter(i => !known.has(i.key))]
}

/**
 * Append a later page to the state.
 * @param {TimelineState} cur
 * @param {{items: any[], page: any}} next
 * @returns {TimelineState}
 */
export function appendPage(cur, next) {
  const items = mergeItems(cur.items, next.items)
  return { items, page: next.page, liveTotal: Math.max(cur.liveTotal, next.page.total, items.length) }
}

/**
 * Fold a newer first page into what is loaded. Edited items (comment text, reactions,
 * minimized state) are replaced in place; items the user has not scrolled to are not added
 * (they arrive through the cursor path or the "new comments" marker); only the total moves.
 * Returns the same object when nothing changed.
 * @param {TimelineState} cur
 * @param {{items: any[], page: any}} first
 * @returns {TimelineState}
 */
export function reconcileFirst(cur, first) {
  const fresh = new Map((first.items || []).map(i => [i.key, i]))
  let changed = false
  const items = cur.items.map(i => {
    const next = fresh.get(i.key)
    if (next && itemSig(next) !== itemSig(i)) { changed = true; return next }
    return i
  })
  const liveTotal = Math.max(first.page?.total ?? 0, items.length)
  if (liveTotal !== cur.liveTotal) changed = true
  return changed ? { ...cur, items, liveTotal } : cur
}

/**
 * How many items exist on GitHub that the view has not loaded yet while everything it knew
 * about is already on screen. Zero while pages are still loading in the normal way.
 * @param {TimelineState} state
 */
export function newItemCount(state) {
  if (state.page.hasNextPage || state.page.stalled) return 0
  return Math.max(0, state.liveTotal - state.items.length)
}

/**
 * Break a line into chunks that fit `width` columns (hard wrap; blank lines stay one row).
 * @param {string} line
 * @param {number} width
 * @param {(s: string) => number} measure  display width of a string
 * @returns {string[]}
 */
export function wrapLine(line, width, measure = s => s.length) {
  if (width < 4 || measure(line) <= width) return [line]
  const out = []
  let cur = ''
  for (const ch of line) {
    if (measure(cur + ch) > width) { out.push(cur); cur = ch.trimStart() === '' && !cur ? '' : ch } else cur += ch
  }
  out.push(cur)
  return out
}

/**
 * Quote a comment for a reply: every line prefixed with `> `, a link to the original, then a
 * blank line for the reply (GitHub issues have no threads, so this is how replies point back).
 * @param {{author?: string, body?: string, url?: string}} comment
 * @returns {string}
 */
export function quoteReply(comment) {
  const quoted = String(comment.body || '').replace(/\r\n?/g, '\n').split('\n').map(l => `> ${l}`.trimEnd()).join('\n')
  const head = comment.author ? `@${comment.author} wrote` : 'Quoting'
  const link = comment.url ? ` ([link](${comment.url}))` : ''
  return `${head}${link}:\n\n${quoted}\n\n`
}
