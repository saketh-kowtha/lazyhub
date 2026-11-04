// #465: [layout].preview_panel = false removes the PR detail popover from the real PR list.
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

const layout = vi.hoisted(() => ({ previewPanel: true }))
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../config.js', async (original) => {
  const actual = await original()
  return { ...actual, loadConfig: () => ({ ...actual.loadConfig(), layout: { ...actual.loadConfig().layout, previewPanel: layout.previewPanel } }) }
})

afterEach(cleanup)
beforeEach(() => vi.resetModules())

async function renderList(previewPanel) {
  layout.previewPanel = previewPanel
  const { useGh } = await import('../../hooks/useGh.js')
  const { listPRsPage } = await import('../../executor.js')
  const { PRList } = await import('./list.jsx')
  const pr = { number: 1, title: 'Popover subject', state: 'OPEN', updatedAt: new Date().toISOString(), author: { login: 'maria' }, body: 'body' }
  useGh.mockImplementation(fn => ({ data: fn === listPRsPage ? { items: [pr], hasNextPage: false, endCursor: null, totalCount: 1 } : {}, loading: false, refetch: vi.fn() }))
  return renderWithProviders(<PRList repo="o/r" listHeight={10} innerWidth={170} onSelectPR={() => {}} onOpenDiff={() => {}} />)
}

describe('[layout].preview_panel', () => {
  it('true: the focused row shows its detail popover', async () => {
    const view = await renderList(true)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('╭'))
  })

  it('false: the list renders but no popover appears', async () => {
    const view = await renderList(false)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Popover subject'))
    expect(view.lastFrame()).not.toContain('╭')
  })
})
