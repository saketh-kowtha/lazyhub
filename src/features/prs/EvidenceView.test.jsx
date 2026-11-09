import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'
import { sendInput } from '../../test/input-bus.js'
import { loadEvidenceDetail, returnTarget } from '../../executor.js'
import { EvidenceView } from './EvidenceView.jsx'

vi.mock('ink', async () => ({
  ...await vi.importActual('ink'),
  useInput: (await import('../../test/input-bus.js')).mockUseInput(await import('react')),
}))
vi.mock('../../executor.js', async () => ({ ...await vi.importActual('../../executor.js'), loadEvidenceDetail: vi.fn() }))

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const frame = v => v.lastFrame() ?? ''

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)

const fact = (value, source = 'github.graphql.x') => ({ value, source, fetched_at: '2026-11-09T12:00:00.000Z' })
const unknownChecks = { state: 'unknown', total: 'unknown', passed: 'unknown', failed: 'unknown', pending: 'unknown', truncated: false }

function detail(over = {}) {
  const required = fact({ required: 2, passing: 1, failing: 1, pending: 0, total: 3, truncated: false, head: 'head2aaaa', names: ['lint', 'test'] }, 'github.graphql.isRequired')
  return {
    schema_version: 1,
    record: {
      identity: { host: 'github.com', repo: 'o/r', number: 5, url: null, account: 'octocat' },
      context: { head: fact('head2aaaa'), base: fact('main') },
      facts: {
        state: fact('OPEN'), is_draft: fact(false), mergeable: fact('MERGEABLE'), review_decision: fact('APPROVED'),
        checks: fact({ ...unknownChecks, state: 'FAILURE', total: 3, passed: 2, failed: 1, pending: 0 }),
        reviews: fact({ approvals: 1, staleApprovals: 1, changesRequested: 0, mine: 'NONE', truncated: false }),
        review_requests: fact({ via: 'direct', teams: [], truncated: false }),
        unresolved_threads: fact({ unresolved: 1, total: 1, truncated: false }),
        required_checks: required,
      },
      attention: [{ code: 'ci_failing', fact: 'checks', value: {}, source: 'github.graphql' }],
      actor: { login: 'dev-agent', github_type: 'Bot', source: 's', attribution: 'unverified' },
      untrusted: { title: 'Retry in sender', title_truncated: false, body: 'Adds retry', body_truncated: false, threads: [] },
      fetched_at: new Date().toISOString(),
    },
    files: fact({ items: [{ path: 'src/a.js', additions: 3, deletions: 1, change_type: 'MODIFIED', kind: 'source' }], total: 1, returned: 1, truncated: false, head: 'head2aaaa' }, 'github.graphql.files'),
    required_checks: required,
    head: { state: 'current', inspected: 'head2aaaa', current: 'head2aaaa' },
    errors: [],
    fetched_at: new Date().toISOString(),
    ...over,
  }
}

const pr = { number: 5, title: 'T' }

