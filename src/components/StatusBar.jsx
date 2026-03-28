/**
 * StatusBar.jsx — 1-row status bar at the bottom.
 * Props: repo, pane, count
 */

import React, { useState, useEffect } from 'react'
import { Box, Text } from 'ink'
import { t } from '../theme.js'

const PANE_LABELS = {
  prs: 'Pull Requests',
  issues: 'Issues',
  branches: 'Branches',
  actions: 'Actions',
  notifications: 'Notifications',
}

function formatAge(ms) {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export function StatusBar({ repo, pane, count }) {
  const [now, setNow] = useState(Date.now())
  const [mountTime] = useState(Date.now())

  // Tick every 10s to update the "refreshed N ago" display
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(id)
  }, [])

  const paneLabel = PANE_LABELS[pane] || pane || ''

  return (
    <Box paddingX={1} justifyContent="space-between">
      <Box gap={1}>
        <Text color={t.ui.selected} bold>{repo || '—'}</Text>
        <Text color={t.ui.dim}>·</Text>
        <Text color={t.ui.muted}>{paneLabel}</Text>
        {count != null && (
          <>
            <Text color={t.ui.dim}>·</Text>
            <Text color={t.ui.dim}>{count} items</Text>
          </>
        )}
      </Box>
      <Text color={t.ui.dim}>refreshed {formatAge(mountTime)}</Text>
    </Box>
  )
}
