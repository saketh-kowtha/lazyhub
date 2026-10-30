/**
 * useLayout: responsive layout breakpoints derived from the terminal size.
 *
 * `[layout]` config values are *preferences*: a breakpoint may override them when
 * there is no room (a 24-column sidebar on a 60-column terminal is hidden, not
 * obeyed). See "Responsive layout" in docs/DESIGN_REVAMP.md.
 *
 *   too-small  < MIN_COLS x MIN_ROWS   one "terminal too small" message
 *   narrow     < 80 cols               no sidebar (tab strip), no preview
 *   medium     80-109 cols             sidebar, preview collapsed
 *   wide       110-179 cols            sidebar and preview
 *   ultrawide  >= 180 cols             wide + AI side panel
 */

import { loadConfig } from '../config.js'
import { useTerminalSize } from './useTerminalSize.js'

const _cfg = loadConfig().layout

export const MIN_COLS = 40
export const MIN_ROWS = 10

/** Narrowest main column the app is allowed to squeeze. */
const MIN_MAIN_COLS = 50
/** Sidebar needs brand (2) + divider + 6 nav rows + help line to be usable. */
const MIN_SIDEBAR_ROWS = 16
const MIN_SIDEBAR_WIDTH = 16

const BREAKPOINTS = [
  { name: 'narrow',    minCols: 0,   sidebar: false, previewWidth: 0,  aiPanelWidth: 0,  sidebarWidth: 0  },
  { name: 'medium',    minCols: 80,  sidebar: true,  previewWidth: 0,  aiPanelWidth: 0,  sidebarWidth: 18 },
  { name: 'wide',      minCols: 110, sidebar: true,  previewWidth: 40, aiPanelWidth: 0,  sidebarWidth: 22 },
  { name: 'ultrawide', minCols: 180, sidebar: true,  previewWidth: 44, aiPanelWidth: 48, sidebarWidth: 22 },
]

/**
 * Pure layout computation (unit-testable without Ink).
 * @param {{ columns: number, rows: number }} size
 * @param {object} [cfg] the `[layout]` preferences (camelCase, as config.js exposes them)
 */
export function computeLayout({ columns: cols, rows }, cfg = {}) {
  const tooSmall = cols < MIN_COLS || rows < MIN_ROWS

  let bp = BREAKPOINTS[0]
  for (const b of BREAKPOINTS) if (cols >= b.minCols) bp = b

  // Sidebar: preference, clamped so the main column keeps MIN_MAIN_COLS.
  const prefSidebar = cfg.sidebarWidth ?? bp.sidebarWidth
  const roomForSidebar = cols - MIN_MAIN_COLS
  const sidebarFits = bp.sidebar && rows >= MIN_SIDEBAR_ROWS && roomForSidebar >= MIN_SIDEBAR_WIDTH
  const showSidebar = !tooSmall && cfg.sidebar !== false && sidebarFits
  const sidebarWidth = showSidebar ? Math.max(MIN_SIDEBAR_WIDTH, Math.min(prefSidebar, roomForSidebar)) : 0

  // Preview: only at the wide breakpoint, and only while the list keeps room.
  const prefPreview = cfg.previewWidth ?? bp.previewWidth
  const roomForPreview = cols - sidebarWidth - 60
  const previewWidth = bp.previewWidth > 0 ? Math.max(0, Math.min(prefPreview, roomForPreview)) : 0
  const showPreview = !tooSmall && cfg.previewPanel !== false && previewWidth >= 24

  const aiPanelWidth = bp.aiPanelWidth
  const showAIPanel = !tooSmall && aiPanelWidth > 0
  const borderStyle = cfg.borderStyle === 'none' ? undefined : (cfg.borderStyle ?? 'round')
  const compactFooter = rows < 20 || !!cfg.compactFooter

  // Chrome: border-top(1) + PaneHeader(2) + border-bottom(1) + statusBar(1) + footerKeys(0|1) + pane-filter-bar(1) = 6|7
  // TabStrip (shown instead of sidebar) adds 1 row.
  const tabStripRow = showSidebar ? 0 : 1
  const listHeight = Math.max(3, rows - (compactFooter ? 6 : 7) - tabStripRow)

  return {
    mode: tooSmall ? 'too-small' : bp.name, tooSmall, minCols: MIN_COLS, minRows: MIN_ROWS,
    cols, rows,
    sidebarWidth, previewWidth: showPreview ? previewWidth : 0, aiPanelWidth: showAIPanel ? aiPanelWidth : 0,
    borderStyle, compactFooter,
    showSidebar, showPreview, showAIPanel,
    listHeight,
  }
}

/**
 * useLayout hook: current layout measurements, re-rendered (debounced) on resize.
 * @returns {ReturnType<typeof computeLayout>}
 */
export function useLayout() {
  const size = useTerminalSize()
  return computeLayout(size, _cfg)
}
