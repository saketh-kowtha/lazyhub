import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { renderWithProviders, waitForInputReady, waitForExpectation } from '../../test/test-helpers.jsx'
import { useGh } from '../../hooks/useGh.js'
import { listPRs, checkoutBranch } from '../../executor.js'
import { firstActionKey } from '../../config/actions.js'
import { PRList } from './list.jsx'

vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../executor.js', async (original) => ({ ...await original(), checkoutBranch: vi.fn() }))

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

it('sanitizes the checkout branch in confirmation and success text while preserving the request', async () => {
  const pr = { number: 1, title: 'PR', state: 'OPEN', headRefName: 'safe&amp;branch' }
  useGh.mockImplementation(fn => ({ data: fn === listPRs ? [pr] : {}, loading: false, refetch: vi.fn() }))
  checkoutBranch.mockResolvedValue(undefined)
  const view = renderWithProviders(<PRList repo="o/r" listHeight={10} innerWidth={80} onSelectPR={() => {}} onOpenDiff={() => {}} />)
  await waitForInputReady(view)
  view.stdin.write(firstActionKey('pr.checkout', 'c'))
  await waitForExpectation(() => expect(view.lastFrame()).toContain('Checkout branch "safe&branch"'))
  await waitForInputReady(view)
  view.stdin.write('y')
  await waitForExpectation(() => expect(checkoutBranch).toHaveBeenCalledWith('o/r', 1))
  await waitForExpectation(() => expect(view.lastFrame()).toContain('✓ Checked out safe&branch'))
})

it('reports the focused PR for palette actions and clears it for an empty list', async () => {
  const prs = [
    { number: 7, title: 'First', state: 'OPEN' },
    { number: 9, title: 'Second', state: 'OPEN' },
  ]
  let items = prs
  const onPaneState = vi.fn()
  useGh.mockImplementation(fn => ({ data: fn === listPRs ? items : {}, loading: false, refetch: vi.fn() }))
  const element = <PRList repo="o/r" listHeight={10} innerWidth={80} onPaneState={onPaneState} />
  const view = renderWithProviders(element)
  await waitForExpectation(() => expect(onPaneState).toHaveBeenCalledWith({ selectedPR: prs[0] }))
  await waitForInputReady(view)
  view.stdin.write('j')
  await waitForExpectation(() => expect(onPaneState).toHaveBeenCalledWith({ selectedPR: prs[1] }))
  items = []
  view.rerender(element)
  await waitForExpectation(() => expect(onPaneState).toHaveBeenCalledWith({ selectedPR: null }))
})
