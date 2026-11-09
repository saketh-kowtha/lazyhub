/**
 * review-queue.e2e.test.jsx -- the review queue inside the real App (#177).
 *
 * `g q` opens the queue from Focus, every row says why it is there, Enter opens the existing PR
 * detail (the seam the evidence view will replace), Esc comes back to the queue with the group and
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

vi.mock('./executor.js', () => {
  const fns = [
    'listPRs', 'listIssues', 'getPR', 'getIssue', 'getIssueHeader', 'listIssueTimelinePage', 'getRepoInfo', 'getPRChecks', 'getBranchProtection',
    'listLabels', 'listCollaborators', 'getCurrentBranch', 'listBranches', 'listRuns', 'fetchReviewQueueEvidence',
  ]
  return { ...Object.fromEntries(fns.map(name => [name, vi.fn()])), classifyGhFailure: () => ({ cause: 'x' }) }
})

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
    executor.fetchReviewQueueEvidence.mockResolvedValue(queueResult(sampleItems()))
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

  it('Enter opens the existing PR detail of that repository, Esc returns with the row kept', async () => {
    const view = await openQueue()
    await press([key('j'), key(']'), ENTER])
    await waitForExpectation(() => expect(useGh).toHaveBeenCalledWith(executor.getPR, ['acme/platform', 409]))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('body 409'))
    await press([ESC])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Review queue'))
    expect(view.lastFrame()).toContain('Shard the worker queue')
    expect(rowLine(view, 'Shard the worker queue')).toContain('▶')
    // coming back reuses the loaded rows instead of a second round trip
    expect(executor.fetchReviewQueueEvidence).toHaveBeenCalledTimes(1)
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
