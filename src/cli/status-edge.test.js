import { describe, expect, it, vi } from 'vitest'
import { formatStatus, runStatus, summarizeStatus } from './status.js'

const NOW = 1_700_000_000_000

describe('ambient status: stale, partial and malformed observations', () => {
  const summary = (counts, age) => ({
    schema_version: 1,
    counts: { review_requested: 0, failing_ci: 0, unread_notifications: 0, ...counts },
    cache_age_seconds: age,
  })

  it('uses only the newest entry per op and ignores entries without meta', () => {
    const result = summarizeStatus([
      { ts: NOW - 900_000, meta: { op: 'listPRs' }, payload: [{ reviewDecision: 'REVIEW_REQUIRED' }] },
      { ts: NOW - 5_000, meta: { op: 'listPRs' }, payload: [] },
      null,
      { ts: NOW, payload: [{ reviewDecision: 'REVIEW_REQUIRED' }] },
    ], NOW)
    expect(result.counts.review_requested).toBe(0)
    expect(result.cache_age_seconds).toBe(5)
  })

  it('treats a non-array payload as empty and a partial cache as valid', () => {
    const result = summarizeStatus([
      { ts: NOW - 1_000, meta: { op: 'listNotifications' }, payload: { error: 'x' } },
    ], NOW)
    expect(result.counts).toEqual({ review_requested: 0, failing_ci: 0, unread_notifications: 0 })
  })

  it('never reports a negative age when the cache timestamp is in the future', () => {
    const result = summarizeStatus([{ ts: NOW + 60_000, meta: { op: 'listPRs' }, payload: [] }], NOW)
    expect(result.cache_age_seconds).toBe(0)
  })

  it('detects failing checks via state/status and review requests via login', () => {
    vi.stubEnv('GITHUB_USER', 'Octo')
    try {
      const result = summarizeStatus([{
        ts: NOW,
        meta: { op: 'listPRs' },
        payload: [
          { statusCheckRollup: [{ state: 'error' }] },
          { statusCheckRollup: [{ conclusion: 'success' }, { status: 'IN_PROGRESS' }] },
          { reviewRequests: [{ login: 'octo' }] },
          { reviewRequests: [{ login: 'someone-else' }] },
          { reviewDecision: 'CHANGES_REQUESTED', statusCheckRollup: null },
        ],
      }], NOW)
      expect(result.counts.failing_ci).toBe(1)
      expect(result.counts.review_requested).toBe(2)
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('flags a stale cache in tmux output and honours NO_COLOR', () => {
    vi.stubEnv('NO_COLOR', '1')
    try {
      expect(formatStatus(summary({ failing_ci: 2 }, 15 * 60), 'tmux')).toBe('REV:0 CI:2 NOT:0 (15m)')
      expect(formatStatus(summary({}, 30), 'starship')).toBe('REV:0 CI:0 NOT:0')
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('runStatus argument handling', () => {
  const capture = async args => {
    const out = []
    const err = []
    const o = vi.spyOn(process.stdout, 'write').mockImplementation(s => { out.push(String(s)); return true })
    const e = vi.spyOn(process.stderr, 'write').mockImplementation(s => { err.push(String(s)); return true })
    try {
      return { code: await runStatus(args), out: out.join(''), err: err.join('') }
    } finally {
      o.mockRestore()
      e.mockRestore()
    }
  }

  it.each([
    [['--format', 'xml'], 'unsupported status format: xml'],
    [['--format=csv'], 'unsupported status format: csv'],
    [['--wat'], 'unknown argument: --wat'],
  ])('rejects %j with exit 2 and a stderr message', async (args, message) => {
    const result = await capture(args)
    expect(result.code).toBe(2)
    expect(result.err).toContain(message)
    expect(result.out).toBe('')
  })

  it('exits 0 and prints exactly one line for a valid format', async () => {
    const result = await capture(['--format=json'])
    expect(result.code).toBe(0)
    expect(result.out.trim().split('\n')).toHaveLength(1)
  })
})
