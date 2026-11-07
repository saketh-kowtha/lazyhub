/**
 * features/tabs/view.jsx — TOML-declared multi-pane dashboard.
 *
 * Owns the keyboard: a section (pane) and a row cursor per section, Enter /
 * `o` on the selected row, `r` to refresh. The selection is remembered per tab
 * so returning from a detail view lands on the same row (#279).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { openUrl } from '../../services/platform.js'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../../theme.js'
import { useKeyScope } from '../../keyscope.js'
import { useActionResolver, useKeymapInput } from '../../config/keymap.js'
import { TabPane } from './pane.jsx'

// A detail view unmounts the dashboard; the selection lives here so it survives.
const selectionMemory = new Map()

/** Forget every remembered dashboard selection (tests). */
export function resetTabSelection() {
  selectionMemory.clear()
}

function openInBrowser(url) {
  if (!url) return
  openUrl(url)
}

// Rows a section needs besides its items: top/bottom border, title row and the "+N more" line.
const SECTION_CHROME = 4

/**
 * Split the dashboard's height between its sections (#431). Every section gets an equal share
 * when each can show at least one row; otherwise only the active section is drawn, with the
 * whole budget, and Tab/] moves between sections.
 * @param {number} budget rows available below the dashboard title
 * @param {number} count number of sections
 * @returns {{perSection: number, single: boolean}} rows per drawn section
 */
export function sectionBudget(budget, count) {
  const share = Math.floor(budget / Math.max(1, count))
  if (count > 1 && share < SECTION_CHROME + 1) return { perSection: Math.max(SECTION_CHROME + 1, budget), single: true }
  return { perSection: share, single: false }
}

export function TabView({ tab, repo, onOpenItem, innerWidth, listHeight }) {
  const { t } = useTheme()
  const { stdout } = useStdout()
  useKeyScope('pane')
  const cols = innerWidth || (stdout?.columns || 80) - 2
  const wide = cols >= 118
  const panes = Array.isArray(tab?.panes) ? tab.panes : []
  const tabId = tab?.id || tab?.label || 'tab'

  const [selection, setSelection] = useState(() => selectionMemory.get(tabId) || { section: 0, cursors: [] })
  useEffect(() => { selectionMemory.set(tabId, selection) }, [tabId, selection])

  // Each pane reports its loaded rows and refetch here; handlers read them at key time.
  const paneData = useRef([])
  const [failed, setFailed] = useState([])
  const report = useCallback((idx, data) => {
    paneData.current[idx] = data
    // Which panes are failing, so only the first one prints the full notice (#469).
    setFailed(prev => ((prev[idx] || null) === (data.failed || null) ? prev : Object.assign([...prev], { [idx]: data.failed || null })))
  }, [])
  // A pane repeats the notice only when an earlier pane already shows the same kind of failure,
  // so a different cause (and its fix command) is never hidden.
  const repeatOf = (idx) => { const j = failed.findIndex((k, i) => i < idx && k && k === failed[idx]); return j >= 0 ? j : null }
  const resolve = useActionResolver('tab-list')

  const section = Math.min(selection.section, Math.max(0, panes.length - 1))
  const cursorOf = (idx) => {
    const stored = Math.max(0, selection.cursors[idx] || 0)
    const len = paneData.current[idx]?.items?.length || 0
    // A section that is not loaded (not drawn in one-section mode, or still loading) knows no length yet:
    // keep the remembered row instead of snapping it to 0. TabPane clamps it to the rows it really has.
    return len > 0 ? Math.min(stored, len - 1) : stored
  }
  const setCursor = (idx, value) => setSelection(prev => {
    const cursors = [...prev.cursors]
    cursors[idx] = value
    return { ...prev, cursors }
  })
  const moveSection = (delta) => {
    if (panes.length === 0) return
    setSelection(prev => ({ ...prev, section: (section + delta + panes.length) % panes.length }))
  }

  useKeymapInput((input, key) => {
    const action = resolve(input, key)
    if (!action) return
    const data = paneData.current[section]
    const items = data?.items || []
    const cursor = cursorOf(section)
    switch (action) {
      case 'cursor.down': if (items.length) setCursor(section, Math.min(items.length - 1, cursor + 1)); return
      case 'cursor.up': if (items.length) setCursor(section, Math.max(0, cursor - 1)); return
      case 'cursor.top': if (items.length) setCursor(section, 0); return
      case 'cursor.bottom': if (items.length) setCursor(section, items.length - 1); return
      case 'tab.next-section': moveSection(1); return
      case 'tab.prev-section': moveSection(-1); return
      case 'list.refresh': paneData.current.forEach(d => d?.refetch?.()); return
      case 'tab.open-selected':
        if (items[cursor] && onOpenItem) onOpenItem(items[cursor], data.kind, data.repo)
        return
      case 'tab.open-browser':
        if (items[cursor]) openInBrowser(items[cursor].url)
        return
      default:
    }
  })

  // A fixed height budget per section (overflow hidden), so sections never overlap (#431).
  const budget = Math.max(SECTION_CHROME + 1, (listHeight || 20) - 1)
  const { perSection, single } = wide ? { perSection: budget, single: false } : sectionBudget(budget, panes.length)
  const drawn = panes.map((pane, idx) => ({ pane, idx })).filter(({ idx }) => !single || idx === section)
  const paneWidth = Math.floor((cols - 2 - (wide ? drawn.length - 1 : 0)) / (wide ? Math.max(1, drawn.length) : 1))

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1} overflow="hidden">
      <Box height={1} overflow="hidden">
        <Text wrap="truncate">
          <Text color={t.ui.selected} bold>{tab?.label || tab?.id}</Text>
          <Text color={t.ui.dim}>  {single ? `section ${section + 1}/${panes.length}` : `${panes.length} panes`}</Text>
        </Text>
      </Box>
      <Box flexDirection={wide ? 'row' : 'column'} gap={wide ? 1 : 0} flexGrow={1}>
        {drawn.map(({ pane, idx }) => (
          <Box key={`${pane.kind}-${pane.title || idx}`} height={perSection} width={paneWidth} overflow="hidden">
            <TabPane
              rows={perSection - SECTION_CHROME}
              width={paneWidth}
              pane={pane}
              repo={repo}
              active={idx === section}
              cursor={cursorOf(idx)}
              onData={(data) => report(idx, data)}
              repeatOf={repeatOf(idx)}
            />
          </Box>
        ))}
        {panes.length === 0 && <Text color={t.ui.dim}>No panes declared.</Text>}
      </Box>
    </Box>
  )
}
