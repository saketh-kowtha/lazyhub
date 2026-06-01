/**
 * features/tabs/view.jsx — TOML-declared multi-pane dashboard.
 */

import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../../theme.js'
import { TabPane } from './pane.jsx'

export function TabView({ tab, repo }) {
  const { t } = useTheme()
  const { stdout } = useStdout()
  const wide = (stdout?.columns || 80) >= 120
  const panes = Array.isArray(tab?.panes) ? tab.panes : []

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box gap={2}>
        <Text color={t.ui.selected} bold>{tab?.label || tab?.id}</Text>
        <Text color={t.ui.dim}>{panes.length} panes</Text>
      </Box>
      <Box flexDirection={wide ? 'row' : 'column'} gap={1} flexGrow={1}>
        {panes.map((pane, idx) => <TabPane key={`${pane.kind}-${pane.title || idx}`} pane={pane} repo={repo} />)}
        {panes.length === 0 && <Text color={t.ui.dim}>No panes declared.</Text>}
      </Box>
    </Box>
  )
}
