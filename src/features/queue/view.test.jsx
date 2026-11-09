import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'
import { sendInput } from '../../test/input-bus.js'
import { openUrl } from '../../services/platform.js'
import { ReviewQueue, resetQueueSelection } from './view.jsx'
import { resetQueueMemory } from './useReviewQueue.js'
import { evidence, FETCHED_AT, queueResult, requestedUser, sampleItems } from './queue.fixtures.js'

vi.mock('ink', async () => ({
  ...await vi.importActual('ink'),
  useInput: (await import('../../test/input-bus.js')).mockUseInput(await import('react')),
}))
vi.mock('../../services/platform.js', async () => ({ ...await vi.importActual('../../services/platform.js'), openUrl: vi.fn(async () => true) }))

const frame = v => v.lastFrame() ?? ''
const line = (v, text) => frame(v).split('\n').find(l => l.includes(text)) || ''
const NOW = Date.parse(FETCHED_AT) + 120_000

function mount({ result = queueResult(sampleItems()), fetcher, width = 80, onOpen = vi.fn(), now = () => NOW } = {}) {
  const fetch = fetcher || vi.fn(async () => result)
  const view = renderWithProviders(<ReviewQueue onOpen={onOpen} innerWidth={width} listHeight={24} queueOptions={{ fetcher: fetch, now }} />)
  return { view, fetch, onOpen }
}
async function press(input, key = {}) { sendInput(input, key); await flush(20) }

beforeEach(() => { vi.clearAllMocks(); resetQueueMemory(); resetQueueSelection() })
afterEach(cleanup)

describe('ReviewQueue rows explain why', () => {
  it('opens on the first group with rows and every row carries its reason', async () => {
    const { view } = mount()
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    const f = frame(view)
    expect(f).toContain('Review queue')
    expect(f).toContain('account @octocat')
    expect(f).toContain('read-only')
    expect(f).toContain('[◔ Review 2]')
    expect(f).toContain('✗ CI 1')
    expect(line(view, 'Retry in webhook sender')).toContain('review requested of you')
    expect(line(view, 'New form lib')).toContain('via team @acme/core')
    // only the focused group is listed
    expect(f).not.toContain('Shard the worker queue')
  })

  it('the why strip names the reasons, head and CI of the focused row, and follows j/k', async () => {
    const { view } = mount()
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    expect(frame(view)).toMatch(/why\s+review requested of you · head 3fa91c2 · CI 2\/2 passed/)
    expect(line(view, 'Retry in webhook sender')).toContain('▶')
    await press('j')
    expect(line(view, 'New form lib')).toContain('▶')
    expect(frame(view)).toContain('GitHub does not say if it is you')
  })

  it('] and [ move between groups and each group lists only its own rows', async () => {
    const { view } = mount()
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    await press(']')
    expect(frame(view)).toContain('[✗ CI 1]')
    expect(line(view, 'Shard the worker queue')).toContain('1 of 2 checks failing')
    expect(frame(view)).not.toContain('Retry in webhook sender')
    await press('[')
    expect(frame(view)).toContain('Retry in webhook sender')
  })

  it('shows the status sidebar with counts at 120 columns and the CI column', async () => {
    const { view } = mount({ width: 120 })
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    const f = frame(view)
    expect(f).toContain('STATUS')
    expect(f).toMatch(/Needs my review\s+2/)
    expect(f).toMatch(/CI failing\s+1/)
    expect(f).toContain('total 7 loaded')
    expect(line(view, 'Retry in webhook sender')).toContain('✓ 2/2')
    expect(line(view, 'Retry in webhook sender')).toContain('acme/platform#412')
  })

  it('cleans hostile titles', async () => {
    const esc = String.fromCharCode(27)
    const item = evidence({ title: `evil${esc}]0;owned\u0007 title`, number: 77 }, { membership: ['review_requested'], })
    const { view } = mount({ result: queueResult([{ ...item, group: { group: 'waiting', because: 'awaiting_review' } }]) })
    await waitForExpectation(() => expect(frame(view)).toContain('title'))
    expect(frame(view)).not.toContain(esc)
    expect(frame(view)).not.toContain('\u0007')
  })
})

