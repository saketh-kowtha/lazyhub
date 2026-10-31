import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ActionList } from './index.jsx'
import { useGh } from '../../hooks/useGh.js'
import { cancelRun } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../executor.js', async () => ({
  ...await vi.importActual('../../executor.js'),
  cancelRun: vi.fn(), rerunRun: vi.fn(),
}))

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('actions write pending state (#453)', () => {
  it('shows a pending status for cancel and ignores a second submit while it runs', async () => {
    let release
    cancelRun.mockReturnValue(new Promise(r => { release = r }))
    const run = { databaseId: 1, workflowName: 'Workflow 1', headBranch: 'main', status: 'in_progress', conclusion: null, createdAt: '2026-06-06T10:00:00Z' }
    useGh.mockReturnValue({ data: [run], loading: false, error: null, refetch: vi.fn() })
    const view = renderWithProviders(<ActionList repo="owner/repo" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Workflow 1'))
    await flush(20)
    await sendInput('X')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Cancel run'))
    await sendInput('y')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Cancelling'))
    await flush(20)
    await sendInput('X')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Cancel run'))
    await sendInput('y')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('still in progress'))
    expect(cancelRun).toHaveBeenCalledTimes(1)
    release()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Run cancelled'))
  })
})
