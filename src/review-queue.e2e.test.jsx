/**
 * review-queue.e2e.test.jsx -- the review queue inside the real App (#177).
 *
 * `g q` opens the queue from Focus, every row says why it is there, Enter opens the evidence view
 * evidence view (#127), Esc comes back to the queue with the group and
 * row kept, and q/Esc from the queue returns to the pane. The help overlay and footer list only
 * keys that work, and no write verb is advertised.
 */

import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Text } from 'ink'
import { sendInput } from './test/input-bus.js'
import { App } from './app.jsx'
import { useGh } from './hooks/useGh.js'
import * as executor from './executor.js'
import { disarmPrefix } from './config/keymap.js'
import { resetTabSelection } from './features/tabs/view.jsx'
import { resetQueueMemory } from './features/queue/useReviewQueue.js'
import { resetQueueSelection } from './features/queue/view.jsx'
import { queueResult, sampleItems } from './features/queue/queue.fixtures.js'
import { renderWithProviders, flush, cleanup, waitForExpectation } from './test/test-helpers.jsx'

const execaSpy = vi.hoisted(() => vi.fn(() => Object.assign(Promise.resolve({}), { stdin: { end: () => {} } })))

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return { ...actual, useApp: () => ({ exit: vi.fn() }), useInput: (await import('./test/input-bus.js')).mockUseInput(React) }
})
vi.mock('execa', () => ({ execa: execaSpy }))
vi.mock('./hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('./config.js', async () => {
  const actual = await vi.importActual('./config.js')
  const base = actual.loadConfig()
  return { ...actual, loadConfig: () => ({ ...base, panes: ['focus', 'prs', 'issues'], defaultPane: 'focus' }) }
})
vi.mock('./hooks/useLayout.js', () => ({
  useLayout: () => ({
    cols: 100, rows: 40, sidebarWidth: 18, previewWidth: 40, borderStyle: 'round',
    compactFooter: false, showSidebar: false, showPreview: false, listHeight: 30,
  }),
}))
vi.mock('./ipc.js', () => ({ emitIPC: () => {}, startIPC: () => '/tmp/lazyhub.sock' }))
vi.mock('./editor.js', () => ({ openInEditor: vi.fn(), editorLabel: 'Editor' }))
vi.mock('./ai/index.js', () => ({ AIError: class AIError extends Error {}, getAICodeReview: vi.fn() }))
vi.mock('./components/TabStrip.jsx', () => ({ TabStrip: () => <Text>TABS</Text> }))
vi.mock('./components/Toaster.jsx', () => ({ Toaster: () => null }))
vi.mock('./components/StatusBar.jsx', () => ({ StatusBar: () => null }))

vi.mock('./features/prs/diff.jsx', async () => {
  const { Text } = await import('ink')
  const { useInput } = await import('./hooks/useSafeInput.js')
  return { PRDiff: ({ prNumber, onBack }) => { useInput((_i, k) => { if (k.escape) onBack() }); return <Text>{`PR DIFF ${prNumber}`}</Text> } }
})

vi.mock('./executor.js', async () => {
  const actual = await vi.importActual('./executor.js')
  const fns = [
    'listPRs', 'listIssues', 'getPR', 'getIssue', 'getIssueHeader', 'listIssueTimelinePage', 'getRepoInfo', 'getPRChecks', 'getBranchProtection',
    'listLabels', 'listCollaborators', 'getCurrentBranch', 'listBranches', 'listRuns', 'fetchReviewQueueEvidence', 'loadEvidenceDetail', 'listPRFilesPage',
  ]
  return {
    ...Object.fromEntries(fns.map(name => [name, vi.fn()])), classifyGhFailure: () => ({ cause: 'x' }),
    evidenceRows: actual.evidenceRows, createEvidenceCache: actual.createEvidenceCache, returnTarget: actual.returnTarget,
  }
})

const fact = (value, source = 'github.graphql.x') => ({ value, source, fetched_at: '2026-11-09T12:00:00.000Z' })
function evidenceDetail(repo, number, title) {
  const required = fact({ required: 1, passing: 1, failing: 0, pending: 0, total: 1, truncated: false, head: 'head2aaaa', names: ['test'] }, 'github.graphql.isRequired')
  return {
    schema_version: 1,
    record: {
      identity: { host: 'github.com', repo, number, url: null, account: 'octocat' },
      context: { head: fact('head2aaaa'), base: fact('main') },
      facts: {
        state: fact('OPEN'), is_draft: fact(false), mergeable: fact('MERGEABLE'), review_decision: fact('APPROVED'),
        checks: fact({ state: 'SUCCESS', total: 1, passed: 1, failed: 0, pending: 0, truncated: false }),
        reviews: fact({ approvals: 1, staleApprovals: 0, changesRequested: 0, mine: 'NONE', truncated: false }),
        review_requests: fact({ via: 'direct', teams: [], truncated: false }),
        unresolved_threads: fact({ unresolved: 0, total: 0, truncated: false }),
        required_checks: required,
      },
      attention: [], actor: { login: 'dev', github_type: 'User', source: 's', attribution: 'unverified' },
      untrusted: { title, title_truncated: false, body: '', body_truncated: false, threads: [] },
      fetched_at: new Date().toISOString(),
    },
    files: fact({ items: [{ path: 'src/a.js', additions: 3, deletions: 1, change_type: 'MODIFIED', kind: 'source' }], total: 1, returned: 1, truncated: false, head: 'head2aaaa' }, 'github.graphql.files'),
    required_checks: required,
    head: { state: 'current', inspected: 'head2aaaa', current: 'head2aaaa' },
    errors: [], fetched_at: new Date().toISOString(),
  }
}

