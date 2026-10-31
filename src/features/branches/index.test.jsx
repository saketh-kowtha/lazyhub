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
    if (args[0] === 'remote') return { stdout: 'origin\thttps://github.com/o/r.git (fetch)' }
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

it('shows the failure and a retry hint instead of "No branches found" when the fetch fails', async () => {
  const err = Object.assign(new Error('gh: HTTP 401: Bad credentials'), { stderr: 'HTTP 401: Bad credentials' })
  useGh.mockImplementation(() => ({ data: null, loading: false, error: err, refetch: vi.fn() }))
  const view = renderWithProviders(<BranchList repo="o/r" listHeight={10} />)
  await waitForExpectation(() => expect(view.lastFrame()).toMatch(/retry/i))
  expect(view.lastFrame()).not.toContain('No branches found')
})

it('keeps a valid selection when a refetch returns fewer branches', async () => {
  useGh.mockImplementation(fn => {
    const [data, setData] = React.useState(fn === listBranches ? [{ name: 'main' }, { name: 'dev' }] : [])
    return { data, loading: false, refetch: () => setData(fn === listBranches ? [{ name: 'main' }] : []) }
  })
  const view = renderWithProviders(<BranchList repo="o/r" listHeight={10} />)
  await waitForInputReady(view)
  view.stdin.write('G')
  await waitForExpectation(() => expect(view.lastFrame()).toMatch(/▶ dev/))
  await waitForInputReady(view)
  view.stdin.write('r')
  await waitForExpectation(() => expect(view.lastFrame()).not.toContain('dev'))
  await waitForExpectation(() => expect(view.lastFrame()).toMatch(/▶ (► )?main/))
})

it('does not run local git when the launch directory is not a clone of the viewed repo (#471)', async () => {
  execa.mockImplementation(async (_cmd, args) => {
    if (args[0] === 'remote') return { stdout: 'origin\tgit@github.com:someone/else.git (fetch)' }
    return { stdout: 'main' }
  })
  const view = renderWithProviders(<BranchList repo="o/r" listHeight={10} />)
  await waitForInputReady(view)
  await waitForExpectation(() => expect(execa).toHaveBeenCalledWith('git', ['remote', '-v'], expect.anything()))
  await new Promise(r => setTimeout(r, 30))
  await waitForInputReady(view)
  view.stdin.write('\r')
  await waitForExpectation(() => expect(view.lastFrame()).toContain('No local checkout of o/r'))
  expect(view.lastFrame()).not.toContain('Checkout branch')
  expect(execa.mock.calls.filter(([, args]) => args[0] !== 'remote')).toEqual([])
})

it('runs local commands only in the matching checkout (#471)', async () => {
  const view = renderWithProviders(<BranchList repo="o/r" listHeight={10} />)
  await waitForInputReady(view)
  await waitForExpectation(() => expect(view.lastFrame()).toMatch(/► main/))
  for (const [cmd, , opts] of execa.mock.calls) {
    expect(cmd).toBe('git')
    expect(opts.cwd).toBe(process.cwd())
  }
})
