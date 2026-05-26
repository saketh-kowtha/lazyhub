/**
 * useLayout — responsive layout breakpoints based on terminal dimensions.
 * Config overrides always win over breakpoint defaults.
 */

import { useStdout } from 'ink'
import { loadConfig } from '../config.js'

const _cfg = loadConfig().layout

// Breakpoint definitions (cols-based)
const BREAKPOINTS = [
  { name: 'compact',   minCols: 0,   sidebarWidth: 0,  previewWidth: 0,  aiPanelWidth: 0  },
  { name: 'standard',  minCols: 80,  sidebarWidth: 18, previewWidth: 0,  aiPanelWidth: 0  },
  { name: 'comfort',   minCols: 100, sidebarWidth: 20, previewWidth: 38, aiPanelWidth: 0  },
  { name: 'wide',      minCols: 140, sidebarWidth: 22, previewWidth: 44, aiPanelWidth: 0  },
  { name: 'ultrawide', minCols: 180, sidebarWidth: 22, previewWidth: 44, aiPanelWidth: 48 },
]

export function useLayout() {
  const { stdout } = useStdout()
  const cols = stdout?.columns || 80
  const rows = stdout?.rows    || 24

  // Pick the highest breakpoint that fits
  let bp = BREAKPOINTS[0]
  for (const b of BREAKPOINTS) {
    if (cols >= b.minCols) bp = b
  }

  // Config overrides
  const sidebarWidth  = _cfg.sidebarWidth  ?? bp.sidebarWidth
  const previewWidth  = _cfg.previewWidth  ?? bp.previewWidth
  const aiPanelWidth  = bp.aiPanelWidth
  const borderStyle   = _cfg.borderStyle === 'none' ? undefined : (_cfg.borderStyle ?? 'round')
  const compactFooter = rows < 20 || !!_cfg.compactFooter

  const showSidebar  = _cfg.sidebar !== false && sidebarWidth > 0
  const showPreview  = _cfg.previewPanel !== false && previewWidth > 0
  const showAIPanel  = aiPanelWidth > 0

  // Chrome: border-top(1) + PaneHeader(2) + border-bottom(1) + statusBar(1) + footerKeys(0|1) + pane-filter-bar(1) = 6|7
  // TabStrip (shown instead of sidebar in compact terminal mode) adds 1 row.
  const tabStripRow = sidebarWidth === 0 ? 1 : 0
  const listHeight  = Math.max(3, rows - (compactFooter ? 6 : 7) - tabStripRow)

  return {
    mode: bp.name, cols, rows,
    sidebarWidth, previewWidth, aiPanelWidth,
    borderStyle, compactFooter,
    showSidebar, showPreview, showAIPanel,
    listHeight,
  }
}
