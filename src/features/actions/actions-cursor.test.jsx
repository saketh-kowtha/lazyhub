import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionList } from './index.jsx'
import { useGh } from '../../hooks/useGh.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('actions list cursor after the list shrinks', () => {
  it('keeps a valid selection when a refetch returns fewer runs', async () => {
    const mk = (id) => ({ databaseId: id, workflowName: `Workflow ${id}`, headBranch: 'main', status: 'completed', conclusion: 'success', createdAt: '2026-06-06T10:00:00Z' })
    useGh.mockImplementation(() => {
      const [data, setData] = React.useState([mk(1), mk(2)])
      return { data, loading: false, error: null, refetch: () => setData([mk(1)]) }
    })
    const view = renderWithProviders(<ActionList repo="owner/repo" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Workflow 2'))
    await flush(20)
    await sendInput('G')
    await sendInput('r')
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('Workflow 2'))
    await flush(20)
    await sendInput('X')
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/Cancel run.*Workflow 1/))
  })
})
