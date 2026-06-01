/**
 * features/tabs/pane.jsx — one TOML-declared dashboard pane.
 */

import React, { useMemo } from 'react'
import { Box, Text } from 'ink'
import { listPRs, listIssues } from '../../executor.js'
import { useGh } from '../../hooks/useGh.js'
import { useTheme } from '../../theme.js'
import { sanitize, shortAge } from '../../utils.js'
import { filterToGh } from './filter-to-gh.js'

function DashboardRows({ items }) {
  const { t } = useTheme()
  return (
    <Box flexDirection="column">
      {(items || []).slice(0, 8).map(item => (
        <Box key={`${item.number}-${item.title}`} gap={1}>
          <Text color={t.ui.dim} width={6}>#{item.number}</Text>
          <Text color={t.ui.selected} wrap="truncate" flexGrow={1}>{sanitize(item.title)}</Text>
          <Text color={t.ui.dim}>{shortAge(item.updatedAt)}</Text>
        </Box>
      ))}
      {(!items || items.length === 0) && <Text color={t.ui.dim}>No items</Text>}
    </Box>
  )
}

export function TabPane({ pane, repo }) {
  const { t } = useTheme()
  const limit = pane.limit || 25
  const translated = useMemo(() => filterToGh(pane.filter || {}, { limit }), [pane.filter, limit])
  const loader = pane.kind === 'issues' ? listIssues : listPRs
  const { data, loading, error } = useGh(loader, [pane.filter?.repo || repo, translated.filter])

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.border} paddingX={1} minWidth={30} flexGrow={1}>
      <Box justifyContent="space-between">
        <Text color={t.ui.selected} bold>{pane.title || pane.kind}</Text>
        <Text color={t.ui.dim}>{pane.kind}</Text>
      </Box>
      {translated.warnings.map(w => <Text key={w} color={t.ci.fail}>⚠ {w}</Text>)}
      {loading && <Text color={t.ui.dim}>Loading…</Text>}
      {error && <Text color={t.ci.fail}>⚠ {error.message}</Text>}
      {!loading && !error && <DashboardRows items={data || []} />}
    </Box>
  )
}
