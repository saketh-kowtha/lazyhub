import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A fake `gh`: GraphQL answers with the open-PR pages, REST answers what the jq filter would print.
const fake = vi.hoisted(() => ({ calls: [], prs: [], total: 0, patches: {}, restFail: new Set() }))
vi.mock('execa', () => ({
  execa: vi.fn((_cmd, args = []) => {
    fake.calls.push(args.join(' '))
    const out = (v) => Object.assign(Promise.resolve({ stdout: JSON.stringify(v), stderr: '', exitCode: 0 }), { stdin: { write() {}, end() {} } })
    const fail = () => Object.assign(Promise.reject(Object.assign(new Error('boom'), { exitCode: 1, stderr: 'boom' })), { stdin: { write() {}, end() {} } })
    const rest = args.find(a => /\/pulls\/\d+\/files/.test(a))
    if (rest) {
      const n = Number(rest.match(/pulls\/(\d+)\//)[1])
      if (fake.restFail.has(n)) return fail()
      const wanted = args.find(x => x.startsWith('[.[]')) || ''
      const rows = (fake.patches[n] || []).map(r => ({ path: r.path, oldPath: r.oldPath || null, status: r.status || 'modified', additions: r.additions ?? 1, deletions: r.deletions ?? 1, patch: wanted.includes(JSON.stringify(r.path)) ? r.patch ?? null : null }))
      return out(rows)
    }
    if (args.includes('graphql')) {
      const query = args.find(a => a.startsWith('query=')) || ''
      if (query.includes('pullRequest(number')) {
        const number = Number(args.find(a => a.startsWith('number=')).slice(7))
        return out({ data: { repository: { pullRequest: toNode(fake.prs.find(p => p.number === number) || { number, state: 'MERGED', files: [] }) } } })
      }
      const after = (args.find(a => a.startsWith('after=')) || 'after=0').slice(6)
      const start = Number(after)
      const slice = fake.prs.slice(start, start + 50)
      const end = start + slice.length
      return out({ data: { repository: { pullRequests: { totalCount: fake.total || fake.prs.length, pageInfo: { hasNextPage: fake.total ? true : end < fake.prs.length, endCursor: String(end) }, nodes: slice.map(toNode) } } } })
    }
    return out([])
  }),
}))
vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../../test/input-bus.js')).mockUseInput(React) }
})

import { getCollisionScan } from './scan.js'
import { findCollisions } from './engine.js'
import { CollisionRadar } from './view.jsx'
import { sendInput } from '../../../test/input-bus.js'
import { resetGhMemoryCache } from '../../../hooks/useGh.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../../test/test-helpers.jsx'

function toNode(p) {
  return {
    number: p.number, title: p.title || `PR ${p.number}`, isDraft: false, state: p.state || 'OPEN', url: `https://x/${p.number}`,
    baseRefName: p.base || 'main', headRefName: `b${p.number}`, updatedAt: '2026-11-01T00:00:00Z', additions: 5, deletions: 5,
    author: { login: 'alice' },
    files: { totalCount: p.filesTotal ?? p.files.length, pageInfo: { hasNextPage: false, endCursor: null }, nodes: p.files.map(f => ({ additions: 1, deletions: 1, changeType: 'MODIFIED', ...(typeof f === 'string' ? { path: f } : f) })) },
  }
}
const patchAt = (line, heading = 'fn one') => `@@ -${line},3 +${line},3 @@ ${heading}\n-a\n+b`

