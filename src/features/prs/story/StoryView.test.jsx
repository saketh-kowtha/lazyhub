import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGh } from '../../../hooks/useGh.js'
import { listPRFilesPage, getReviewDelta } from '../../../executor.js'
import { sendInput } from '../../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../../test/test-helpers.jsx'
import { StoryView, sinceLine } from './StoryView.jsx'

vi.mock('ink', async () => ({
  ...await vi.importActual('ink'),
  useInput: (await import('../../../test/input-bus.js')).mockUseInput(await import('react')),
}))
vi.mock('../../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../../executor.js', () => ({ listPRFilesPage: vi.fn(), getReviewDelta: vi.fn() }))

const file = (path, additions = 5, deletions = 1) => ({ path, additions, deletions, changeType: 'MODIFIED' })
const FILES = [
  file('src/core.js', 80, 4), file('src/caller.js', 2, 1), file('package.json'), file('src/core.test.js', 30, 0),
  file('package-lock.json', 400, 300), file('dist/bundle.js', 9, 9),
]
const page = (files, over = {}) => ({ files, hasNextPage: false, endCursor: null, totalCount: files.length, ...over })

let delta
let firstPage
function mount(props = {}) {
  const onBack = vi.fn()
  const onOpenFile = vi.fn()
  const view = renderWithProviders(<StoryView repo="o/r" prNumber={7} onBack={onBack} onOpenFile={onOpenFile} {...props} />)
  return { view, onBack, onOpenFile }
}

beforeEach(() => {
  vi.clearAllMocks()
  listPRFilesPage.mockReset()
  delta = { status: 'none', reason: 'You have not submitted a review on this PR yet.', paths: [] }
  firstPage = page(FILES)
  useGh.mockImplementation(fn => ({
    data: fn === listPRFilesPage ? firstPage : fn === getReviewDelta ? delta : null,
    loading: false, error: null, refetch: vi.fn(),
  }))
})
afterEach(cleanup)

describe('StoryView (#362)', () => {
  it('lists the steps in order with a reason, and fits 80x24', async () => {
    const { view } = mount()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Review story #7'))
    const frame = view.lastFrame()
    const order = ['Core change', 'Call sites and usage', 'Config and docs', 'Tests', 'Noise'].map(s => frame.indexOf(s))
    expect(order.every(i => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(frame).toContain('Why: Start here')
    expect(frame).toContain('src/core.js')
    expect(frame).toContain('6 files in 5 steps')
    expect(frame.split('\n').length).toBeLessThanOrEqual(24)
  })

  it('n and p move between steps; the noise step is collapsed but counted, Space expands it', async () => {
    const { view } = mount()
    await flush(20)
    for (let i = 0; i < 4; i++) await sendInput('n')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('2 files collapsed'))
    expect(view.lastFrame()).toContain('lockfile')
    expect(view.lastFrame()).not.toContain('package-lock.json  ')
    await sendInput(' ')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('package-lock.json'))
    await sendInput('p')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('test code or test data'))
  })

  it('Enter opens the diff at the selected file with the position to return to', async () => {
    const { onOpenFile } = mount()
    await flush(20)
    await sendInput('n')
    await sendInput('', { return: true })
    await waitForExpectation(() => expect(onOpenFile).toHaveBeenCalledWith('src/caller.js', { step: 1, cursor: 0 }))
  })

  it('restores the position it was given and goes back on Esc', async () => {
    const { view, onBack } = mount({ initial: { step: 2, cursor: 0 } })
    await flush(20)
    expect(view.lastFrame()).toContain('> 3. Config and docs')
    await sendInput('', { escape: true })
    await waitForExpectation(() => expect(onBack).toHaveBeenCalled())
  })

  it('marks files changed since the last review and counts them', async () => {
    delta = { status: 'files', reason: 'x', paths: ['src/core.js', 'gone.js'], submittedAt: '2026-11-01T00:00:00Z', capped: false, approximate: false }
    const { view } = mount()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('1 file changed, 1 no longer in this PR'))
    expect(view.lastFrame()).toContain('[1 since review]')
    expect(view.lastFrame()).toContain('[since review]')
  })

  it('says unknown, with the reason, when the last review cannot be compared', async () => {
    delta = { status: 'unknown', reason: 'Your reviewed commit is no longer reachable (likely a force-push).', paths: [] }
    const { view } = mount()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Since your last review: unknown'))
    expect(view.lastFrame()).toContain('force-push')
  })

  it('walks every page of a large PR and shows progress until it is complete', async () => {
    const many = Array.from({ length: 250 }, (_, i) => file(`src/m${i}.js`, 20, 0))
    firstPage = page(many.slice(0, 100), { hasNextPage: true, endCursor: 'c1', totalCount: 250 })
    let release
    listPRFilesPage.mockImplementationOnce(() => new Promise(r => { release = () => r(page(many.slice(100, 200), { hasNextPage: true, endCursor: 'c2', totalCount: 250 })) }))
    listPRFilesPage.mockImplementationOnce(async () => page(many.slice(200), { totalCount: 250 }))
    const { view } = mount()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Loading file list: 100 of 250'))
    await waitForExpectation(() => expect(release).toBeTypeOf('function'))
    release()
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/story #7  250 files in/))
    expect(view.lastFrame()).not.toContain('Loading file list')
    expect(listPRFilesPage).toHaveBeenCalledTimes(2)
  })

  it('keeps showing the files it has and says so when a later page fails', async () => {
    firstPage = page(FILES, { hasNextPage: true, endCursor: 'c1', totalCount: 9 })
    listPRFilesPage.mockRejectedValueOnce(new Error('boom'))
    const { view } = mount()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('File list incomplete: 6 of 9'))
  })
})

describe('sinceLine', () => {
  it('covers every state', () => {
    expect(sinceLine({ delta: null, deltaLoading: true }).text).toContain('checking')
    expect(sinceLine({ delta: null, deltaError: new Error('x') }).text).toContain('unknown')
    expect(sinceLine({ delta: { status: 'same' } }).text).toContain('no new commits')
    expect(sinceLine({ delta: { status: 'files', capped: true, approximate: true }, sinceCount: 2, sinceOutside: 0 }).text).toMatch(/at most 300.*File-level/)
  })
})
