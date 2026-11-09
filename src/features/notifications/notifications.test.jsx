import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationList } from './index.jsx'
import { useGh } from '../../hooks/useGh.js'
import { markNotificationRead } from '../../executor.js'
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

describe('notification list paging notices (#440)', () => {
  const mk = (id) => ({ id, unread: true, reason: 'mention', updatedAt: '2026-06-06T10:00:00Z', repository: { name: 'repo' }, subject: { title: `Thread ${id}`, type: 'Issue' } })

  it('says so when the page ceiling cut the list off', async () => {
    useGh.mockReturnValue({ data: Object.assign([mk('1')], { truncated: true }), loading: false, error: null, refetch: vi.fn() })
    const view = renderWithProviders(<NotificationList repo="owner/repo" onNavigateTo={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('older notifications are not loaded'))
  })

  it('keeps the rows and names the retry key when a later page failed', async () => {
    useGh.mockReturnValue({ data: Object.assign([mk('1')], { partialError: 'HTTP 502' }), loading: false, error: null, refetch: vi.fn() })
    const view = renderWithProviders(<NotificationList repo="owner/repo" onNavigateTo={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Thread 1'))
    expect(view.lastFrame()).toMatch(/a later page failed \(HTTP 502\).*retry/)
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

describe('notification mark-read write (#453)', () => {
  it('shows a pending status and ignores a second mark-read while one is in flight', async () => {
    let release
    markNotificationRead.mockReturnValue(new Promise(r => { release = r }))
    const n = { id: '1', unread: true, reason: 'mention', updatedAt: '2026-06-06T10:00:00Z', repository: { name: 'repo' }, subject: { title: 'Thread 1', type: 'Issue' } }
    useGh.mockReturnValue({ data: [n], loading: false, error: null, refetch: vi.fn() })
    const view = renderWithProviders(<NotificationList repo="owner/repo" onNavigateTo={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Thread 1'))
    await flush(20)
    await sendInput('u')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Marking as read'))
    await sendInput('u')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('still in progress'))
    expect(markNotificationRead).toHaveBeenCalledTimes(1)
    release()
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Marked as read'))
  })

  it('shows a failure status and does not refetch when the write fails', async () => {
    markNotificationRead.mockReturnValue(Promise.reject(new Error('HTTP 403')))
    const refetch = vi.fn()
    const n = { id: '1', unread: true, reason: 'mention', updatedAt: '2026-06-06T10:00:00Z', repository: { name: 'repo' }, subject: { title: 'Thread 1', type: 'Issue' } }
    useGh.mockReturnValue({ data: [n], loading: false, error: null, refetch })
    const view = renderWithProviders(<NotificationList repo="owner/repo" onNavigateTo={() => {}} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Thread 1'))
    await flush(20)
    await sendInput('u')
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Failed: HTTP 403'))
    expect(refetch).not.toHaveBeenCalled()
  })
})

describe('notification list selection memory (R8)', () => {
  it('keeps the cursor on the same thread when a refetch reorders the list', async () => {
    const mk = (id) => ({ id, unread: true, reason: 'mention', updatedAt: '2026-06-06T10:00:00Z', repository: { name: 'repo' }, subject: { title: `Thread ${id}`, type: 'Issue' } })
    useGh.mockImplementation(() => {
      const [data, setData] = React.useState([mk('1'), mk('2'), mk('3')])
      return { data, loading: false, error: null, refetch: () => setData([mk('3'), mk('2'), mk('1')]) }
    })
    const onNavigateTo = vi.fn()
    const view = renderWithProviders(<NotificationList repo="owner/repo" onNavigateTo={onNavigateTo} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('Thread 3'))
    await flush(20)
    await sendInput('j')
    await sendInput('r')
    await flush(40)
    await sendInput('', { return: true })
    expect(onNavigateTo).toHaveBeenCalledWith(expect.objectContaining({ id: '2' }))
  })
})