describe('ReviewQueue keys', () => {
  it('Enter hands the focused evidence record to onOpen (the evidence seam)', async () => {
    const { view, onOpen } = mount()
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    await press('j')
    await press('', { return: true })
    expect(onOpen).toHaveBeenCalledTimes(1)
    expect(onOpen.mock.calls[0][0].identity).toMatchObject({ repo: 'acme/ledger', number: 88 })
    expect(onOpen.mock.calls[0][0].attention[0].code).toBe('review_requested')
  })

  it('o opens the PR in the browser and does nothing on an empty group', async () => {
    const { view } = mount()
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    await press('o')
    expect(openUrl).toHaveBeenCalledWith('https://github.com/acme/web/pull/1')
    openUrl.mockClear()
    await press(']'); await press(']'); await press(']') // waiting
    await press(']') // ready
    await press(']') // unknown
    await press(']') // wraps to review
    expect(frame(view)).toContain('[◔ Review 2]')
  })

  it('r refetches the first page', async () => {
    const { view, fetch } = mount()
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    expect(fetch).toHaveBeenCalledTimes(1)
    await press('r')
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0].after).toEqual({})
  })

  it('keeps the selected group and row when the PR is opened and the queue is shown again', async () => {
    const first = mount({ now: () => NOW })
    await waitForExpectation(() => expect(frame(first.view)).toContain('Retry in webhook sender'))
    await flush(20)
    await press(']')
    await press('', { return: true })
    cleanup()
    const second = mount({ now: () => NOW })
    // the remembered rows are on screen in the first frame, with no second fetch while fresh
    expect(frame(second.view)).toContain('Shard the worker queue')
    expect(line(second.view, 'Shard the worker queue')).toContain('▶')
    expect(second.fetch).not.toHaveBeenCalled()
  })

  it('keeps the same PR selected when a refresh reorders the group', async () => {
    const older = evidence({ number: 1, title: 'Older', updatedAt: '2026-11-01T00:00:00Z' })
    const newer = evidence({ number: 2, title: 'Newer', updatedAt: '2026-11-05T00:00:00Z' })
    const { view, fetch } = mount({ result: queueResult([older, newer]) })
    await waitForExpectation(() => expect(frame(view)).toContain('Newer'))
    await flush(20)
    await press('j')
    expect(line(view, 'Older')).toContain('▶')
    const bumped = evidence({ number: 1, title: 'Older', updatedAt: '2026-11-08T00:00:00Z' })
    fetch.mockResolvedValue(queueResult([bumped, newer]))
    await press('r')
    expect(line(view, 'Older')).toContain('▶')
  })
})

describe('ReviewQueue completeness (D16)', () => {
  const truncated = () => queueResult(sampleItems().slice(0, 2), {
    truncation: { review_requested: { total: 91, has_more: true, next_cursor: 'RR1' }, authored: { total: 4, has_more: true, next_cursor: 'AU1' } },
  })

  it('says what is not loaded, and + loads the next pages with the cursors', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(truncated())
      .mockResolvedValueOnce(queueResult([evidence({ number: 500, title: 'Page two PR', reviewRequests: requestedUser('octocat') }, { membership: ['review_requested'] })]))
    const { view } = mount({ fetcher: fetch })
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    expect(frame(view)).toContain('not all loaded: review requests (91 in all), your PRs (4 in all) · + loads more')
    await press('+')
    await waitForExpectation(() => expect(frame(view)).toContain('Page two PR'))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls[1][0].after).toEqual({ reviewRequested: 'RR1', authored: 'AU1' })
    // page two said nothing more exists, so the notice is gone and + is a no-op
    expect(frame(view)).not.toContain('not all loaded')
    await press('+')
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('a search that is already complete keeps its truth when the other one pages', async () => {
    const first = queueResult(sampleItems().slice(0, 2), {
      truncation: { review_requested: { total: 2, has_more: false, next_cursor: null }, authored: { total: 99, has_more: true, next_cursor: 'AU1' } },
    })
    // the refetched page one of the finished search claims more, which must not overwrite what is known
    const second = queueResult([evidence({ number: 600, title: 'Authored page two' })], {
      truncation: { review_requested: { total: 2, has_more: true, next_cursor: 'RRX' }, authored: { total: 99, has_more: false, next_cursor: null } },
    })
    const fetch = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const { view } = mount({ fetcher: fetch })
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    await press('+')
    await flush(30)
    expect(fetch.mock.calls[1][0].after).toEqual({ authored: 'AU1' })
    expect(frame(view)).not.toContain('not all loaded')
  })
})

describe('ReviewQueue empty and failed states', () => {
  it('teaches what the queue is when nothing needs attention', async () => {
    const { view } = mount({ result: queueResult([]) })
    await waitForExpectation(() => expect(frame(view)).toContain('Nothing needs your attention here'))
    expect(frame(view)).toContain('No open pull request requests your review or was opened by you on github.com')
  })

  it('says a group is empty without hiding the others', async () => {
    const { view } = mount({ result: queueResult([evidence({ number: 3, title: 'Only waiting' })]) })
    await waitForExpectation(() => expect(frame(view)).toContain('Only waiting'))
    await flush(20)
    await press('[')
    expect(frame(view)).toContain('Nothing in "Changes requested" among the 1 loaded')
  })

  it('shows the cause and the fix when the first load fails', async () => {
    const err = Object.assign(new Error('gh: command not found'), { code: 'ENOENT' })
    const { view } = mount({ fetcher: vi.fn().mockRejectedValue(err) })
    await waitForExpectation(() => expect(frame(view)).toContain('GitHub CLI (gh) is not installed'))
  })

  it('keeps the rows and says the refresh failed when a later fetch fails', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(queueResult(sampleItems()))
    const { view } = mount({ fetcher: fetch })
    await waitForExpectation(() => expect(frame(view)).toContain('Retry in webhook sender'))
    await flush(20)
    fetch.mockRejectedValueOnce(Object.assign(new Error('gh: command not found'), { code: 'ENOENT' }))
    await press('r')
    await waitForExpectation(() => expect(frame(view)).toContain('refresh failed'))
    expect(frame(view)).toContain('Retry in webhook sender')
  })

  it('shows a loading line in the first frame', () => {
    const { view } = mount({ fetcher: vi.fn(() => new Promise(() => {})) })
    expect(frame(view)).toContain('Loading the review queue')
  })
})