beforeEach(() => {
  fake.calls = []; fake.total = 0; fake.restFail = new Set()
  fake.prs = [
    { number: 1, title: 'Fix parser', files: ['a.js', 'docs/FILE_MAP.md'] },
    { number: 2, title: 'Rework lexer', files: ['a.js'] },
    { number: 3, title: 'Tune lexer', files: ['a.js'] },
    { number: 4, title: 'Docs only', files: ['docs/FILE_MAP.md'] },
    { number: 5, title: 'Other base', base: 'dev', files: ['a.js'] },
    { number: 6, title: 'Unrelated', files: ['z.js'] },
  ]
  fake.patches = {
    1: [{ path: 'a.js', patch: patchAt(10) }],
    2: [{ path: 'a.js', patch: patchAt(11) }],
    3: [{ path: 'a.js', patch: patchAt(300) }],
  }
  resetGhMemoryCache()
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('getCollisionScan with a fake gh (#360)', () => {
  it('fetches patches only for PRs sharing a file with the current one, and reports what it did', async () => {
    const scan = await getCollisionScan('o/r', 1)
    expect(scan.prs).toHaveLength(6)
    expect(scan.hunkChecked).toEqual([2, 3])
    const rest = fake.calls.filter(c => /pulls\/\d+\/files/.test(c))
    // current PR once, PRs 2 and 3 once each: nothing for 4, 5 (other base) or 6
    expect(rest.map(c => c.match(/pulls\/(\d+)\//)[1]).sort()).toEqual(['1', '2', '3'])
    expect(rest.every(c => c.includes('per_page=100'))).toBe(true)
    const a = scan.prs.find(p => p.number === 2).files[0]
    expect(a.changes.ranges.length).toBe(1)
    expect(scan.notScanned).toBe(0)
    expect(scan.errors).toEqual([])
  })

  it('caps the scan at 300 open PRs and says how many were not read', async () => {
    fake.prs = Array.from({ length: 400 }, (_, i) => ({ number: i + 1, files: [`f${i}.js`] }))
    fake.total = 400
    const scan = await getCollisionScan('o/r', 1)
    expect(fake.calls.filter(c => c.includes('graphql') && c.includes('pullRequests(')).length).toBe(6)
    expect(scan.prs).toHaveLength(300)
    expect(scan.notScanned).toBe(100)
  })

  it('reports a PR whose patches could not be read instead of dropping it silently', async () => {
    fake.restFail = new Set([2])
    const scan = await getCollisionScan('o/r', 1)
    expect(scan.errors.map(e => e.number)).toEqual([2])
    expect(scan.hunkChecked).toEqual([3])
  })

  it('fetches the current PR on its own when it is beyond the scanned pages', async () => {
    fake.prs = [...Array.from({ length: 5 }, (_, i) => ({ number: 100 + i, files: ['q.js'] })), { number: 1, files: ['a.js'] }]
    const scan = await getCollisionScan('o/r', 777)
    expect(scan.currentOutside).toBe(true)
    expect(scan.prs.find(p => p.number === 777).state).toBe('MERGED')
    expect(fake.calls.filter(c => /pulls\/\d+\/files/.test(c))).toEqual([])
  })

  it('learns a rename source from REST so an edit to the old path is seen', async () => {
    fake.prs = [
      { number: 1, files: [{ path: 'new.js', changeType: 'RENAMED' }] },
      { number: 2, files: ['old.js'] },
    ]
    fake.patches = { 1: [{ path: 'new.js', oldPath: 'old.js', status: 'renamed' }] }
    const scan = await getCollisionScan('o/r', 1)
    expect(scan.prs[0].files[0].oldPath).toBe('old.js')
    const { pairs } = findCollisions(scan.prs)
    expect(pairs[0].files[0].kind).toBe('rename')
  })
})

describe('CollisionRadar screen (#360)', () => {
  async function open() {
    const view = renderWithProviders(<CollisionRadar repo="o/r" prNumber={1} onClose={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Fix parser'), { timeout: 4000 })
    await flush(20)
    return view
  }

  it('lists colliding PRs with the reason, flags likely conflicts, and groups generated files', async () => {
    const view = await open()
    const frame = view.lastFrame()
    expect(frame).toContain('#2 Rework lexer')
    expect(frame).toContain('likely conflict')
    expect(frame).toContain('[same lines]')
    expect(frame).toContain('#3 Tune lexer')
    expect(frame).toContain('same function, different lines')
    expect(frame).toContain('merge one at a time')
    expect(frame).not.toContain('#5 Other base')
    expect(frame).toContain('scanned')
  })

  it('Tab shows clusters and a merge order with a reason per step; nothing is mutated', async () => {
    const view = await open()
    await sendInput('', { tab: true })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Suggested merge order'))
    const frame = view.lastFrame()
    expect(frame).toContain('Collision clusters')
    expect(frame).toMatch(/1\. #\d/)
    expect(frame).toContain('code overlap')
    expect(fake.calls.every(c => !/\b(POST|PATCH|PUT|DELETE|merge|rebase)\b/.test(c))).toBe(true)
  })
})
