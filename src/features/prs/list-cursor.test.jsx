import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRList } from './list.jsx'
import { useGh } from '../../hooks/useGh.js'
import { listPRs } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('PR list cursor after the list shrinks', () => {
  it('keeps a valid selection when a refetch returns fewer PRs', async () => {
    const mk = (number) => ({ number, title: `PR number ${number}`, state: 'OPEN', updatedAt: '2026-06-06T10:00:00Z', headRefName: `b${number}` })
    useGh.mockImplementation(fn => {
      const [data, setData] = React.useState(fn === listPRs ? [mk(1), mk(2)] : {})
      return { data, loading: false, error: null, refetch: () => setData(fn === listPRs ? [mk(1)] : {}) }
    })
    const onSelectPR = vi.fn()
    const view = renderWithProviders(<PRList repo="o/r" listHeight={10} innerWidth={80} onSelectPR={onSelectPR} onOpenDiff={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('PR number 1'))
    await flush(20)
    await sendInput('G')
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/▎● #2 +PR number 2/))
    await sendInput('r')
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('PR number 2'))
    await flush(20)
    await sendInput('', { return: true })
    expect(onSelectPR).toHaveBeenCalledWith(expect.objectContaining({ number: 1 }))
  })
})
