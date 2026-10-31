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

const EVIL = 'feat/\u001b[2Jwipe'

beforeEach(() => {
  vi.clearAllMocks()
  useGh.mockImplementation(fn => ({
    data: fn === listBranches ? [{ name: EVIL }] : [],
    loading: false, refetch: vi.fn(),
  }))
  execa.mockImplementation(async (_cmd, args) => (
    args[0] === 'remote' ? { stdout: 'origin\tgit@github.com:o/r.git (fetch)' } : { stdout: 'main' }
  ))
})

it('strips terminal escapes from branch names in rows and the checkout dialog', async () => {
  const view = renderWithProviders(<BranchList repo="o/r" listHeight={10} />)
  await waitForInputReady(view)
  await waitForExpectation(() => expect(view.lastFrame()).toContain('feat/'))
  expect(view.lastFrame()).toContain('feat/wipe')
  view.stdin.write('\r')
  await waitForExpectation(() => expect(view.lastFrame()).toContain('Checkout branch'))
  expect(view.lastFrame()).toContain('feat/wipe')
})
