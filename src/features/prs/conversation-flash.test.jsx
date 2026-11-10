/**
 * FLASH = 0 for the conversation views, the issue detail and the custom pane (V4c, #597):
 * a forced revalidate, a manual refresh and a failure during a refresh never replace rows
 * that are on screen with a placeholder. Real query layer; only the gh calls are faked.
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PRComments } from './comments.jsx'
import { IssueDetail } from '../issues/detail.jsx'
import { CustomPane } from '../../components/CustomPane.jsx'
import { resetGhMemoryCache } from '../../hooks/useGh.js'
import { queryClient } from '../../data/queryClient.js'
import { listPRTimelinePage, getIssueHeader, listIssueTimelinePage } from '../../executor.js'
import { runConfiguredCommand } from '../../services/platform.js'
import { timelinePage } from '../../test/timeline.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
// useGh keys a query by the fetch function's name: give each fake its real name.
const { named } = vi.hoisted(() => ({ named: name => Object.defineProperty(vi.fn(), 'name', { value: name }) }))
vi.mock('../../executor.js', async (original) => ({
  ...await original(),
  listPRTimelinePage: named('listPRTimelinePage'), getIssueHeader: named('getIssueHeader'), listIssueTimelinePage: named('listIssueTimelinePage'),
}))
vi.mock('../../services/platform.js', () => ({
  openUrl: vi.fn(), copyToClipboard: vi.fn(), editTextInEditor: vi.fn(), runConfiguredCommand: vi.fn(),
}))

beforeEach(() => { resetGhMemoryCache() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
/** Frames after the first one that shows `marker` and no longer show it: each is a data -> placeholder flash. */
const flashes = (view, marker) => {
  const frames = view.frames.map(f => String(f))
  const first = frames.findIndex(f => f.includes(marker))
  return first < 0 ? -1 : frames.slice(first).filter(f => !f.includes(marker)).length
}

const convo = id => ({ id, kind: 'conversation', body: `Conv ${id}`, user: { login: `u${id}` }, createdAt: '2026-01-01T00:00:00Z' })
const issue = { body: 'd', number: 11, title: 'Issue title', state: 'OPEN', updatedAt: '2026-06-06T10:00:00Z', url: 'https://x/issues/11', author: { login: 'a' }, labels: [], assignees: [], milestone: null }
const icomment = n => ({
  key: `IC_${n}`, kind: 'comment', id: n, author: 'alice', authorAssociation: 'NONE', body: `icomment ${n}`, url: `https://x/c/${n}`,
  createdAt: '2026-06-06T10:00:00Z', lastEditedAt: null, isMinimized: false, minimizedReason: null,
  viewerCanUpdate: false, viewerCanDelete: false, reactions: [],
})
const ipage = { items: [icomment(1)], page: { total: 1, hasNextPage: false, endCursor: 'c', stalled: false }, viewer: 'me' }

