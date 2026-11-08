import { describe, expect, it, vi } from 'vitest'
import { loadWhyRed, summariseBase, formatDuration, MAX_CHECKS } from './why-red.js'
import { whyRedRows } from './why-red-rows.js'
import { NODE_ASSERT_LOG, UNPARSED_LOG, SECRET_LOG, TSC_LOG } from './ci-log.fixtures.js'

const PATCH = '@@ -1,3 +1,8 @@\n a\n b\n c\n+d\n+e\n+f\n+g\n+return a + b'
const fail = (id, name, extra = {}) => ({ id, name, status: 'completed', conclusion: 'failure', appName: 'GitHub Actions', startedAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:05Z', ...extra })

const mkDeps = (over = {}) => ({
  getFailedLog: vi.fn(async () => ({ state: 'ok', text: NODE_ASSERT_LOG, detail: '' })),
  listPRChangedPaths: vi.fn(async () => ({ files: [{ path: 'src/math.js', previousPath: null, status: 'modified' }], truncated: false, error: null })),
  getPRFilePatch: vi.fn(async () => ({ status: 'ok', patch: PATCH })),
  getBaseCheckHistory: vi.fn(async () => ({ state: 'ok', detail: '', samples: [{ sha: 'a', outcome: 'success' }, { sha: 'b', outcome: 'success' }], partial: false })),
  ...over,
})
const run = (checks, deps = mkDeps()) => loadWhyRed({ checks, repo: 'o/r', prNumber: 7, baseBranch: 'main', deps })
const text = rows => rows.map(r => r.text).join('\n')

describe('summariseBase', () => {
  const s = (outcomes, extra = {}) => summariseBase({ state: 'ok', samples: outcomes.map(outcome => ({ sha: 'x', outcome })), ...extra }, 'main')
  it('labels all-failing, flaky, passing and unknown', () => {
    expect(s(['failure', 'failure', 'failure']).verdict).toBe('also-failing')
    expect(s(['failure', 'success', 'success']).verdict).toBe('possibly-flaky')
    expect(s(['success', 'success']).verdict).toBe('passing')
    expect(s(['missing', 'other']).verdict).toBe('unknown')
    expect(summariseBase({ state: 'rate_limit', detail: 'GitHub API rate limit exceeded', samples: [] }, 'main').text).toMatch(/^unknown: .*rate limit/)
    expect(summariseBase(null, 'main').verdict).toBe('unknown')
  })
})

describe('formatDuration', () => {
  it('formats and returns null for unknown', () => {
    expect(formatDuration('2026-01-01T00:00:00Z', '2026-01-01T00:01:05Z')).toBe('1m 05s')
    expect(formatDuration(undefined, 'x')).toBeNull()
  })
})

describe('loadWhyRed', () => {
  it('links the failing check to the changed line and the excerpt', async () => {
    const m = await run([fail(1, 'test (20)')])
    expect(m.state).toBe('ok')
    const c = m.checks[0]
    expect(c.duration).toBe('1m 05s')
    expect(c.excerpt.kind).toBe('node-assert')
    expect(c.blame.items[0]).toMatchObject({ path: 'src/math.js', line: 7, kind: 'changed' })
    expect(c.base.verdict).toBe('passing')
    const out = text(whyRedRows(m, { prNumber: 7 }))
    expect(out).toContain('✗ test (20)  ·  1m 05s')
    expect(out).toContain('failing step: Run node --test')
    expect(out).toContain('src/math.js:7')
    expect(out).toContain('Seen before: passes on main')
  })

  it('shows every unknown as unknown: no log, unmatched trace, no base history', async () => {
    const deps = mkDeps({
      getFailedLog: vi.fn(async () => ({ state: 'expired', text: '', detail: 'Log not found or expired' })),
      getBaseCheckHistory: vi.fn(async () => ({ state: 'rate_limit', detail: 'GitHub API rate limit exceeded', samples: [], partial: false })),
    })
    const out = text(whyRedRows(await run([fail(1, 'build', { startedAt: null })], deps), { prNumber: 7 }))
    expect(out).toContain('duration unknown')
    expect(out).toContain('failing step: unknown')
    expect(out).toContain('Log excerpt: unknown (expired): Log not found or expired')
    expect(out).toContain('unknown: no log excerpt to match against the diff')
    expect(out).toMatch(/Seen before: unknown: .*rate limit/)
    expect(deps.listPRChangedPaths).not.toHaveBeenCalled()
  })

  it('says so when the trace names no changed file, and for an unparsed log', async () => {
    const other = mkDeps({ listPRChangedPaths: vi.fn(async () => ({ files: [{ path: 'docs/readme.md' }], truncated: true, error: null })) })
    const a = text(whyRedRows(await run([fail(1, 't')], other), { prNumber: 7 }))
    expect(a).toContain('no match: none of the')
    expect(a).toContain('PR file list truncated')
    expect(other.getPRFilePatch).not.toHaveBeenCalled()
    const b = text(whyRedRows(await run([fail(1, 't')], mkDeps({ getFailedLog: async () => ({ state: 'ok', text: UNPARSED_LOG, detail: '' }) })), { prNumber: 7 }))
    expect(b).toContain('no recognised failure shape')
  })

  it('redacts secrets and tells when the excerpt is cut', async () => {
    const m = await run([fail(1, 't')], mkDeps({ getFailedLog: async () => ({ state: 'ok', text: SECRET_LOG, detail: '' }) }))
    const out = text(whyRedRows(m, { prNumber: 7 }))
    expect(out).not.toMatch(/ghp_abcdefghijkl|AKIAABCDEFGH|hunter2|abcdefghijklmnop12345|user:pw/)
    const long = Array.from({ length: 200 }, (_, i) => `    at fn${i} (/w/src/math.js:${i + 1}:1)`).join('\n')
    const cut = await run([fail(1, 't')], mkDeps({ getFailedLog: async () => ({ state: 'ok', text: `Error: boom\n${long}`, detail: '' }) }))
    expect(text(whyRedRows(cut, { prNumber: 7 }))).toMatch(/truncated/)
  })

  it('bounds the work: at most MAX_CHECKS checks analysed, rest counted', async () => {
    const deps = mkDeps({ getFailedLog: async () => ({ state: 'ok', text: TSC_LOG, detail: '' }) })
    const m = await run(Array.from({ length: 8 }, (_, i) => fail(i + 1, `c${i}`)), deps)
    expect(m.checks).toHaveLength(MAX_CHECKS)
    expect(m.notAnalysed).toBe(3)
    expect(deps.getBaseCheckHistory).toHaveBeenCalledTimes(MAX_CHECKS)
    expect(text(whyRedRows(m, { prNumber: 7 }))).toContain('3 not analysed')
  })

  it('handles no checks, pending only, and no failures', async () => {
    expect((await run([])).state).toBe('no-checks')
    const pend = await run([{ id: 1, name: 'x', status: 'in_progress', conclusion: null }])
    expect(pend.state).toBe('pending')
    expect(text(whyRedRows(pend, { prNumber: 7 }))).toContain('still running')
    expect((await run([{ id: 1, name: 'x', status: 'completed', conclusion: 'success' }])).state).toBe('no-failures')
  })

  it('non-Actions checks have no log to read', async () => {
    const deps = mkDeps()
    const m = await run([fail(1, 'ext', { appName: 'Codecov' })], deps)
    expect(deps.getFailedLog).not.toHaveBeenCalled()
    expect(m.checks[0].log.detail).toMatch(/Not a GitHub Actions job/)
  })
})
