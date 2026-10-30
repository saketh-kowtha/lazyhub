/**
 * TabStrip.jsx — horizontal pane tabs for compact mode (<80 cols).
 * Props: panes (string[]), currentPane, paneLabels, paneIcons, onSelect
 */

import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../theme.js'

export function TabStrip({ panes = [], currentPane, paneLabels = {}, paneIcons = {}, onSelect }) {
  const { t } = useTheme()
  const { stdout } = useStdout()
  // Below 56 columns the separators go (a single space) so every pane icon stays visible.
  const sep = (stdout?.columns || 80) < 56 ? ' ' : ' │ '

  return (
    <Box flexDirection="row" paddingX={1} height={1} overflow="hidden" flexShrink={0}>
      {panes.map((pane, i) => {
        const active = pane === currentPane
        const icon   = paneIcons[pane]  || '✦'
        const label  = paneLabels[pane] || pane
        return (
          <Box key={pane} flexShrink={active ? 1 : 0}>
            {i > 0 && <Text color={t.ui.dim}>{sep}</Text>}
            <Box gap={1}>
              {active && <Text color={t.ui.selected}>▎</Text>}
              <Text
                color={active ? t.ui.selected : t.ui.muted}
                bold={active}
                wrap="truncate"
              >
                {active ? `${icon} ${label}` : icon}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
