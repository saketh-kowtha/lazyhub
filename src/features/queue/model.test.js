import { describe, expect, it } from 'vitest'
import { ageWords, ciCell, groupQueue, mergeItems, reasonText, rowWhy, truncationSummary, whyLine } from './model.js'
import { evidence, node, requestedTeam, requestedUser, sampleItems, FETCHED_AT, checkRollup, FAIL, PASS } from './queue.fixtures.js'

const byNumber = (items, n) => items.find(i => i.identity.number === n)

describe('review queue model: every row says why', () => {
  const items = sampleItems()

  it('groups by the evidence module and each group names its reason on the row', () => {
    const groups = groupQueue(items)
    const rows = Object.fromEntries(groups.map(g => [g.id, g.items.map(rowWhy)]))
    expect(rows.needs_my_review).toEqual(expect.arrayContaining(['review requested of you', 'via team @acme/core']))
    expect(rows.ci_failing).toEqual(['1 of 2 checks failing'])
    expect(rows.changes_requested).toEqual(['changes requested'])
    expect(rows.waiting).toEqual(['waiting for a review'])
    expect(rows.ready).toEqual(['approved, CI passing, mergeable'])
    expect(rows.unknown).toEqual(['CI status unavailable +1'])
  })

  it('counts equal the rows beneath them and every PR lands in exactly one group', () => {
    const groups = groupQueue(items)
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(items.length)
    for (const g of groups) expect(g.items.every(i => i.group.group === g.id)).toBe(true)
  })

  it('a PR whose key facts are unavailable is never shown as ready', () => {
    const odd = byNumber(items, 5)
    expect(odd.group.group).toBe('unknown')
    expect(whyLine(odd, Date.parse(FETCHED_AT))).toContain('CI unavailable')
    expect(whyLine(odd, Date.parse(FETCHED_AT))).toContain('mergeability unavailable')
  })

  it('the strip lists every reason, the inspected head, CI counts and the age of the read', () => {
    const failing = byNumber(items, 409)
    const line = whyLine(failing, Date.parse(FETCHED_AT) + 2 * 60_000)
    expect(line).toContain('1 of 2 checks failing')
    expect(line).toContain('head 3fa91c2')
    expect(line).toContain('CI 1/2 passed')
    expect(line).toContain('mergeable')
    expect(line).toContain('seen 2m ago')
  })

  it('team requests keep the caveat that GitHub does not say which member is asked', () => {
    const team = byNumber(items, 88)
    expect(whyLine(team)).toContain('GitHub does not say if it is you')
    expect(rowWhy(team)).not.toContain('does not say')
  })

  it('cleans hostile team slugs before they reach the screen', () => {
    const esc = String.fromCharCode(27)
    const item = evidence({ reviewRequests: requestedTeam(`core${esc}[31m-evil\u0007`) }, { membership: ['review_requested'] })
    const text = `${rowWhy(item)} ${whyLine(item)}`
    expect(text).not.toContain(esc)
    expect(text).not.toContain('\u0007')
  })

  it('marks lower bounds with + when GitHub returned more than was read', () => {
    const many = evidence({ reviewThreads: { totalCount: 80, pageInfo: { hasNextPage: true }, nodes: Array.from({ length: 50 }, () => ({ isResolved: false, path: 'a', comments: { nodes: [] } })) } })
    const reason = many.attention.find(r => r.code === 'unresolved_threads')
    expect(reasonText(reason)).toBe('50+ unresolved threads')
  })

  it('a direct review request is worded as of you', () => {
    const item = evidence({ reviewRequests: requestedUser('octocat') })
    expect(rowWhy(item)).toContain('review requested of you')
  })
})

describe('review queue model: CI cell, ages, paging', () => {
  it('CI cell is glyph plus text and says n/a when unknown', () => {
    expect(ciCell(evidence())).toEqual({ text: '✓ 2/2', tone: 'pass' })
    expect(ciCell(evidence({ commits: { nodes: [{ commit: { oid: 'a', statusCheckRollup: checkRollup('FAILURE', [PASS, FAIL]) } }] } })).text).toBe('✗ 1/2')
    expect(ciCell(evidence({ commits: undefined }))).toEqual({ text: '? n/a', tone: 'muted' })
    expect(ciCell(evidence({ commits: { nodes: [{ commit: { oid: 'a', statusCheckRollup: null } }] } })).text).toBe('- none')
  })

  it('ageWords handles bad input', () => {
    expect(ageWords(-1)).toBeNull()
    expect(ageWords(Number.NaN)).toBeNull()
    expect(ageWords(30_000)).toBe('just now')
    expect(ageWords(3 * 3600_000)).toBe('3h ago')
  })

  it('mergeItems dedupes across pages and keeps the review request when a later page adds it', () => {
    const authoredOnly = evidence({ number: 7, reviewRequests: requestedUser('someone-else') }, { membership: ['authored'] })
    const asRequested = evidence({ number: 7, reviewRequests: requestedUser('octocat') }, { membership: ['review_requested'] })
    expect(authoredOnly.group.group).not.toBe('needs_my_review')
    const merged = mergeItems([authoredOnly], [asRequested, evidence({ number: 8 })])
    expect(merged).toHaveLength(2)
    const seven = byNumber(merged, 7)
    expect(seven.group.group).toBe('needs_my_review')
    expect(seven.membership.sort()).toEqual(['authored', 'review_requested'])
    // the reverse order never downgrades a PR that is already a review request
    expect(byNumber(mergeItems([asRequested], [authoredOnly]), 7).group.group).toBe('needs_my_review')
  })

  it('says what is not loaded rather than staying silent', () => {
    expect(truncationSummary(undefined)).toBeNull()
    expect(truncationSummary({ review_requested: { has_more: false }, authored: { has_more: false } })).toBeNull()
    expect(truncationSummary({ review_requested: { has_more: true, total: 213 }, authored: { has_more: false } }))
      .toBe('not all loaded: review requests (213 in all)')
    expect(truncationSummary({ review_requested: { has_more: true, total: 'unknown' }, authored: { has_more: true, total: 40 } }))
      .toBe('not all loaded: review requests, your PRs (40 in all)')
  })

  it('sorts a group by most recent update, unknown last', () => {
    const a = evidence({ number: 1, updatedAt: '2026-11-01T00:00:00Z' })
    const b = evidence({ number: 2, updatedAt: '2026-11-05T00:00:00Z' })
    const c = evidence({ number: 3, updatedAt: undefined })
    const waiting = groupQueue([a, c, b]).find(g => g.id === 'waiting')
    expect(waiting.items.map(i => i.identity.number)).toEqual([2, 1, 3])
    expect(node().number).toBe(1)
  })
})
