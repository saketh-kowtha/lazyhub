import { describe, it, expect, vi, beforeEach } from 'vitest'

const runGh = vi.fn()
vi.mock('./core.js', () => ({ runGh: (...a) => runGh(...a) }))

const {
  classifyPath, fileObservations, compareHead, freshness, returnTarget, fetchFileEvidence, fetchRequiredChecks,
  loadEvidenceDetail, evidenceRows, FILE_CEILING,
} = await import('./evidence-detail.js')

const NOW = Date.parse('2026-11-09T12:00:00Z')
const now = () => NOW

const prNode = (over = {}) => ({
  number: 7, title: 'Retry in sender', url: 'https://github.com/acme/web/pull/7', state: 'OPEN', isDraft: false,
  updatedAt: '2026-11-09T00:00:00Z', headRefOid: 'head2aaaa', baseRefName: 'main', mergeable: 'MERGEABLE', reviewDecision: 'APPROVED',
  additions: 10, deletions: 2, changedFiles: 3, body: 'Body line one\nline two',
  author: { login: 'dev-agent', __typename: 'Bot' },
  reviewRequests: { pageInfo: { hasNextPage: false }, nodes: [] },
  latestOpinionatedReviews: { pageInfo: { hasNextPage: false }, nodes: [{ state: 'APPROVED', author: { login: 'maria' }, commit: { oid: 'head1' } }] },
  reviewThreads: { totalCount: 1, pageInfo: { hasNextPage: false }, nodes: [{ isResolved: false, path: 'src/a.js', comments: { nodes: [{ bodyText: 'Is reset covered?', author: { login: 'jin' } }] } }] },
  commits: { nodes: [{ commit: { oid: 'head2aaaa', statusCheckRollup: { state: 'FAILURE', contexts: { totalCount: 1, nodes: [{ __typename: 'CheckRun', status: 'COMPLETED', conclusion: 'FAILURE' }] } } } }] },
  ...over,
})

const filesPage = (paths, { more = false, total = paths.length, head = 'head2aaaa', cursor = 'c1' } = {}) => ({
  data: { repository: { pullRequest: { headRefOid: head, files: { totalCount: total, pageInfo: { hasNextPage: more, endCursor: more ? cursor : null }, nodes: paths.map(p => ({ path: p, additions: 2, deletions: 1, changeType: 'MODIFIED' })) } } } },
})
const requiredPage = (nodes, { total = nodes.length, head = 'head2aaaa' } = {}) => ({
  data: { repository: { pullRequest: { headRefOid: head, commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { totalCount: total, pageInfo: { hasNextPage: total > nodes.length }, nodes } } } }] } } } },
})

// Route a runGh call by the query it carries.
function route({ record = { data: { viewer: { login: 'octocat' }, repository: { pullRequest: prNode() } } }, files = filesPage(['src/a.js']), required = requiredPage([]) } = {}) {
  runGh.mockImplementation(async args => {
    const q = args.find(a => String(a).startsWith('query='))
    const pick = v => { if (v instanceof Error) throw v; return v }
    if (q.includes('isRequired')) return pick(required)
    if (q.includes('files(first')) return pick(files)
    return pick(record)
  })
}

beforeEach(() => { runGh.mockReset() })

describe('classifyPath', () => {
  it.each([
    ['src/a.test.js', 'test'], ['pkg/x_test.go', 'test'], ['tests/helper.py', 'test'], ['docs/guide.md', 'docs'], ['README.md', 'docs'],
    ['.github/workflows/ci.yml', 'ci'], ['package-lock.json', 'lockfile'], ['web/yarn.lock', 'lockfile'], ['package.json', 'manifest'], ['src/index.js', 'source'],
  ])('%s is %s', (path, kind) => expect(classifyPath(path)).toBe(kind))
})

describe('fileObservations', () => {
  const f = (path, change_type = 'MODIFIED') => ({ path, change_type, kind: classifyPath(path) })
  it('flags removed tests, workflow edits and a lockfile without its manifest, citing paths', () => {
    const codes = Object.fromEntries(fileObservations([f('src/a.test.js', 'DELETED'), f('.github/workflows/ci.yml'), f('package-lock.json'), f('src/a.js')]).map(o => [o.code, o.paths]))
    expect(codes.tests_removed).toEqual(['src/a.test.js'])
    expect(codes.ci_workflow_changed).toEqual(['.github/workflows/ci.yml'])
    expect(codes.lockfile_without_manifest).toEqual(['package-lock.json'])
  })
  it('does not flag a lockfile that comes with its manifest, and says nothing for no files', () => {
    expect(fileObservations([f('package-lock.json'), f('package.json')]).map(o => o.code)).toEqual([])
    expect(fileObservations([])).toEqual([])
  })
})

