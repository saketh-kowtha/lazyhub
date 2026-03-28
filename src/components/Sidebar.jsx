/**
 * Sidebar.jsx — navigation sidebar.
 * Props: currentPane, onSelect(pane), height, visiblePanes
 *
 * visiblePanes comes from loadConfig().panes so users can hide tabs they
 * don't use via ~/.config/ghui/config.json → { "panes": ["prs","issues"] }
 */

import React from 'react'
import { Box, Text } from 'ink'
import { t } from '../theme.js'

const ALL_NAV_ITEMS = [
  { pane: 'prs',           icon: '⎇', label: 'Pull Requests' },
  { pane: 'issues',        icon: '○', label: 'Issues' },
  { pane: 'branches',      icon: '⎇', label: 'Branches' },
  { pane: 'actions',       icon: '▶', label: 'Actions' },
  { pane: 'notifications', icon: '●', label: 'Notifs' },
]

export function Sidebar({ currentPane, onSelect, height, visiblePanes }) {
  const items = visiblePanes
    ? ALL_NAV_ITEMS.filter(i => visiblePanes.includes(i.pane))
    : ALL_NAV_ITEMS

  return (
    <Box
      width={18}
      flexDirection="column"
      borderStyle="single"
      borderColor={t.ui.border}
      height={height}
    >
      <Box paddingX={1} marginBottom={1}>
        <Text color={t.ui.selected} bold>ghui</Text>
      </Box>

      {items.map(({ pane, icon, label }) => {
        const isActive = pane === currentPane
        return (
          <Box key={pane} paddingLeft={1}>
            <Text color={isActive ? t.ui.selected : t.ui.dim}>
              {isActive ? '▌' : ' '}
            </Text>
            <Text color={isActive ? t.ui.selected : t.ui.muted} bold={isActive}>
              {' '}{icon}{' '}{label}
            </Text>
          </Box>
        )
      })}

      <Box flexGrow={1} />
      <Box paddingX={1} paddingBottom={0}>
        <Text color={t.ui.dim}>[Tab] switch</Text>
      </Box>
    </Box>
  )
}
