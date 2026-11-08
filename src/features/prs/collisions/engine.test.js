import { describe, expect, it } from 'vitest'
import { buildClusters, collisionsFor, findCollisions, isGenerated, parsePatchChanges, rangesOverlap, suggestMergeOrder } from './engine.js'

const patch = (...lines) => lines.join('\n')
const f = (path, over = {}) => ({ path, additions: 1, deletions: 1, changeType: 'MODIFIED', ...over })
const pr = (number, files, over = {}) => ({ number, baseRefName: 'main', additions: 5, deletions: 5, files, ...over })

describe('parsePatchChanges', () => {
  it('maps changes to old-side ranges and keeps the function heading', () => {
    const c = parsePatchChanges(patch('@@ -10,4 +10,4 @@ function foo() {', ' a', '-b', '+B', ' c'))
    expect(c.ranges).toHaveLength(1)
    expect(c.symbols).toEqual(['function foo() {'])
  })
  it('ignores unchanged hunks for symbols and tolerates no-newline markers', () => {
    expect(parsePatchChanges('').ranges).toEqual([])
    expect(parsePatchChanges(patch('@@ -1,2 +1,2 @@ fn', ' a', ' b')).symbols).toEqual([])
    expect(parsePatchChanges(patch('@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b')).ranges).toHaveLength(1)
  })
})

describe('rangesOverlap', () => {
  const r = (p) => parsePatchChanges(p).ranges
  const at = (n) => `@@ -${n},1 +${n},1 @@\n-x`
  it('same line, adjacent line and an insertion next to a deletion overlap; a gap does not', () => {
    expect(rangesOverlap(r(at(5)), r(at(5)))).toBe(true)
    expect(rangesOverlap(r(at(5)), r(at(6)))).toBe(true)
    expect(rangesOverlap(r('@@ -6,0 +6,1 @@\n+n'), r(at(5)))).toBe(true)
    expect(rangesOverlap(r(at(5)), r(at(7)))).toBe(false)
    expect(rangesOverlap(r(at(5)), r(at(50)))).toBe(false)
  })
})

describe('isGenerated', () => {
  it('matches defaults, base names and custom globs', () => {
    expect(isGenerated('docs/FILE_MAP.md')).toBe(true)
    expect(isGenerated('web/package-lock.json')).toBe(true)
    expect(isGenerated('src/a.js')).toBe(false)
    expect(isGenerated('x/y.gen.ts', ['*.gen.ts'])).toBe(true)
    expect(isGenerated('gen/a/b.js', ['gen/**'])).toBe(true)
  })
})

