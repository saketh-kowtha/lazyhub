import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PRComments } from './comments.jsx'
import { useGh } from '../../hooks/useGh.js'
import { resolveThread } from '../../executor.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../executor.js', async (original) => ({ ...await original(), resolveThread: vi.fn() }))

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks() })

describe('PR comments pending status (#453)', () => {
  it('keeps "Resolving thread…" visible until the write settles, past the 3 s flash timeout', async () => {
    let release
    resolveThread.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const comment = { id: 1, body: 'Body 1', path: 'a.js', line: 1, user: { login: 'user1' }, threadId: 'T1', threadResolved: false }
    useGh.mockImplementation(() => ({ data: [comment], loading: false, error: null, refetch: vi.fn() }))
    const view = renderWithProviders(<PRComments prNumber={5} repo="o/r" onBack={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Body 1'))
    await flush(20)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    await sendInput('z')
    await vi.advanceTimersByTimeAsync(50)
    expect(view.lastFrame()).toContain('Resolving thread')
    await vi.advanceTimersByTimeAsync(3500)
    expect(view.lastFrame()).toContain('Resolving thread')
    release()
    await vi.advanceTimersByTimeAsync(50)
    expect(view.lastFrame()).toContain('Thread resolved')
  })
})
