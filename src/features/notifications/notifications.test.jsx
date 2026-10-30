import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NotificationList } from './index.jsx'
import { useGh } from '../../hooks/useGh.js'
import { cleanup, renderWithProviders, waitForExpectation } from '../../test/test-helpers.jsx'

vi.mock('ink', async () => {
  const React = await import('react')
  return { ...await vi.importActual('ink'), useInput: (await import('../../test/input-bus.js')).mockUseInput(React) }
})
vi.mock('../../hooks/useGh.js', () => ({ useGh: vi.fn() }))

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