describe('PR conversation keeps its rows (V4c)', () => {
  it('stays on the loaded comments through a manual refresh and a failing refresh', async () => {
    listPRTimelinePage.mockResolvedValueOnce(timelinePage([], [convo(1)]))
    const view = renderWithProviders(<PRComments prNumber={50} repo="o/r" onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Conv 1'))
    await flush(20)

    const slow = deferred()
    listPRTimelinePage.mockReturnValueOnce(slow.promise)
    await sendInput('r')
    await flush(30)
    expect(view.lastFrame()).toContain('Conv 1')
    expect(view.lastFrame()).not.toContain('Loading comments')
    expect(view.lastFrame()).toContain('⟳')
    slow.reject(new Error('boom'))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('refresh failed, showing loaded comments'))
    expect(view.lastFrame()).toContain('Conv 1')
    expect(flashes(view, 'Conv 1')).toBe(0)
  })

  it('revalidating in the background never blanks the rows', async () => {
    listPRTimelinePage.mockResolvedValueOnce(timelinePage([], [convo(1)]))
    const view = renderWithProviders(<PRComments prNumber={51} repo="o/r" onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Conv 1'))
    await flush(20)
    listPRTimelinePage.mockResolvedValueOnce(timelinePage([], [convo(1), convo(2)]))
    queryClient.invalidate([])
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Conv 2'))
    expect(flashes(view, 'Conv 1')).toBe(0)
  })

  it('draws no skeleton for a fast first load and one after the delay', async () => {
    const slow = deferred()
    listPRTimelinePage.mockReturnValueOnce(slow.promise)
    const view = renderWithProviders(<PRComments prNumber={52} repo="o/r" onBack={() => {}} />)
    await flush(30)
    expect(view.lastFrame()).not.toContain('Loading comments')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Loading comments'))
    slow.resolve(timelinePage([], [convo(1)]))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Conv 1'))
  })
})

describe('issue detail keeps its rows (V4c)', () => {
  it('a manual refresh and a failing refresh never replace the header or timeline', async () => {
    getIssueHeader.mockResolvedValueOnce(issue)
    listIssueTimelinePage.mockResolvedValueOnce(ipage)
    const view = renderWithProviders(<IssueDetail repo="o/r" issueNumber={11} onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('icomment 1'))
    await flush(20)

    const slowHeader = deferred()
    const slowPage = deferred()
    getIssueHeader.mockReturnValueOnce(slowHeader.promise)
    listIssueTimelinePage.mockReturnValueOnce(slowPage.promise)
    await sendInput('r')
    await flush(30)
    expect(view.lastFrame()).toContain('icomment 1')
    expect(view.lastFrame()).toContain('Issue title')
    expect(view.lastFrame()).not.toContain('Loading conversation')
    slowHeader.reject(new Error('boom'))
    slowPage.reject(new Error('boom'))
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Could not refresh'))
    expect(view.lastFrame()).toContain('icomment 1')
    expect(flashes(view, 'icomment 1')).toBe(0)
    expect(flashes(view, 'Issue title')).toBe(0)
  })
})

describe('custom pane keeps its rows (V4c)', () => {
  const paneDef = { label: 'Deploys', command: 'echo x' }
  const ok = items => ({ exitCode: 0, stdout: JSON.stringify(items), stderr: '' })

  it('r and a failing re-run keep the rows and show a one-line notice', async () => {
    runConfiguredCommand.mockResolvedValueOnce(ok([{ title: 'deploy-one', number: 1 }]))
    const view = renderWithProviders(<CustomPane paneDef={paneDef} repo="o/r" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('deploy-one'))
    await flush(20)

    const slow = deferred()
    runConfiguredCommand.mockReturnValueOnce(slow.promise)
    await sendInput('r')
    await flush(30)
    expect(view.lastFrame()).toContain('deploy-one')
    expect(view.lastFrame()).not.toContain('Loading Deploys')
    slow.resolve({ exitCode: 1, stdout: '', stderr: 'denied' })
    await waitForExpectation(() => expect(view.lastFrame()).toContain('refresh failed: denied'))
    expect(view.lastFrame()).toContain('deploy-one')
    expect(flashes(view, 'deploy-one')).toBe(0)
  })

  it('a failure with nothing to keep is the full error body', async () => {
    runConfiguredCommand.mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'nope' })
    const view = renderWithProviders(<CustomPane paneDef={{ ...paneDef, label: 'Other' }} repo="o/r" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Command failed'))
    expect(view.lastFrame()).toContain('nope')
  })

  it('an empty result is the empty state', async () => {
    runConfiguredCommand.mockResolvedValueOnce(ok([]))
    const view = renderWithProviders(<CustomPane paneDef={{ ...paneDef, label: 'Empty' }} repo="o/r" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('No items returned'))
  })
})

describe('no loading branches in the migrated bodies (V4c)', () => {
  it('the view files do not branch on a bare `loading`', async () => {
    const fs = await import('node:fs')
    for (const f of ['src/features/prs/comments.jsx', 'src/features/issues/detail.jsx', 'src/features/issues/detail-view.jsx', 'src/components/CustomPane.jsx']) {
      expect(fs.readFileSync(f, 'utf8'), f).not.toMatch(/\bloading\s*(\?|&&)|if \(\s*loading\b|!loading\b/)
    }
  })
})
