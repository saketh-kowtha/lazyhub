import { describe, expect, it } from 'vitest'
import { STALE_DAYS_DEFAULT, badgesFor, clearOf, fitBadges, rankLine, rankQueue, sizeOf, tierOf } from './rank.js'
import { checkRollup, evidence, FAIL, FETCHED_AT, PASS, requestedTeam, requestedUser, sampleItems } from './queue.fixtures.js'

const NOW = Date.parse(FETCHED_AT)
const daysAgo = d => new Date(NOW - d * 86_400_000 - 3_600_000).toISOString()
const refs = rows => rows.map(r => `${r.item.identity.repo}#${r.item.identity.number}`)
const direct = (n, over = {}) => evidence({ number: n, reviewRequests: requestedUser('octocat'), ...over }, { membership: ['review_requested'] })
const authored = (n, over = {}) => evidence({ number: n, ...over })

describe('Start here ranking: deterministic, every key named', () => {
  it('puts what needs you first, then what waits on others, then stale', () => {
    const rows = rankQueue(sampleItems(), { now: NOW })
    expect(rows.map(r => r.section)).toEqual(['needs_you', 'needs_you', 'needs_you', 'needs_you', 'needs_you', 'waiting', 'waiting'])
    expect(refs(rows).slice(0, 2)).toEqual(['acme/platform#412', 'acme/ledger#88'])
    expect(rows.map(r => r.rank)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('orders the tiers: review of you, via a team, yours ready, yours blocked, yours waiting, facts unknown', () => {
    const items = [
      authored(6, { commits: undefined }),
      authored(5),
      authored(4, { reviewDecision: 'CHANGES_REQUESTED' }),
      authored(3, { reviewDecision: 'APPROVED' }),
      evidence({ number: 2, reviewRequests: requestedTeam('acme/core') }, { membership: ['review_requested'] }),
      direct(1),
    ]
    const rows = rankQueue(items, { now: NOW })
    expect(rows.map(r => r.tier)).toEqual(['review_direct', 'review_team', 'yours_ready', 'yours_blocked', 'yours_waiting', 'facts_unknown'])
    expect(rows.map(r => r.item.identity.number)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('inside a tier: clear first, then the oldest update, then the smallest change, then repo and number', () => {
    const red = { commits: { nodes: [{ commit: { oid: 'c'.repeat(40), statusCheckRollup: checkRollup('FAILURE', [FAIL]) } }] } }
    const items = [
      direct(10, { ...red, updatedAt: daysAgo(9) }),     // not clear: after every clear row
      direct(11, { updatedAt: daysAgo(1) }),
      direct(12, { updatedAt: daysAgo(5), additions: 500, deletions: 0 }),
      direct(13, { updatedAt: daysAgo(5), additions: 5, deletions: 0 }),
      direct(14, { updatedAt: daysAgo(5), additions: 5, deletions: 0 }),
    ]
    const rows = rankQueue(items, { now: NOW })
    expect(rows.map(r => r.item.identity.number)).toEqual([13, 14, 12, 11, 10])
    expect(rows[4].steps[2]).toBe('not clear (CI not passing)')
  })

  it('gives the same order for the same input, whatever order it arrives in', () => {
    const items = sampleItems()
    const a = refs(rankQueue(items, { now: NOW }))
    const b = refs(rankQueue([...items].reverse(), { now: NOW }))
    expect(b).toEqual(a)
  })

  it('names every key that placed a row, in order, with no hidden number', () => {
    const [row] = rankQueue([direct(1, { updatedAt: daysAgo(3), additions: 40, deletions: 8, changedFiles: 3 })], { now: NOW })
    expect(row.steps).toEqual([
      'Needs you',
      'review requested of you (@alice is waiting)',
      'clear (CI passing, mergeable)',
      'no update for 3d',
      'size S (+40/-8 in 3 files)',
    ])
    expect(rankLine(row, 1)).toBe('1 of 1: Needs you > review requested of you (@alice is waiting) > clear (CI passing, mergeable) > no update for 3d > size S (+40/-8 in 3 files)')
  })

  it('shortens the trailing keys first to fit, and never drops a key', () => {
    const [row] = rankQueue([direct(1, { updatedAt: daysAgo(3) })], { now: NOW })
    const mid = rankLine(row, 1, 90)
    expect(mid.length).toBeLessThanOrEqual(90)
    expect(mid.startsWith('1 of 1: Needs you > review requested of you')).toBe(true)
    expect(rankLine(row, 1, 60)).toBe('1 of 1: Needs you > review of you > clear > 3d old > XS')
    expect(rankLine(row, 1, 20).length).toBeLessThanOrEqual(20)
  })

  it('a blocked PR of yours says what blocks it', () => {
    const item = authored(4, { reviewDecision: 'CHANGES_REQUESTED', mergeable: 'CONFLICTING' })
    expect(tierOf(item)).toEqual({ tier: 'yours_blocked', detail: 'changes requested, merge conflict' })
    const [row] = rankQueue([item], { now: NOW })
    expect(row.steps[1]).toBe('your PR needs a fix: changes requested, merge conflict')
    expect(row.short[1]).toBe('yours, changes requested, merge conflict')
  })
})

describe('Stale section', () => {
  it(`moves rows with no update for more than the configured days (default ${STALE_DAYS_DEFAULT}) to Stale`, () => {
    const rows = rankQueue([authored(1, { updatedAt: daysAgo(STALE_DAYS_DEFAULT + 1) }), authored(2, { updatedAt: daysAgo(2) })], { now: NOW })
    expect(rows.map(r => [r.item.identity.number, r.section])).toEqual([[2, 'waiting'], [1, 'stale']])
    expect(rows[1].steps[0]).toBe(`Stale (no update in more than ${STALE_DAYS_DEFAULT}d)`)
    const custom = rankQueue([authored(1, { updatedAt: daysAgo(4) })], { now: NOW, staleDays: 3 })
    expect(custom[0].section).toBe('stale')
  })

  it('never moves a review requested of you to Stale: someone is waiting on you', () => {
    const rows = rankQueue([direct(1, { updatedAt: daysAgo(90) })], { now: NOW })
    expect(rows[0].section).toBe('needs_you')
    expect(rows[0].steps[3]).toBe('no update for 90d')
  })

  it('an unknown update time is said to be unknown, ranks last on age, and is never stale', () => {
    const rows = rankQueue([authored(1, { updatedAt: null }), authored(2, { updatedAt: daysAgo(1) })], { now: NOW })
    expect(rows.map(r => r.item.identity.number)).toEqual([2, 1])
    expect(rows[1].section).toBe('waiting')
    expect(rows[1].steps[3]).toBe('last update unknown')
  })
})

describe('clear and size are facts, unknown is not fine', () => {
  it('unavailable CI or mergeability is "not clear", with the missing fact named', () => {
    expect(clearOf(authored(1, { commits: undefined, mergeable: undefined }))).toEqual({ clear: false, words: 'not clear (CI unknown, mergeability unknown)' })
    expect(clearOf(authored(1, { isDraft: true })).words).toBe('not clear (draft)')
    expect(clearOf(authored(1, { commits: { nodes: [{ commit: { oid: 'a'.repeat(40), statusCheckRollup: null } }] } })).clear).toBe(true)
  })

  it('size buckets the added plus deleted lines; no counts means size unknown', () => {
    expect(sizeOf(authored(1, { additions: 3, deletions: 1 })).label).toBe('XS')
    expect(sizeOf(authored(1, { additions: 300, deletions: 100 })).label).toBe('M')
    expect(sizeOf(authored(1, { additions: 2000, deletions: 1 })).label).toBe('XL')
    expect(sizeOf(authored(1, { additions: null }))).toEqual({ label: '?', lines: null, words: 'size unknown' })
  })
})

describe('signal badges: shown from data, hidden without it', () => {
  it('a healthy PR has no badge at all', () => {
    expect(badgesFor(authored(1))).toEqual([])
  })

  it('CI red, merge conflict, bot author and draft come from the evidence record', () => {
    const item = authored(1, {
      mergeable: 'CONFLICTING', isDraft: true, author: { login: 'dependabot', __typename: 'Bot' },
      commits: { nodes: [{ commit: { oid: 'b'.repeat(40), statusCheckRollup: checkRollup('FAILURE', [PASS, FAIL]) } }] },
    })
    expect(badgesFor(item).map(b => [b.id, b.text])).toEqual([['ci', '✗CI'], ['conflict', '⚠conf'], ['bot', 'bot'], ['draft', 'draft']])
    expect(badgesFor(item)[0].words).toBe('CI red (1 failing)')
  })

  it('a login is never labelled an agent: only GitHub\'s Bot account type gets the bot badge', () => {
    expect(badgesFor(authored(1, { author: { login: 'my-coding-agent', __typename: 'User' } }))).toEqual([])
  })

  it('a collision badge appears only from a collision-radar result, never guessed', () => {
    expect(badgesFor(authored(1), { collisions: null })).toEqual([])
    expect(badgesFor(authored(1), { collisions: [] })).toEqual([])
    const [b] = badgesFor(authored(1), { collisions: [405, 77] })
    expect(b).toMatchObject({ id: 'collision', text: '⑂#405', words: 'collides with #405, #77 (collision radar)' })
  })

  it('fits the least important badges out first and counts what it dropped', () => {
    const badges = [{ text: '✗CI' }, { text: '⚠conf' }, { text: 'bot' }]
    expect(fitBadges('M', badges, 20, s => s.length)).toEqual({ shown: badges, dropped: 0 })
    expect(fitBadges('M', badges, 8, s => s.length)).toEqual({ shown: badges.slice(0, 1), dropped: 2 })
    expect(fitBadges('M', badges, 2, s => s.length)).toEqual({ shown: [], dropped: 3 })
  })
})
