import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationList } from './index.jsx'
import { useGh } from '../../hooks/useGh.js'
import { sendInput } from '../../test/input-bus.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('../../executor.js', async () => ({ ...await vi.importActual('../../executor.js'), markNotificationRead: vi.fn(() => Promise.resolve()) }))

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('notification list failures', () => {
  it('shows the failure and a retry hint instead of "No notifications" when the fetch fails', async () => {
    const err = Object.assign(new Error('gh: HTTP 401: Bad credentials'), { stderr: 'HTTP 401: Bad credentials' })
    useGh.mockReturnValue({ data: null, loading: false, error: err, refetch: vi.fn() })
    const view = renderWithProviders(<NotificationList repo="owner/repo" onNavigateTo={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toMatch(/retry/i))
    expect(view.lastFrame()).not.toContain('No notifications')
  })
})

describe('notification list cursor after the list shrinks', () => {
  it('keeps a valid selection when a refetch returns fewer notifications', async () => {
    const mk = (id) => ({ id, unread: true, reason: 'mention', updatedAt: '2026-06-06T10:00:00Z', repository: { name: 'repo' }, subject: { title: `Thread ${id}`, type: 'Issue' } })
    useGh.mockImplementation(() => {
      const [data, setData] = React.useState([mk('1'), mk('2')])
      return { data, loading: false, error: null, refetch: () => setData([mk('1')]) }
    })
    const onNavigateTo = vi.fn()
    const view = renderWithProviders(<NotificationList repo="owner/repo" onNavigateTo={onNavigateTo} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Thread 2'))
    await flush(20)
    await sendInput('G')
    await sendInput('r')
    await waitForExpectation(() => expect(view.lastFrame()).not.toContain('Thread 2'))
    await flush(20)
    await sendInput('', { return: true })
    expect(onNavigateTo).toHaveBeenCalledWith(expect.objectContaining({ id: '1' }))
  })
})
