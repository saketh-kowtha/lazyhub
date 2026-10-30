import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRComments } from './comments.jsx'
import { useGh } from '../../hooks/useGh.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('PR comments cursor after the list shrinks', () => {
  it('keeps a valid selection when the filter hides the selected comment', async () => {
    const mk = (id, threadResolved) => ({ id, body: `Body ${id}`, path: 'a.js', line: id, user: { login: `user${id}` }, threadId: `T${id}`, threadResolved })
    useGh.mockImplementation(() => ({ data: [mk(1, false), mk(2, true)], loading: false, error: null, refetch: vi.fn() }))
    const view = renderWithProviders(<PRComments prNumber={5} repo="o/r" onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Body 2'))
    await flush(20)
    await sendInput('G')
    await sendInput('f')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('filter: open'))
    await flush(20)
    await sendInput('c')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Reply to @user1'))
  })
})
