/** StatusBar.jsx — Application status bar showing context and global state. */

import React, { useState, useEffect } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../theme.js'
import { sanitize, displayWidth, truncateEllipsis } from '../utils.js'
import { firstActionKey } from '../config/actions.js'

const PANE_META = {
  prs:           { icon: '⎇',  label: 'Pull Requests' },
  issues:        { icon: '⚑',  label: 'Issues'        },
  branches:      { icon: '⌥',  label: 'Branches'      },
  actions:       { icon: '↯', label: 'Actions'       },
  notifications: { icon: '✦',  label: 'Notifications' },
  settings:      { icon: '⌘',  label: 'Settings'      },
  logs:          { icon: '⌸',  label: 'Logs'          },
}

// Mode chip colors — uses semantic tokens if available, falls back to ci/ui tokens
function modeColor(mode, t) {
  const m = t.semantic?.mode
  if (m) {
    const map = { NORMAL: m.normal, SEARCH: m.search, COMMAND: m.command, VISUAL: m.visual, COMPOSE: m.compose }
    if (map[mode]) return map[mode]
  }
  const fallback = { NORMAL: t.ui.selected, SEARCH: t.ci.pending, COMMAND: t.ui.selected, VISUAL: t.ci.pass, COMPOSE: t.ci.pass }
  return fallback[mode] || t.ui.dim
}

function formatAge(ms) {
  const s = Math.floor((Date.now() - ms) / 1000)
  if (s < 5)    return 'just now'
  if (s < 60)   return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  return `${Math.floor(s / 3600)}h ago`
}

export function StatusBar({ repo, pane, count, filterState, scopeIndicator, mode = 'NORMAL', ghHealth }) {
  const { t } = useTheme()
  const { stdout } = useStdout()
  const cols = stdout?.columns || 80
  const [mountTime] = useState(Date.now())
  const [, tick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 10_000)
    return () => clearInterval(id)
  }, [])

  const meta    = PANE_META[pane] || { icon: '✦', label: pane || '' }
  const chipClr = modeColor(mode, t)
  const narrow  = cols < 100
  const degraded = ghHealth?.degraded
  const multi = degraded && ghHealth.failingCount > 1
  const detail = degraded ? sanitize(String(ghHealth.error?.message || ghHealth.error || 'gh failed')) : ''
  const retryHint = degraded && !multi ? ` - press ${firstActionKey('list.refresh', 'r')} to retry` : ''
  const head = multi ? `${ghHealth.failingCount} calls failing: ` : ''

  // One row, never wraps. Zones (left to right) drop in this order as space runs out:
  // age, filter, repo/count, then the banner message is ellipsized (the retry hint is kept).
  const modeW  = mode !== 'NORMAL' ? displayWidth(mode) + 1 : 0
  const scopeW = scopeIndicator ? displayWidth(String(scopeIndicator)) + 3 : 0
  const ageW   = !narrow ? displayWidth(`⟳ ${formatAge(mountTime)}`) + 1 : 0
  const labelW = displayWidth(`${meta.icon}  ${meta.label}`)
  const inner  = Math.max(0, cols - 2)
  const bannerRoom = inner - labelW - 2 - modeW - scopeW - (degraded && !narrow ? ageW : 0)
  const errorText = !degraded ? null
    : bannerRoom >= displayWidth(retryHint) + 8 ? truncateEllipsis(head + detail, Math.max(1, bannerRoom - displayWidth(retryHint))) + retryHint
      : `! ${firstActionKey('list.refresh', 'r')} retry`
  const showAge = !narrow && !errorText
  const showContext = !errorText || cols >= 140

  return (
    <Box paddingX={1} justifyContent="space-between" backgroundColor={t.ui.headerBg} height={1} overflow="hidden">
      {/* Left zone: pane · repo · count · filter */}
      <Box gap={0} flexShrink={1} overflow="hidden">
        <Text wrap="truncate-end">
          <Text color={t.ui.selected} bold>{meta.icon}  {meta.label}</Text>
          {showContext && repo && <><Text color={t.ui.dim}>  ·  </Text><Text color={t.ui.muted}>{repo}</Text></>}
          {showContext && count != null && <><Text color={t.ui.dim}>  ·  </Text><Text color={t.ui.dim}>{count} items</Text></>}
          {showContext && filterState && !narrow && <><Text color={t.ui.dim}>  ·  </Text><Text color={t.ui.muted}>{filterState}</Text></>}
        </Text>
      </Box>

      {/* Right zone: banner · mode chip · scope · refresh age */}
      <Box gap={1} flexShrink={0}>
        {errorText && <Text color={t.ci?.fail || t.ui.selected} bold wrap="truncate">{errorText}</Text>}
        {mode !== 'NORMAL' && (
          <Text color={chipClr} bold>{mode}</Text>
        )}
        {scopeIndicator && <Text color={t.ui.dim}>[{scopeIndicator}]</Text>}
        {showAge && <Text color={t.ui.dim}>⟳ {formatAge(mountTime)}</Text>}
      </Box>
    </Box>
  )
}
