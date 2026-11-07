import { describe, expect, it } from 'vitest'
import { fuzzyScore, buildAuthorCandidates, rankAuthors, loadRecentAuthors, rememberAuthor, RECENT_AUTHORS_MAX } from './author-candidates.js'
import { saveState } from '../../config.js'

describe('author candidates (#563)', () => {
  it('scores exact, prefix, substring and subsequence matches, case-insensitively', () => {
    expect(fuzzyScore('Alice', 'alice')).toBe(0)
    expect(fuzzyScore('al', 'Alice')).toBe(1)
    expect(fuzzyScore('lic', 'alice')).toBeGreaterThan(1)
    expect(fuzzyScore('ace', 'alice')).toBeGreaterThan(10)
    expect(fuzzyScore('zz', 'alice')).toBeNull()
  })

  it('merges rows, collaborators and recents once per login with their sources', () => {
    const out = buildAuthorCandidates({
      rows: [{ author: { login: 'Alice' } }, { author: { login: 'bob' } }, { author: null }],
      collaborators: [{ login: 'alice', name: 'Alice A' }, { login: 'carol' }],
      recent: ['bob'],
    })
    expect(out.map(c => c.login)).toEqual(['bob', 'Alice', 'carol'])
    expect(out.find(c => c.login === 'Alice')).toMatchObject({ name: 'Alice A', sources: ['row', 'collaborator'] })
    expect(out.find(c => c.login === 'bob').sources).toEqual(['recent', 'row'])
  })

  it('ranks the exact match first, then prefixes, then looser matches, and drops non-matches', () => {
    const c = buildAuthorCandidates({ collaborators: [{ login: 'malice' }, { login: 'alice-bot' }, { login: 'alice' }, { login: 'bob' }] })
    expect(rankAuthors(c, 'ALICE').map(x => x.login)).toEqual(['alice', 'alice-bot', 'malice'])
    expect(rankAuthors(c, '@bo').map(x => x.login)).toEqual(['bob', 'alice-bot'])
    expect(rankAuthors(c, 'zz')).toEqual([])
    expect(rankAuthors(c, '').length).toBe(4)
  })

  it('matches on the display name too', () => {
    const c = buildAuthorCandidates({ collaborators: [{ login: 'xq', name: 'Grace Hopper' }] })
    expect(rankAuthors(c, 'hopper').map(x => x.login)).toEqual(['xq'])
  })

  it('remembers recent filters per repository, most recent first, deduplicated and capped', () => {
    saveState({ recentAuthors: {} })
    expect(loadRecentAuthors('o/r')).toEqual([])
    rememberAuthor('o/r', 'alice')
    rememberAuthor('o/r', 'bob')
    rememberAuthor('o/r', 'ALICE')
    rememberAuthor('o/other', 'zed')
    rememberAuthor('o/r', '')
    expect(loadRecentAuthors('o/r')).toEqual(['ALICE', 'bob'])
    expect(loadRecentAuthors('o/other')).toEqual(['zed'])
    for (let i = 0; i < RECENT_AUTHORS_MAX + 3; i++) rememberAuthor('o/r', `u${i}`)
    expect(loadRecentAuthors('o/r')).toHaveLength(RECENT_AUTHORS_MAX)
    saveState({ recentAuthors: {} })
  })
})