describe('compareHead and freshness', () => {
  it('is current, stale or unknown, never assumed current', () => {
    expect(compareHead('a', 'a').state).toBe('current')
    expect(compareHead('a', 'b')).toEqual({ state: 'stale', inspected: 'a', current: 'b' })
    expect(compareHead(null, 'b').state).toBe('unknown')
    expect(compareHead('a', 'unknown').state).toBe('unknown')
  })
  it('flags a read older than the TTL, and a missing time, as stale', () => {
    expect(freshness('2026-11-09T11:59:30Z', NOW).stale).toBe(false)
    expect(freshness('2026-11-09T11:58:00Z', NOW)).toMatchObject({ stale: true, age_ms: 120000 })
    expect(freshness(undefined, NOW).stale).toBe(true)
  })
})

describe('returnTarget', () => {
  it('is a frozen, normalized description of where to go back to', () => {
    const t = returnTarget({ view: 'queue', position: '3', filter: 'ci_failing', key: 'acme/web#7' })
    expect(t).toEqual({ view: 'queue', position: 3, filter: 'ci_failing', key: 'acme/web#7' })
    expect(Object.isFrozen(t)).toBe(true)
    expect(returnTarget({ position: -4 }).position).toBe(0)
  })
})

describe('fetchFileEvidence', () => {
  it('walks cursor pages, classifies paths, and is not truncated when complete', async () => {
    runGh.mockResolvedValueOnce(filesPage(['a.js'], { more: true, total: 2 })).mockResolvedValueOnce(filesPage(['b.test.js'], { total: 2 }))
    const f = await fetchFileEvidence('acme/web', 7, { now })
    expect(f.value.items.map(i => [i.path, i.kind])).toEqual([['a.js', 'source'], ['b.test.js', 'test']])
    expect(f.value).toMatchObject({ total: 2, returned: 2, truncated: false, head: 'head2aaaa' })
    expect(f.source).toMatch(/^github\.graphql/)
    const second = runGh.mock.calls[1][0]
    expect(second).toContain('after=c1')
    expect(second).toContain('number=7')
  })
  it('stops at the ceiling and reports the total instead of hiding the rest', async () => {
    const page = Array.from({ length: 100 }, (_, i) => `f${i}.js`)
    runGh.mockResolvedValue(filesPage(page, { more: true, total: 450 }))
    const f = await fetchFileEvidence('acme/web', 7, { now })
    expect(f.value.returned).toBe(FILE_CEILING)
    expect(f.value).toMatchObject({ total: 450, truncated: true })
    expect(runGh).toHaveBeenCalledTimes(FILE_CEILING / 100)
  })
  it('refuses a mixed read when the head moves between pages', async () => {
    runGh.mockResolvedValueOnce(filesPage(['a.js'], { more: true, total: 2 })).mockResolvedValueOnce(filesPage(['b.js'], { head: 'other' }))
    await expect(fetchFileEvidence('acme/web', 7, { now })).rejects.toThrow(/head moved/)
  })
  it('rejects a malformed repo or number before any call', async () => {
    await expect(fetchFileEvidence('nope', 7)).rejects.toThrow(/invalid repo/)
    await expect(fetchFileEvidence('a/b', 0)).rejects.toThrow(/invalid pull request number/)
    expect(runGh).not.toHaveBeenCalled()
  })
})

describe('fetchRequiredChecks', () => {
  const run = (name, conclusion, isRequired, status = 'COMPLETED') => ({ __typename: 'CheckRun', name, status, conclusion, isRequired })
  it('counts only required checks and keeps the not-yet-reported caveat in the value', async () => {
    runGh.mockResolvedValue(requiredPage([run('lint', 'SUCCESS', true), run('test', 'FAILURE', true), run('build', null, true, 'IN_PROGRESS'), run('extra', 'FAILURE', false), { __typename: 'StatusContext', context: 'ci/x', state: 'SUCCESS', isRequired: true }]))
    const f = await fetchRequiredChecks('acme/web', 7, { now })
    expect(f.value).toMatchObject({ required: 4, passing: 2, failing: 1, pending: 1, total: 5, truncated: false })
    expect(f.value.names).toEqual(['lint', 'test', 'build', 'ci/x'])
  })
  it('marks counts as a lower bound when more checks exist than were read', async () => {
    runGh.mockResolvedValue(requiredPage([run('lint', 'SUCCESS', true)], { total: 400 }))
    expect((await fetchRequiredChecks('acme/web', 7, { now })).value.truncated).toBe(true)
  })
  it('is zero required (a known state) when GitHub reports no rollup', async () => {
    runGh.mockResolvedValue({ data: { repository: { pullRequest: { headRefOid: 'h', commits: { nodes: [{ commit: { statusCheckRollup: null } }] } } } } })
    expect((await fetchRequiredChecks('acme/web', 7, { now })).value).toMatchObject({ required: 0, truncated: false })
  })
})

