// @ts-nocheck
/**
 * src/features/prs/collisions/view.jsx -- the collision radar screen (#360).
 * Opened from PR detail with `K`. Tab switches between "this PR" and "repo" (clusters + merge order).
 * Read-only: nothing here merges, updates or rebases anything.
 */
import React, { useMemo, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useInput } from '../../../hooks/useSafeInput.js'
import { useGh } from '../../../hooks/useGh.js'
import { useTheme } from '../../../theme.js'
import { useKeyScope } from '../../../keyscope.js'
import { matchesAction } from '../../../config/actions.js'
import { Spinner } from '../../../components/Spinner.jsx'
import { FailureNotice } from '../../../components/FailureNotice.jsx'
import { classifyGhFailure } from '../../../executor.js'
import { getCollisionScan } from './scan.js'
import { radarLines } from './lines.js'

export function CollisionRadar({ repo, prNumber, onClose }) {
  useKeyScope('dialog')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const height = Math.max(3, (stdout?.rows || 24) - 7)
  const { data: scan, loading, error, refetch } = useGh(getCollisionScan, [repo, prNumber], { ttl: 120_000 })
  const [tab, setTab] = useState('pr')
  const [offset, setOffset] = useState(0)

  const rows = useMemo(() => (scan ? radarLines(scan, tab) : []), [scan, tab])
  const maxOffset = Math.max(0, rows.length - height)

  useInput((input, key) => {
    if (matchesAction('dialog.cancel', input, key)) { onClose(); return }
    if (key.tab || input === 'K') { setTab(v => (v === 'pr' ? 'repo' : 'pr')); setOffset(0); return }
    if (input === 'r') { refetch(); return }
    if (input === 'j' || key.downArrow) { setOffset(o => Math.min(maxOffset, o + 1)); return }
    if (input === 'k' || key.upArrow) { setOffset(o => Math.max(0, o - 1)); return }
    if (input === 'G') { setOffset(maxOffset); return }
    if (input === 'g') { setOffset(0) }
  })

  const tone = { head: t.ui.selected, likely: t.ci.fail, warn: t.ci.pending, dim: t.ui.dim, ok: t.ci.pass, normal: t.ui.muted }
  const title = tab === 'pr' ? `Collisions for #${prNumber}` : 'Collisions across open PRs'

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box gap={1}>
        <Text bold color={t.ui.selected}>{title}</Text>
        <Text color={t.ui.dim}>[Tab] {tab === 'pr' ? 'repo view + merge order' : 'this PR'}  [r] rescan  [j/k] scroll  [Esc] back</Text>
      </Box>
      {loading && !scan && <Box gap={1}><Spinner /><Text color={t.ui.muted}>Reading open PRs and their changed files...</Text></Box>}
      {error && !scan && <FailureNotice failure={classifyGhFailure(error)} />}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {rows.slice(offset, offset + height).map((r, i) => (
          <Text key={offset + i} wrap="truncate" color={tone[r.tone] || t.ui.muted} bold={r.tone === 'head'}>{r.text || ' '}</Text>
        ))}
      </Box>
      {scan && maxOffset > 0 && <Text color={t.ui.dim}>{offset + 1}-{Math.min(offset + height, rows.length)} / {rows.length}</Text>}
    </Box>
  )
}
