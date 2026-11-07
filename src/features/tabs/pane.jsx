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
import { fitCell } from '../../ui/row-layout.js'
import { filterToGh } from './filter-to-gh.js'

export const VISIBLE_ROWS = 8

function DashboardRows({ items, cursor, active, rows = VISIBLE_ROWS, width = 60 }) {
  const { t } = useTheme()
  // The window follows the cursor, so the selected row is always on screen and
  // returning to the dashboard restores the same scroll position.
  const total = items.length
  const show = Math.max(1, Math.min(VISIBLE_ROWS, total > rows ? rows - 1 : rows))
  const offset = Math.max(0, cursor - (show - 1))
  const hidden = Math.max(0, total - offset - show)
  // marker(1) + gap + number(6) + gap + title + gap + age(4), inside the section's border and padding.
  const inner = width - 4
  const titleWidth = Math.max(4, inner - (1 + 1 + 6 + 1 + 1 + 4))
  return (
    <Box flexDirection="column">
      {items.slice(offset, offset + show).map((item, i) => {
        const selected = active && offset + i === cursor
        return (
          <Box key={`${item.number}-${item.title}`} height={1}>
            <Text color={t.ui.selected} bold>{selected ? '▸' : ' '} </Text>
            <Text color={t.ui.dim}>{fitCell(`#${item.number}`, 6)} </Text>
            <Text color={t.ui.selected} bold={selected}>{fitCell(sanitize(item.title), titleWidth)} </Text>
            <Text color={t.ui.dim}>{fitCell(shortAge(item.updatedAt), 4)}</Text>
          </Box>
        )
      })}
      {hidden > 0 && <Text color={t.ui.dim}>  +{hidden} more</Text>}
      {items.length === 0 && <Text color={t.ui.dim}>No items</Text>}
    </Box>
  )
}

export function TabPane({ pane, repo, active = false, cursor = 0, onData, repeatOf = null, rows = VISIBLE_ROWS, width = 60 }) {
  const { t } = useTheme()
  const limit = pane.limit || 25
  const translated = useMemo(() => filterToGh(pane.filter || {}, { limit }), [pane.filter, limit])
  const loader = pane.kind === 'issues' ? listIssues : listPRs
  const paneRepo = pane.filter?.repo || repo
  const { data, loading, error, refetch } = useGh(loader, [paneRepo, translated.filter])

  const failure = error ? classifyGhFailure(error, { cached: data != null }) : null
  // Only a settled, error-free list can be selected or opened.
  const items = !loading && !error && Array.isArray(data) ? data : []
  useEffect(() => { if (onData) onData({ items, refetch, kind: pane.kind, repo: paneRepo, failed: failure ? failure.kind : null }) })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={active ? t.ui.borderActive : t.ui.border} paddingX={1} width={width} overflow="hidden">
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
        <FailureNotice failure={failure} compact={repeatOf !== null} />
      )}
      {!loading && !error && <DashboardRows items={items} cursor={Math.max(0, Math.min(cursor, items.length - 1))} active={active} rows={rows} width={width} />}
    </Box>
  )
}
