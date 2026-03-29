/**
 * Sidebar.jsx — navigation sidebar.
 *
 * Props:
 *   currentPane   string
 *   onSelect      fn(pane)
 *   height        number
 *   visiblePanes  string[]   — ordered pane ids from config
 *   paneLabels    object     — id → label (includes custom panes)
 *   paneIcons     object     — id → icon  (includes custom panes)
 */

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'

const BUILTIN_LABELS = {
  prs:           'Pull Requests',
  issues:        'Issues',
  branches:      'Branches',
  actions:       'Actions',
  notifications: 'Notifs',
}

const BUILTIN_ICONS = {
  prs:           '⎇',
  issues:        '○',
  branches:      '⎇',
  actions:       '▶',
  notifications: '●',
}

export function Sidebar({ currentPane, onSelect, height, visiblePanes, paneLabels, paneIcons }) {
  const { t } = useTheme()
  const labels = paneLabels || BUILTIN_LABELS
  const icons  = paneIcons  || BUILTIN_ICONS

  const allItems = (visiblePanes || Object.keys(BUILTIN_LABELS)).map(id => ({
    pane:  id,
    icon:  icons[id]  || '◈',
    label: (labels[id] || id).slice(0, 13),   // truncate to fit sidebar width
  }))

  // Separator width: sidebar inner width minus borders (20 - 2 = 18)
  const separator = '─'.repeat(18)

  return (
    <Box
      width={20}
      flexDirection="column"
      borderStyle="single"
      borderColor={t.ui.border}
      height={height}
    >
      <Box paddingX={1} marginBottom={1}>
        <Text color={t.ui.selected} bold>lazyhub</Text>
      </Box>

      {allItems.map(({ pane, icon, label }) => {
        const isActive = pane === currentPane
        return (
          <Box
            key={pane}
            paddingLeft={1}
            backgroundColor={isActive ? t.ui.headerBg : undefined}
          >
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
      <Box borderStyle="single" borderColor={t.ui.border} borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
        <Text color={t.ui.dim}>[Tab]/[1-9]</Text>
      </Box>
    </Box>
  )
}