describe('EvidenceView', () => {
  it('shows facts with their values, labels the read-only boundary, and loads once for the repo and number', async () => {
    loadEvidenceDetail.mockResolvedValue(detail())
    const view = renderWithProviders(<EvidenceView pr={pr} repo="o/r" onClose={() => {}} />)
    await waitForExpectation(() => expect(frame(view)).toContain('Revision'))
    const f = frame(view)
    expect(f).toContain('o/r#5')
    expect(f).toContain('read-only')
    expect(f).toContain('head2aa on main')
    expect(f).toContain('does not approve, merge or authorize')
    expect(f).toContain('No AI was used')
    expect(loadEvidenceDetail).toHaveBeenCalledTimes(1)
    expect(loadEvidenceDetail.mock.calls[0][0]).toBe('o/r')
    expect(loadEvidenceDetail.mock.calls[0][1]).toBe(5)
  })

  it('shows the source and read time of the selected row', async () => {
    loadEvidenceDetail.mockResolvedValue(detail())
    const view = renderWithProviders(<EvidenceView pr={pr} repo="o/r" onClose={() => {}} />)
    await waitForExpectation(() => expect(frame(view)).toContain('Revision'))
    await flush(20)
    await sendInput('j')
    await flush(20)
    expect(frame(view)).toContain('source github.graphql')
    expect(frame(view)).toContain('read 2026-11-09')
  })

  it('shows a failed part as unknown with the reason, never as a passing value', async () => {
    const d = detail({ required_checks: fact('unknown', 'unavailable:required_checks'), errors: [{ part: 'required_checks', message: 'API rate limit exceeded' }] })
    loadEvidenceDetail.mockResolvedValue(d)
    const view = renderWithProviders(<EvidenceView pr={pr} repo="o/r" onClose={() => {}} />)
    await waitForExpectation(() => expect(frame(view)).toContain('Revision'))
    expect(frame(view)).toContain('unknown (API rate limit exceeded)')
  })

  it('warns when a refresh finds the head changed since the view opened', async () => {
    loadEvidenceDetail.mockResolvedValueOnce(detail())
    const view = renderWithProviders(<EvidenceView pr={pr} repo="o/r" onClose={() => {}} />)
    await waitForExpectation(() => expect(frame(view)).toContain('Revision'))
    expect(frame(view)).not.toContain('head changed')
    const moved = detail({ head: { state: 'stale', inspected: 'head1aaaa', current: 'head2aaaa' } })
    loadEvidenceDetail.mockResolvedValueOnce(moved)
    await flush(20)
    await sendInput('r')
    await waitForExpectation(() => expect(frame(view)).toContain('head changed since you opened this'))
    expect(loadEvidenceDetail).toHaveBeenCalledTimes(2)
    expect(loadEvidenceDetail.mock.calls[1][2]).toMatchObject({ force: true, inspectedHead: 'head2aaaa' })
  })

  it('Esc closes when there is no return target', async () => {
    loadEvidenceDetail.mockResolvedValue(detail())
    const onClose = vi.fn()
    const view = renderWithProviders(<EvidenceView pr={pr} repo="o/r" onClose={onClose} />)
    await waitForExpectation(() => expect(frame(view)).toContain('Revision'))
    await flush(20)
    await sendInput('', { escape: true })
    await flush(20)
    expect(onClose).toHaveBeenCalled()
    expect(frame(view)).toContain('Esc close')
  })

  it('Esc hands the return target back so a queue can restore position and filter', async () => {
    loadEvidenceDetail.mockResolvedValue(detail())
    const onClose = vi.fn(); const onReturn = vi.fn()
    const target = returnTarget({ view: 'queue', position: 4, filter: 'ci_failing', key: 'o/r#5' })
    const view = renderWithProviders(<EvidenceView pr={pr} repo="o/r" onClose={onClose} returnTo={target} onReturn={onReturn} />)
    await waitForExpectation(() => expect(frame(view)).toContain('Revision'))
    await flush(20)
    expect(frame(view)).toContain('Esc back to queue')
    await sendInput('', { escape: true })
    await flush(20)
    expect(onReturn).toHaveBeenCalledWith(target)
    expect(onClose).not.toHaveBeenCalled()
  })

  it('opens the diff with d, and sends no write to GitHub', async () => {
    loadEvidenceDetail.mockResolvedValue(detail())
    const onOpenDiff = vi.fn()
    const view = renderWithProviders(<EvidenceView pr={pr} repo="o/r" onClose={() => {}} onOpenDiff={onOpenDiff} />)
    await waitForExpectation(() => expect(frame(view)).toContain('Revision'))
    await flush(20)
    await sendInput('d')
    await flush(20)
    expect(onOpenDiff).toHaveBeenCalledWith(pr)
    for (const key of ['a', 'm', 'x', 'X']) await sendInput(key)
    await flush(20)
    expect(loadEvidenceDetail).toHaveBeenCalledTimes(1)
  })

  it('shows a failure notice, not stale facts, when the record cannot be read', async () => {
    loadEvidenceDetail.mockRejectedValue(new Error('network down'))
    const view = renderWithProviders(<EvidenceView pr={pr} repo="o/r" onClose={() => {}} />)
    await waitForExpectation(() => expect(frame(view)).not.toContain('Reading the review evidence'))
    expect(frame(view)).not.toContain('Revision')
  })

  it('draws no control, escape or bidi character from GitHub text', async () => {
    const evil = `${ESC}]0;pwn${BEL}${ESC}[31m${String.fromCharCode(0x202e, 0x200b)}`
    const d = detail()
    d.record.untrusted = { title: `Title${evil}`, title_truncated: false, body: `Body${evil}`, body_truncated: false, threads: [{ path: `src/a${evil}.js`, author: `jin${evil}`, excerpt: `ok${evil}`, truncated: false }] }
    d.record.actor.login = `dev${evil}`
    d.files.value.items[0].path = `src/x${evil}.js`
    loadEvidenceDetail.mockResolvedValue(d)
    const view = renderWithProviders(<EvidenceView pr={pr} repo={`o/r`} onClose={() => {}} />)
    await waitForExpectation(() => expect(frame(view)).toContain('Revision'))
    await flush(20)
    for (let i = 0; i < 40; i++) await sendInput('j')
    await flush(20)
    const bad = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u202a-\\u202e\\u2066-\\u2069]')
    expect(bad.test(frame(view).replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), ''))).toBe(false)
  })
})
