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

const run = { databaseId: 1, workflowName: 'Build &amp; Test', headBranch: 'feat&amp;x', status: 'completed', conclusion: 'success', createdAt: '2026-06-06T10:00:00Z' }

describe('actions names are sanitized', () => {
  it('decodes entities in the run row', async () => {
    useGh.mockReturnValue({ data: [run], loading: false, error: null, refetch: vi.fn() })
    const view = renderWithProviders(<ActionList repo="owner/repo" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Build & Test'))
    expect(view.lastFrame()).toContain('feat&x')
    expect(view.lastFrame()).not.toContain('&amp;')
  })

  it('decodes entities in the Cancel-run confirmation', async () => {
    useGh.mockReturnValue({ data: [run], loading: false, error: null, refetch: vi.fn() })
    const view = renderWithProviders(<ActionList repo="owner/repo" />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Build & Test'))
    await flush(20)
    await sendInput('X')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Cancel run'))
    expect(view.lastFrame()).toContain('Build & Test on feat&x')
    expect(view.lastFrame()).not.toContain('&amp;')
  })
})