describe('loadEvidenceDetail', () => {
  it('combines the record, files and required checks, replacing the always-unknown required_checks fact', async () => {
    route({ required: requiredPage([{ __typename: 'CheckRun', name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS', isRequired: true }]) })
    const d = await loadEvidenceDetail('acme/web', 7, { now })
    expect(d.errors).toEqual([])
    expect(d.record.facts.required_checks.value.required).toBe(1)
    expect(d.files.value.items).toHaveLength(1)
    expect(d.head.state).toBe('current')
  })
  it('degrades the files read to an explicit unknown with the reason, keeping the rest', async () => {
    route({ files: new Error('API rate limit exceeded') })
    const d = await loadEvidenceDetail('acme/web', 7, { now })
    expect(d.files.value).toBe('unknown')
    expect(d.errors).toEqual([{ part: 'files', message: expect.stringContaining('rate limit') }])
    const rows = evidenceRows(d, { now })
    expect(rows.find(r => r.label === 'files').value).toMatch(/^unknown \(.*rate limit/)
    expect(rows.some(r => r.section === 'Not read' && r.label === 'files')).toBe(true)
  })
  it('throws when the record itself cannot be read (nothing to show)', async () => {
    route({ record: new Error('not found') })
    await expect(loadEvidenceDetail('acme/web', 7, { now })).rejects.toThrow(/not found/)
  })
  it('reports a changed head against the inspected one', async () => {
    route()
    const d = await loadEvidenceDetail('acme/web', 7, { now, inspectedHead: 'head1aaaa' })
    expect(d.head).toEqual({ state: 'stale', inspected: 'head1aaaa', current: 'head2aaaa' })
    expect(evidenceRows(d, { now }).find(r => r.label === 'changed').tone).toBe('bad')
  })
})

describe('evidenceRows', () => {
  it('cites a source and read time on every fact row and puts author prose last, flagged untrusted', async () => {
    route({ required: requiredPage([]) })
    const d = await loadEvidenceDetail('acme/web', 7, { now })
    const rows = evidenceRows(d, { now })
    const facts = rows.filter(r => ['Checks', 'Review', 'Merge', 'Files'].includes(r.section) && r.label !== 'note')
    expect(facts.length).toBeGreaterThan(5)
    for (const r of facts) expect(r.source, `${r.section}/${r.label}`).toBeTruthy()
    const firstUntrusted = rows.findIndex(r => r.untrusted)
    expect(rows.slice(firstUntrusted).every(r => r.untrusted || r.section === 'Not read')).toBe(true)
    expect(rows.find(r => r.label === 'actor').value).toContain('attribution unverified')
    expect(rows.find(r => r.label === 'approvals').value).toContain('stale')
  })
  it('shows a stale read as stale', async () => {
    route()
    const d = await loadEvidenceDetail('acme/web', 7, { now })
    const later = evidenceRows(d, { now: NOW + 5 * 60_000 })
    expect(later.find(r => r.label === 'read').value).toContain('STALE')
  })
  it('cleans control and bidi characters from every GitHub string', async () => {
    const evil = '\x1b]0;pwn\x07‮​'
    route({ record: { data: { viewer: { login: 'octocat' }, repository: { pullRequest: prNode({ title: `T${evil}`, body: `B${evil}`, author: { login: `u${evil}`, __typename: 'User' } }) } } }, files: filesPage([`src/x${evil}.js`]) })
    const d = await loadEvidenceDetail('acme/web', 7, { now })
    const text = evidenceRows(d, { now }).map(r => `${r.label} ${r.value}`).join('\n')
    expect(/[\x00-\x08\x0b-\x1f\x7f-\x9f​-‏‪-‮]/.test(text)).toBe(false)
  })
  it('notes when files were read at a different head than the record', async () => {
    route({ files: filesPage(['a.js'], { head: 'older' }) })
    const rows = evidenceRows(await loadEvidenceDetail('acme/web', 7, { now }), { now })
    expect(rows.find(r => r.label === 'note').value).toContain('earlier head')
  })
})
