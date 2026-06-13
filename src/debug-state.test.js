import { describe, expect, it } from 'vitest'
import { collectDebugState } from './debug-state.js'

describe('collectDebugState', () => {
  it('captures app shape and redacts secret-shaped values', () => {
    const state = collectDebugState({
      activePane: 'prs',
      view: 'list',
      itemNumber: 42,
      filters: { state: 'open' },
      cursors: { selectedIndex: 2 },
      dialog: 'merge',
      mode: 'NORMAL',
      recentStatus: [{ message: 'wrote ghp_abcdefghijklmnopqrstuvwxyz1234567890', variant: 'info' }],
      authToken: 'ghp_abcdefghijklmnopqrstuvwxyz1234567890',
    })

    expect(state.app).toMatchObject({
      activePane: 'prs',
      view: 'list',
      itemNumber: 42,
      filters: { state: 'open' },
      cursors: { selectedIndex: 2 },
      dialog: 'merge',
    })
    const json = JSON.stringify(state)
    expect(json).not.toMatch(/ghp_[A-Za-z0-9_]+/)
    expect(json).not.toMatch(/authToken/)
  })
})