describe('findCollisions', () => {
  const withChanges = (p) => f('src/a.js', { changes: parsePatchChanges(p) })
  it('reports overlapping hunks as likely, same function as symbol, other lines as plain file', () => {
    const a = pr(1, [withChanges(patch('@@ -10,3 +10,3 @@ fn one', '-a', '+b'))])
    const hunk = pr(2, [withChanges(patch('@@ -10,3 +10,3 @@ fn one', '-a', '+b'))])
    const sym = pr(3, [withChanges(patch('@@ -90,3 +90,3 @@ fn one', '-a', '+b'))])
    const far = pr(4, [withChanges(patch('@@ -200,3 +200,3 @@ other', '-a', '+b'))])
    const { pairs } = findCollisions([a, hunk, sym, far])
    const pair = (x, y) => pairs.find(p => p.a === x && p.b === y)
    expect(pair(1, 2).files[0].kind).toBe('hunk')
    expect(pair(1, 2).likely).toBe(true)
    expect(pair(1, 3).files[0].kind).toBe('symbol')
    expect(pair(1, 3).likely).toBe(false)
    expect(pair(1, 4).files[0].kind).toBe('file')
    expect(pair(1, 4).files[0].detail).toMatch(/different parts/)
  })
  it('says hunks were not compared when there is no patch data', () => {
    const { pairs } = findCollisions([pr(1, [f('x.js')]), pr(2, [f('x.js')])])
    expect(pairs[0].files[0]).toMatchObject({ kind: 'file', hunksCompared: false, likely: false })
  })
  it('handles add/add, delete vs edit, both delete, binary and omitted patches', () => {
    const k = (a, b) => findCollisions([pr(1, [a]), pr(2, [b])]).pairs[0].files[0]
    expect(k(f('n.js', { changeType: 'ADDED' }), f('n.js', { changeType: 'ADDED' })).kind).toBe('add-add')
    expect(k(f('n.js', { changeType: 'DELETED' }), f('n.js')).kind).toBe('delete-edit')
    expect(k(f('n.js', { changeType: 'DELETED' }), f('n.js', { changeType: 'DELETED' }))).toMatchObject({ kind: 'file', likely: false })
    expect(k(f('i.png', { changes: { binary: true, ranges: [], symbols: [] } }), f('i.png'))).toMatchObject({ kind: 'binary', likely: true })
    const omitted = k(f('big.json', { changes: { unavailable: 'omitted', ranges: [], symbols: [] } }), f('big.json', { changes: { ranges: [], symbols: [] } }))
    expect(omitted.detail).toMatch(/too large/)
  })
  it('follows renames through the previous name', () => {
    const ren = f('new.js', { changeType: 'RENAMED', oldPath: 'old.js' })
    const { pairs } = findCollisions([pr(1, [ren]), pr(2, [f('old.js')])])
    expect(pairs[0].files[0]).toMatchObject({ kind: 'rename', likely: false, path: 'old.js' })
    expect(pairs[0].files[0].detail).toMatch(/#1 renames old.js to new.js/)
    const other = f('other.js', { changeType: 'RENAMED', oldPath: 'old.js' })
    expect(findCollisions([pr(1, [ren]), pr(2, [other])]).pairs[0].files[0]).toMatchObject({ kind: 'rename-rename', likely: true })
  })
  it('groups generated files apart and ignores PRs with another base', () => {
    const { pairs, otherBase } = findCollisions([
      pr(1, [f('docs/FILE_MAP.md')]), pr(2, [f('docs/FILE_MAP.md')]), pr(3, [f('docs/FILE_MAP.md')], { baseRefName: 'dev' }),
    ])
    expect(pairs).toHaveLength(1)
    expect(pairs[0]).toMatchObject({ generatedOnly: true, generated: ['docs/FILE_MAP.md'], level: 'generated', likely: false })
    expect(otherBase).toBe(1)
  })
  it('is deterministic for any input order', () => {
    const set = [pr(3, [f('a.js')]), pr(1, [f('a.js')]), pr(2, [f('a.js')])]
    expect(findCollisions(set)).toEqual(findCollisions([...set].reverse()))
  })
})

describe('clusters and merge order', () => {
  const set = [
    pr(1, [f('a.js'), f('docs/FILE_MAP.md')], { additions: 50, deletions: 0 }),
    pr(2, [f('a.js')], { additions: 5, deletions: 0 }),
    pr(3, [f('a.js'), f('docs/FILE_MAP.md')], { additions: 1, deletions: 0 }),
    pr(4, [f('b.js'), f('c.js')], { additions: 9, deletions: 0 }),
    pr(5, [f('c.js')], { additions: 2, deletions: 0 }),
    pr(6, [f('z.js')], { isDraft: true }),
  ]
  const { pairs } = findCollisions(set)
  it('clusters connected PRs and lists generated groups', () => {
    const { clusters, generated } = buildClusters(pairs)
    expect(clusters.map(c => c.prs)).toEqual([[1, 2, 3], [4, 5]])
    expect(generated).toEqual([{ path: 'docs/FILE_MAP.md', prs: [1, 3] }])
    expect(collisionsFor(2, pairs).map(c => c.other)).toEqual([1, 3])
  })
  it('orders fewest overlaps first, then smaller diff, with a reason per step', () => {
    const { steps, independent } = suggestMergeOrder(set, pairs)
    // 5 and 4 overlap once each (2 lines < 9); 1, 2, 3 overlap twice each, ordered by size 1 < 5 < 50.
    expect(steps.map(s => s.number)).toEqual([5, 4, 3, 2, 1])
    expect(steps[0].reason).toMatch(/1 code overlap/)
    expect(steps.find(s => s.number === 1).reason).toMatch(/generated files with #3/)
    expect(independent).toBe(1)
    expect(suggestMergeOrder([...set].reverse(), pairs)).toEqual({ steps, independent })
  })
})
