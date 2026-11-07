import { describe, expect, it } from 'vitest'
import { seedOf, mergeItems, appendPage, reconcileFirst, newItemCount, wrapLine, quoteReply, itemSig } from './timeline-state.js'

const c = (key, body = 'b', extra = {}) => ({ key, kind: 'comment', id: Number(key.replace(/\D/g, '')) || 1, author: 'a', body, reactions: [], ...extra })
const page = (total, hasNextPage = false, endCursor = 'x') => ({ total, hasNextPage, endCursor, stalled: false })

describe('issue timeline state (#565)', () => {
  it('seeds from a first page with the total as the live total', () => {
    expect(seedOf({ items: [c('C1')], page: page(40, true, 'k') })).toMatchObject({ liveTotal: 40, page: { hasNextPage: true } })
  })

  it('appends a later page without duplicating or reordering what is loaded', () => {
    const cur = seedOf({ items: [c('C1'), c('C2')], page: page(4, true, 'k1') })
    const next = appendPage(cur, { items: [c('C2'), c('C3'), c('C4')], page: page(4, false, 'k2') })
    expect(next.items.map(i => i.key)).toEqual(['C1', 'C2', 'C3', 'C4'])
    expect(next.page.endCursor).toBe('k2')
  })

  it('mergeItems lets a changed copy replace the loaded one', () => {
    const merged = mergeItems([c('C1', 'old')], [c('C1', 'new')])
    expect(merged).toHaveLength(1)
    expect(merged[0].body).toBe('new')
  })

  it('reconcileFirst returns the very same state when a revalidation changed nothing', () => {
    const cur = seedOf({ items: [c('C1'), c('C2')], page: page(2) })
    expect(reconcileFirst(cur, { items: [c('C1'), c('C2')], page: page(2) })).toBe(cur)
  })

  it('reconcileFirst folds in an edit and a new total, but does not insert unseen items', () => {
    const cur = seedOf({ items: [c('C1', 'old')], page: page(1) })
    const next = reconcileFirst(cur, { items: [c('C1', 'edited'), c('C2')], page: page(2) })
    expect(next.items.map(i => i.body)).toEqual(['edited'])
    expect(next.liveTotal).toBe(2)
    expect(newItemCount(next)).toBe(1)
  })

  it('counts new items only once every known page is on screen', () => {
    const loading = { ...seedOf({ items: [c('C1')], page: page(9, true) }), liveTotal: 12 }
    expect(newItemCount(loading)).toBe(0)
    const caughtUp = { ...seedOf({ items: [c('C1')], page: page(1) }), liveTotal: 3 }
    expect(newItemCount(caughtUp)).toBe(2)
  })

  it('has a stable content signature', () => {
    expect(itemSig(c('C1'))).toBe(itemSig(c('C1')))
    expect(itemSig(c('C1'))).not.toBe(itemSig(c('C1', 'x')))
  })

  it('wraps long lines and keeps blank lines as one row', () => {
    expect(wrapLine('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
    expect(wrapLine('', 10)).toEqual([''])
    expect(wrapLine('short', 10)).toEqual(['short'])
  })

  it('quotes every line with > and links the original', () => {
    const text = quoteReply({ author: 'alice', body: 'one\n\ntwo', url: 'https://x/c/1' })
    expect(text).toBe('@alice wrote ([link](https://x/c/1)):\n\n> one\n>\n> two\n\n')
  })
})
