import React from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { cleanup } from 'ink-testing-library'
import { execa } from 'execa'
import { renderWithProviders, waitForInputReady, waitForExpectation } from '../../test/test-helpers.jsx'
import { useGh } from '../../hooks/useGh.js'
import { listBranches } from '../../executor.js'
import { BranchList } from './index.jsx'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))

afterEach(cleanup)

let head
beforeEach(() => {
  vi.clearAllMocks()
  head = 'main'
  useGh.mockImplementation(fn => ({
    data: fn === listBranches ? [{ name: 'main' }, { name: 'dev' }] : [],
    loading: false, refetch: vi.fn(),
  }))
  execa.mockImplementation(async (_cmd, args) => {
    if (args[0] === 'checkout') head = args[1]
    return { stdout: head }
  })
})

it('moves the current-branch marker after a checkout', async () => {
  const view = renderWithProviders(<BranchList repo="o/r" listHeight={10} />)
  await waitForInputReady(view)
  await waitForExpectation(() => expect(view.lastFrame()).toMatch(/► main/))
  view.stdin.write('j')
  await waitForExpectation(() => expect(view.lastFrame()).toMatch(/▶ dev/))
  await waitForInputReady(view)
  view.stdin.write('\r')
  await waitForExpectation(() => expect(view.lastFrame()).toContain('Checkout branch "dev"'))
  await waitForInputReady(view)
  view.stdin.write('y')
  await waitForExpectation(() => expect(view.lastFrame()).toContain('✓ Checked out dev'))
  await waitForExpectation(() => expect(view.lastFrame()).toMatch(/► dev/))
  expect(view.lastFrame()).not.toMatch(/► main/)
})
