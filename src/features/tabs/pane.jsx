/**
 * features/tabs/pane.jsx — one TOML-declared dashboard pane.
 */

import React, { useEffect, useMemo } from 'react'
import { Box, Text } from 'ink'
import { classifyGhFailure, listPRs, listIssues } from '../../executor.js'
import { useGh } from '../../hooks/useGh.js'
import { useTheme } from '../../theme.js'
import { FailureNotice } from '../../components/FailureNotice.jsx'
import { sanitize, shortAge } from '../../utils.js'
import { filterToGh } from './filter-to-gh.js'

export const VISIBLE_ROWS = 8

function DashboardRows({ items, cursor, active }) {
  const { t } = useTheme()
  // The window follows the cursor, so the selected row is always on screen and
  // returning to the dashboard restores the same scroll position.
  const offset = Math.max(0, cursor - (VISIBLE_ROWS - 1))
  const hidden = Math.max(0, items.length - offset - VISIBLE_ROWS)
  return (
    <Box flexDirection="column">
      {items.slice(offset, offset + VISIBLE_ROWS).map((item, i) => {
        const selected = active && offset + i === cursor
        return (
          <Box key={`${item.number}-${item.title}`} gap={1}>
            <Text color={t.ui.selected} bold>{selected ? '▸' : ' '}</Text>
            <Box width={6}>
              <Text color={t.ui.dim}>#{item.number}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text color={t.ui.selected} bold={selected} wrap="truncate">{sanitize(item.title)}</Text>
            </Box>
            <Text color={t.ui.dim}>{shortAge(item.updatedAt)}</Text>
          </Box>
        )
      })}
      {hidden > 0 && <Text color={t.ui.dim}>  +{hidden} more</Text>}
      {items.length === 0 && <Text color={t.ui.dim}>No items</Text>}
    </Box>
  )
}

export function TabPane({ pane, repo, active = false, cursor = 0, onData, repeatOf = null }) {
  const { t } = useTheme()
  const limit = pane.limit || 25
  const translated = useMemo(() => filterToGh(pane.filter || {}, { limit }), [pane.filter, limit])
  const loader = pane.kind === 'issues' ? listIssues : listPRs
  const paneRepo = pane.filter?.repo || repo
  const { data, loading, error, refetch } = useGh(loader, [paneRepo, translated.filter])

  // Only a settled, error-free list can be selected or opened.
  const items = !loading && !error && Array.isArray(data) ? data : []
  useEffect(() => { if (onData) onData({ items, refetch, kind: pane.kind, repo: paneRepo, failed: Boolean(error) }) })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={active ? t.ui.borderActive : t.ui.border} paddingX={1} minWidth={30} flexGrow={1}>
      <Box justifyContent="space-between">
        <Text color={t.ui.selected} bold>{pane.title || pane.kind}</Text>
        <Text color={t.ui.dim}>{pane.kind}</Text>
      </Box>
	      {translated.warnings.map(w => (
	        <Box key={w}>
	          <Text color={t.ci.fail}>⚠ {w}</Text>
	        </Box>
	      ))}
      {loading && <Text color={t.ui.dim}>Loading…</Text>}
      {error && (
        // One notice per screen (#469): panes that fail the same way after the first
        // show only the cause; `cached` is true only when this pane really has data.
        <FailureNotice failure={classifyGhFailure(error, { cached: data != null })} compact={repeatOf !== null} />
      )}
      {!loading && !error && <DashboardRows items={items} cursor={Math.max(0, Math.min(cursor, items.length - 1))} active={active} />}
    </Box>
  )
}
