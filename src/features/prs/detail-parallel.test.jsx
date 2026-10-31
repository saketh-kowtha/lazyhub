import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRDetail } from './detail.jsx'
import { useGh } from '../../hooks/useGh.js'
import { getPR, getBranchProtection, getPRChecks } from '../../executor.js'
import { cleanup, renderWithProviders } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('PR detail starts its requests together (#452)', () => {
  it('asks for branch protection with the list-row base branch before getPR returns', () => {
    // getPR is still in flight: no data yet.
    useGh.mockImplementation(() => ({ data: null, loading: true, error: null, refetch: vi.fn(), mutate: vi.fn() }))
    renderWithProviders(<PRDetail prNumber={7} repo="o/r" baseRefName="release" onBack={() => {}} />)
    expect(useGh).toHaveBeenCalledWith(getPR, ['o/r', 7])
    expect(useGh).toHaveBeenCalledWith(getPRChecks, ['o/r', 7], expect.anything())
    expect(useGh).toHaveBeenCalledWith(getBranchProtection, ['o/r', 'release'], expect.anything())
  })

  it('still waits for getPR when the base branch is unknown', () => {
    useGh.mockImplementation(() => ({ data: null, loading: true, error: null, refetch: vi.fn(), mutate: vi.fn() }))
    renderWithProviders(<PRDetail prNumber={7} repo="o/r" onBack={() => {}} />)
    expect(useGh).toHaveBeenCalledWith(getBranchProtection, ['o/r', ''], expect.anything())
  })
})
