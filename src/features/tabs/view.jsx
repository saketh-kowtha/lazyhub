/**
 * features/tabs/view.jsx — TOML-declared multi-pane dashboard.
 *
 * Owns the keyboard: a section (pane) and a row cursor per section, Enter /
 * `o` on the selected row, `r` to refresh. The selection is remembered per tab
 * so returning from a detail view lands on the same row (#279).
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
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
  import('execa').then(({ execa }) => {
    const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
    execa(cmd, [url]).catch(() => {})
  })
}

export function TabView({ tab, repo, onOpenItem }) {
  const { t } = useTheme()
  const { stdout } = useStdout()
  useKeyScope('pane')
  const wide = (stdout?.columns || 80) >= 120
  const panes = Array.isArray(tab?.panes) ? tab.panes : []
  const tabId = tab?.id || tab?.label || 'tab'

  const [selection, setSelection] = useState(() => selectionMemory.get(tabId) || { section: 0, cursors: [] })
  useEffect(() => { selectionMemory.set(tabId, selection) }, [tabId, selection])

  // Each pane reports its loaded rows and refetch here; handlers read them at key time.
  const paneData = useRef([])
  const report = useCallback((idx, data) => { paneData.current[idx] = data }, [])
  const resolve = useActionResolver('tab-list')

  const section = Math.min(selection.section, Math.max(0, panes.length - 1))
  const cursorOf = (idx) => {
    const len = paneData.current[idx]?.items?.length || 0
    return Math.max(0, Math.min(selection.cursors[idx] || 0, len - 1))
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

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box gap={2}>
        <Text color={t.ui.selected} bold>{tab?.label || tab?.id}</Text>
        <Text color={t.ui.dim}>{panes.length} panes</Text>
      </Box>
      <Box flexDirection={wide ? 'row' : 'column'} gap={1} flexGrow={1}>
        {panes.map((pane, idx) => (
          <Box key={`${pane.kind}-${pane.title || idx}`} flexGrow={1}>
            <TabPane
              pane={pane}
              repo={repo}
              active={idx === section}
              cursor={cursorOf(idx)}
              onData={(data) => report(idx, data)}
            />
          </Box>
        ))}
        {panes.length === 0 && <Text color={t.ui.dim}>No panes declared.</Text>}
      </Box>
    </Box>
  )
}
