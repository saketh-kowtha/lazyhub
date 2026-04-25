import React, { useState, useEffect } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../theme.js'

const PANE_META = {
  prs:           { icon: '⎇',  label: 'Pull Requests' },
  issues:        { icon: '◎',  label: 'Issues'        },
  branches:      { icon: '⑂',  label: 'Branches'      },
  actions:       { icon: '⚡', label: 'Actions'       },
  notifications: { icon: '◈',  label: 'Notifications' },
  settings:      { icon: '⊙',  label: 'Settings'      },
  logs:          { icon: '≡',  label: 'Logs'          },
}

function formatAge(ms) {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 5)    return 'just now'
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export function StatusBar({ repo, pane, count, filterState, scopeIndicator }) {
  const { t } = useTheme()
  const [mountTime] = useState(Date.now())
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 10_000)
    return () => clearInterval(id)
  }, [])

  const meta = PANE_META[pane] || { icon: '◈', label: pane || '' }
  const dot = <Text color={t.ui.dim}>  ·  </Text>

  return (
    <Box paddingX={1} justifyContent="space-between" backgroundColor={t.ui.headerBg}>
      <Box gap={0}>
        <Text color={t.ui.selected} bold>{meta.icon}  {meta.label}</Text>
        {repo && <>{dot}<Text color={t.ui.muted}>{repo}</Text></>}
        {count != null && <>{dot}<Text color={t.ui.dim}>{count} items</Text></>}
        {filterState && <>{dot}<Text color={t.ui.muted}>{filterState}</Text></>}
      </Box>
      <Box gap={1}>
        {scopeIndicator && <Text color={t.ui.dim}>[{scopeIndicator}]</Text>}
        <Text color={t.ui.dim}>⟳ {formatAge(mountTime)}</Text>
      </Box>
    </Box>
  )
}
