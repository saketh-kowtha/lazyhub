import React from 'react'
import { Box } from 'ink'
import { afterEach, expect, it, vi } from 'vitest'
import { execa } from 'execa'
import { useGh } from '../../hooks/useGh.js'
import { listBranches } from '../../executor.js'
import { cleanup, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'
import { BranchList } from './index.jsx'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
afterEach(cleanup)

it.each([[50, 15], [80, 24], [120, 40]])('keeps long branch rows to one terminal line at %ix%i (#495)', async (columns, rows) => {
  const name = `feature/${'long-branch-name-'.repeat(12)}`
  execa.mockResolvedValue({ stdout: name })
  useGh.mockImplementation(fn => ({
    data: fn === listBranches ? [{ name, protected: true }] : { heads: [name] },
    loading: false, error: null, refetch: vi.fn(),
  }))
  const view = renderWithProviders(<Box width={columns}><BranchList repo="o/r" listHeight={rows - 8} innerWidth={columns - 2} /></Box>)
  await waitForExpectation(() => expect(view.lastFrame()).toContain('feature/'))
  const lines = view.lastFrame().split('\n')
  expect(lines, view.lastFrame()).toHaveLength(1)
  expect(lines[0]).toContain('🔒')
  expect(lines[0]).toContain('PR')
  expect(lines[0].length).toBeLessThanOrEqual(columns)
})
