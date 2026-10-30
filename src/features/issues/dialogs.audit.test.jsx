import React from 'react'
import { describe, expect, it, vi, afterEach } from 'vitest'
import { renderWithProviders, waitForExpectation, cleanup } from '../../test/test-helpers.jsx'
import { IssueLabelDialog } from './dialogs.jsx'

const { addLabels, removeLabels } = vi.hoisted(() => ({ addLabels: vi.fn(), removeLabels: vi.fn() }))

// A stale disk-cache entry (older label list, e.g. empty or missing newer labels) is served first.
vi.mock('../../cache.js', async (orig) => ({ ...await orig(), readCache: vi.fn(() => ({ payload: [] })), writeCache: vi.fn() }))
vi.mock('../../executor.js', async (orig) => ({
  ...await orig(),
  listLabels: async function listLabels() { await new Promise(r => setTimeout(r, 30)); return [{ name: 'bug', color: 'd73a4a' }, { name: 'infra', color: '5319e7' }] },
  addLabels, removeLabels,
}))

afterEach(cleanup)

describe('IssueLabelDialog with a stale cached label list', () => {
  it('shows labels already on the issue as checked once the fresh list arrives, and does not drop them on submit', async () => {
    const issue = { number: 88, labels: [{ name: 'bug' }] }
    const onClose = vi.fn()
    const view = renderWithProviders(<IssueLabelDialog repo="acme/audit-stale" issue={issue} onClose={onClose} />)
    await waitForExpectation(() => expect(view.lastFrame()).toContain('infra'))
    // bug is already applied to the issue, so it must render checked
    expect(view.lastFrame()).toMatch(/◉\s+●?\s*bug/)
    // submitting without touching anything must not remove the applied label
    view.stdin.write('\r')
    await waitForExpectation(() => expect(onClose).toHaveBeenCalled())
    expect(removeLabels).not.toHaveBeenCalled()
  })
})