const detailPR = number => ({
  number, title: `PR ${number}`, state: 'OPEN', isDraft: false, updatedAt: '2026-06-06T10:00:00Z', url: `https://example.test/pull/${number}`,
  author: { login: 'alice' }, labels: [], assignees: [], reviews: [], reviewRequests: [], files: [], statusCheckRollup: [],
  baseRefName: 'main', headRefName: 'f', headRefOid: 'a'.repeat(40), mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', body: `body ${number}`,
})
const ghResult = data => ({ data, loading: false, error: null, refetch: vi.fn(), mutate: vi.fn(), isStale: false })
const key = (input, flags = {}) => ({ input, key: flags })
const ENTER = key('', { return: true })
const ESC = key('', { escape: true })
async function press(steps) {
  for (const step of steps) { await sendInput(step.input, step.key); await flush(15) }
}
const rowLine = (view, text) => view.lastFrame().split('\n').find(l => l.includes(text)) || ''

async function openQueue() {
  const view = renderWithProviders(<App repo="owner/repo" />)
  await waitForExpectation(() => expect(view.lastFrame()).toContain('Review requested'))
  await flush(30)
  await press([key('g'), key('q')])
  await waitForExpectation(() => expect(view.lastFrame()).toContain('Review queue'))
  await waitForExpectation(() => expect(view.lastFrame()).toContain('Retry in webhook sender'))
  await flush(30)
  return view
}

describe('review queue in the app (#177)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Stamp the read "now": the queue reuses rows younger than QUEUE_TTL_MS, so a fixed
    // fixture time made the reuse assertion fail once the wall clock passed it.
    executor.fetchReviewQueueEvidence.mockResolvedValue({ ...queueResult(sampleItems()), fetched_at: new Date().toISOString() })
    executor.loadEvidenceDetail.mockImplementation(async (repo, number) => evidenceDetail(repo, number, `PR ${number}`))
    useGh.mockImplementation((fn, deps = []) => {
      if (fn === executor.listPRs || fn === executor.listIssues) return ghResult([])
      if (fn === executor.getPR) return ghResult(detailPR(deps[1]))
      if (fn === executor.getRepoInfo) return ghResult({ squashMergeAllowed: true, viewerPermission: 'WRITE' })
      if (fn === executor.getPRChecks) return ghResult([])
      if (fn === executor.getBranchProtection) return ghResult({ requiredReviews: 1 })
      return ghResult(null)
    })
  })
  afterEach(() => { disarmPrefix(); resetTabSelection(); resetQueueMemory(); resetQueueSelection(); cleanup() })

  it('g q opens the queue and each row says why it is there', async () => {
    const view = await openQueue()
    expect(rowLine(view, 'Retry in webhook sender')).toContain('review requested of you')
    expect(rowLine(view, 'New form lib')).toContain('via team @acme/core')
    expect(view.lastFrame()).toMatch(/why\s+review requested of you/)
    expect(executor.fetchReviewQueueEvidence).toHaveBeenCalledTimes(1)
  })

  it('Enter opens the evidence view of that PR, Esc returns to the same group and row', async () => {
    const view = await openQueue()
    await press([key('j'), key(']'), ENTER])
    await waitForExpectation(() => expect(executor.loadEvidenceDetail).toHaveBeenCalled())
    expect(executor.loadEvidenceDetail.mock.calls[0].slice(0, 2)).toEqual(['acme/platform', 409])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('acme/platform#409'))
    expect(view.lastFrame()).toContain('read-only')
    expect(view.lastFrame()).toContain('back to queue')
    expect(useGh).not.toHaveBeenCalledWith(executor.getPR, expect.anything())
    await press([ESC])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Review queue'))
    expect(rowLine(view, 'Shard the worker queue')).toContain('▶')
    // coming back reuses the loaded rows instead of a second round trip
    expect(executor.fetchReviewQueueEvidence).toHaveBeenCalledTimes(1)
  })

  it('evidence -> diff -> Esc returns to the evidence view, then Esc to the queue', async () => {
    const view = await openQueue()
    await press([key('j'), key(']'), ENTER])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Revision'))
    await press([key('d')])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('PR DIFF 409'))
    await press([ESC])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('acme/platform#409'))
    expect(view.lastFrame()).not.toContain('PR DIFF')
    await press([ESC])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Review queue'))
    expect(rowLine(view, 'Shard the worker queue')).toContain('▶')
  })

  it('Enter in the evidence view reaches the full PR detail, Esc from there returns to the queue', async () => {
    const view = await openQueue()
    await press([key('j'), key(']'), ENTER])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Revision'))
    expect(view.lastFrame()).toContain('PR detail')
    await press([ENTER])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('body 409'))
    await press([ESC])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Review queue'))
    expect(rowLine(view, 'Shard the worker queue')).toContain('▶')
  })

  it('q returns to the pane the queue was opened from', async () => {
    const view = await openQueue()
    await press([key('q')])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Review requested'))
    expect(view.lastFrame()).not.toContain('Review queue')
  })

  it('the footer and ? help list the queue keys, g q, and no write verb', async () => {
    const view = await openQueue()
    const footer = view.lastFrame()
    expect(footer).toMatch(/Enter\s+open/)
    expect(footer).toMatch(/o\s+browser/)
    expect(footer).toMatch(/\]\s+group/)
    expect(footer).toMatch(/\+\s+more/)
    await press([key('?')])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Keyboard Reference'))
    const help = view.lastFrame()
    expect(help).toContain('Next status')
    expect(help).toContain('Open the selected')
    expect(help).toContain('Load the next page')
    expect(help).toContain('Keyboard Reference — Queue view')
    expect(help).not.toContain('Approve')
    expect(help).not.toContain('Merge')
    expect(help).not.toMatch(/Search|Filter/)
  })
})
