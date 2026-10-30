import { describe, it, expect } from 'vitest'
import { computeLayout, MIN_COLS, MIN_ROWS } from './useLayout.js'

const at = (columns, rows, cfg = {}) => computeLayout({ columns, rows }, cfg)

describe('computeLayout breakpoints', () => {
  it('wide (>= 110): sidebar and preview', () => {
    const l = at(120, 40, { sidebarWidth: 24, previewPanel: true, previewWidth: 40 })
    expect(l.mode).toBe('wide')
    expect(l.showSidebar).toBe(true)
    expect(l.sidebarWidth).toBe(24)
    expect(l.showPreview).toBe(true)
  })

  it('medium (80-109): sidebar, preview collapsed', () => {
    for (const cols of [80, 81, 100, 109]) {
      const l = at(cols, 30, { sidebarWidth: 24, previewPanel: true, previewWidth: 40 })
      expect(l.mode).toBe('medium')
      expect(l.showSidebar).toBe(true)
      expect(l.showPreview).toBe(false)
    }
  })

  it('narrow (< 80): no sidebar, tab strip row reserved', () => {
    const l = at(79, 24, { sidebarWidth: 24 })
    expect(l.mode).toBe('narrow')
    expect(l.showSidebar).toBe(false)
    expect(l.sidebarWidth).toBe(0)
    expect(l.listHeight).toBe(at(120, 24).listHeight - 1)
  })

  it('too small: below the minimum in either dimension', () => {
    expect(at(MIN_COLS - 1, 30).tooSmall).toBe(true)
    expect(at(120, MIN_ROWS - 1).tooSmall).toBe(true)
    expect(at(MIN_COLS, MIN_ROWS).tooSmall).toBe(false)
    expect(at(MIN_COLS - 1, 30).showSidebar).toBe(false)
  })

  it('config is a preference: a wide sidebar preference is clamped to leave room', () => {
    const l = at(80, 24, { sidebarWidth: 40 })
    expect(l.sidebarWidth).toBeLessThanOrEqual(80 - 50)
  })

  it('config can still turn things off at a wide size', () => {
    const l = at(200, 50, { sidebar: false, previewPanel: false })
    expect(l.showSidebar).toBe(false)
    expect(l.showPreview).toBe(false)
  })

  it('a short terminal drops the sidebar and uses the compact footer', () => {
    const l = at(120, 15)
    expect(l.showSidebar).toBe(false)
    expect(l.compactFooter).toBe(true)
  })

  it('only ultrawide shows the AI panel', () => {
    expect(at(179, 50).showAIPanel).toBe(false)
    expect(at(180, 50).showAIPanel).toBe(true)
  })
})
