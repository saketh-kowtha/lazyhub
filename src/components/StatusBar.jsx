/**
 * StatusBar.jsx — 1-row status bar at the bottom.
 * Props: repo, pane, count, filterState
 */

import React, { useState, useEffect } from 'react'
import { Box, Text, useStdout } from 'ink'
import { t } from '../theme.js'

const PANE_META = {
  prs:           { icon: '⎇', label: 'Pull Requests' },
  issues:        { icon: '○', label: 'Issues' },
  branches:      { icon: '⎇', label: 'Branches' },
  actions:       { icon: '▶', label: 'Actions' },
  notifications: { icon: '●', label: 'Notifications' },
}

function formatAge(ms) {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export function StatusBar({ repo, pane, count, filterState }) {
  const [now, setNow] = useState(Date.now())
  const [mountTime] = useState(Date.now())
  const { stdout } = useStdout()
  const termWidth = stdout?.columns || 80

  // Tick every 10s to update the "refreshed N ago" display
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])

  const meta = PANE_META[pane] || { icon: '?', label: pane || '' }
  const separator = <Text color={t.ui.dim}>  |  </Text>
  const borderLine = '─'.repeat(termWidth)

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={t.ui.dim}>{borderLine}</Text>
      </Box>
      <Box paddingX={1} justifyContent="space-between">
        <Box gap={0}>
          <Text color={t.ui.selected} bold>{meta.icon} {meta.label}</Text>
          {separator}
          <Text color={t.ui.muted}>{repo || '—'}</Text>
          {count != null && (
            <>
              {separator}
              <Text color={t.ui.muted}>{count} items</Text>
            </>
          )}
          {filterState && (
            <>
              {separator}
              <Text color={t.ui.dim}>filter: </Text>
              <Text color={t.ui.muted}>{filterState}</Text>
            </>
          )}
        </Box>
        <Text color={t.ui.dim}>refreshed {formatAge(mountTime)}</Text>
      </Box>
    </Box>
  )
}
