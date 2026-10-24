/** PR detail check summary, rows and shared navigation ordering. */
import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../../theme.js'
import { sanitize } from '../../../utils.js'

/** @typedef {{name?: string, context?: string, conclusion?: string, status?: string, state?: string, appName?: string}} PRCheck */

/** @param {PRCheck[] | null | undefined} checks @param {{statusCheckRollup?: PRCheck[]} | null | undefined} pr @returns {PRCheck[]} */
export function sortChecks(checks, pr) {
  const rawChecks = (checks?.length > 0) ? checks : (pr?.statusCheckRollup || [])
  // Sort: failing first, then pending, then passing/skipped
  const checkOrder = (c) => {
    const s = c.conclusion || c.status || c.state || ''
    if (/failure|error/i.test(s)) return 0
    if (/pending|in_progress|queued/i.test(s)) return 1
    if (/success/i.test(s)) return 2
    return 3
  }
  return [...rawChecks].sort((a, b) => checkOrder(a) - checkOrder(b))
}

/** @param {{checks: PRCheck[], checkCursor: number | null}} props */
export function ChecksHeading({ checks, checkCursor }) {
  const { t } = useTheme()
  const passing = checks.filter(c => /success/i.test(c.conclusion || c.status || c.state || '')).length
  const failing = checks.filter(c => /failure|error/i.test(c.conclusion || c.status || c.state || '')).length
  const pending = checks.filter(c => /pending|in_progress|queued/i.test(c.conclusion || c.status || c.state || '')).length
  const skipped = checks.filter(c => /cancelled|skipped/i.test(c.conclusion || c.status || c.state || '')).length
  const checksActive = checkCursor !== null
  return (
    <Box key="checks-hdr" paddingX={1} gap={2}>
      <Text color={checksActive ? t.ui.selected : t.ui.dim} bold>Checks</Text>
      {passing > 0 && <Text color={t.ci.pass}>✓ {passing}</Text>}
      {failing > 0 && <Text color={t.ci.fail}>✗ {failing}</Text>}
      {pending > 0 && <Text color={t.ci.pending}>● {pending}</Text>}
      {skipped > 0 && <Text color={t.ui.dim}>⊘ {skipped}</Text>}
      {checksActive && <Text color={t.ui.dim}>[j/k] nav  [Enter/o] open  [R] rerun  [Esc] exit</Text>}
    </Box>
  )
}

/** @param {{check: PRCheck, index: number, checkCursor: number | null}} props */
export function CheckRow({ check, index, checkCursor }) {
  const { t } = useTheme()
  const status = check.conclusion || check.status || check.state || ''
  let icon, color
  if      (/success/i.test(status))                    { icon = '✓'; color = t.ci.pass }
  else if (/failure|error/i.test(status))              { icon = '✗'; color = t.ci.fail }
  else if (/pending|in_progress|queued/i.test(status)) { icon = '●'; color = t.ci.pending }
  else if (/cancelled|skipped/i.test(status))          { icon = '⊘'; color = t.ui.dim }
  else                                                  { icon = '○'; color = t.ui.dim }
  const name = sanitize(check.name || check.context || '').slice(0, 42)
  const isSelected = checkCursor !== null && checkCursor === index
  return (
    <Box key={`check-${index}`} paddingX={2} gap={1} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
      <Text color={color}>{icon}</Text>
      <Text color={isSelected ? t.ui.selected : t.ui.muted} wrap="truncate">{name}</Text>
      {isSelected && check.appName && <Text color={t.ui.dim}> ({sanitize(check.appName)})</Text>}
    </Box>
  )
}
