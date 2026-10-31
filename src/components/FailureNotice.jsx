/**
 * FailureNotice.jsx — one plain-language failure (#313): glyph + cause, what is
 * and is not affected, and the exact fix as a literal command. Fed by
 * classifyGhFailure(); text is already scrubbed and sanitized there.
 * Mockup: docs/mockups/day-one-errors.md.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'
import { failureGlyph } from '../executor.js'
import { firstActionKey } from '../config/actions.js'

/**
 * @param {object} props
 * @param {import('../executor/classify.js').Failure} props.failure
 * @param {{repo: string, reason: string, fix: string|null}[]} [props.failedRepos]  partial-data rows
 * @param {boolean} [props.compact]  cause line only, for a repeat of a notice already shown on this screen (#469)
 */
export function FailureNotice({ failure, failedRepos = [], compact = false }) {
  const { t } = useTheme()
  const color = failure.tone === 'blocked' ? t.ci.fail : failure.tone === 'offline' ? t.ui.dim : t.ci.pending
  if (compact) {
    return <Text color={color} bold>{failureGlyph(failure.tone)} {failure.cause}</Text>
  }
  return (
    <Box flexDirection="column">
      <Text color={color} bold>{failureGlyph(failure.tone)} {failure.cause}</Text>
      {failedRepos.map(r => (
        <React.Fragment key={r.repo}><Text color={t.ui.muted}>{`    ${r.repo}  ${r.reason}${r.fix ? `  (${r.fix})` : ''}`}</Text></React.Fragment>
      ))}
      {failure.notes.map(n => <React.Fragment key={n}><Text color={t.ui.muted}>{`  ${n}`}</Text></React.Fragment>)}
      {failure.fix && (
        <Text color={t.ui.muted}>{'  Fix:  '}<Text color={t.ui.selected} bold>{failure.fix}</Text></Text>
      )}
      {failure.fixHint && <Text color={t.ui.muted}>{`  ${failure.fixHint.replace('{refresh-key}', firstActionKey('list.refresh', 'r'))}`}</Text>}
    </Box>
  )
}
