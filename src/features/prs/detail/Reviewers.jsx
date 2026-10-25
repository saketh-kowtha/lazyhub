/** PR detail reviewer states and pending requests. */
import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../../theme.js'
import { sanitize } from '../../../utils.js'

function reviewStatusIcon(state, t) {
  switch (state) {
    case 'APPROVED':          return { icon: '✓', color: t.ci.pass }
    case 'CHANGES_REQUESTED': return { icon: '✗', color: t.ci.fail }
    case 'COMMENTED':         return { icon: '●', color: t.ui.muted }
    default:                  return { icon: '○', color: t.ui.dim }
  }
}

export function ReviewersHeading() {
  const { t } = useTheme()
  return (
    <Box key="rev-hdr" paddingX={1}>
      <Text color={t.ui.dim} bold>Reviewers</Text>
    </Box>
  )
}

/** @param {{reviewer: {login: string, state: string}}} props */
export function ReviewerRow({ reviewer }) {
  const { t } = useTheme()
  const rs = reviewStatusIcon(reviewer.state, t)
  return (
    <Box key={`rev-${reviewer.login}`} paddingX={2} gap={1}>
      <Text color={rs.color}>{rs.icon}</Text>
      <Text color={t.ui.muted}>{sanitize(reviewer.login)}</Text>
      {reviewer.state !== 'PENDING' && (
        <Text color={rs.color} dimColor>{sanitize(reviewer.state.toLowerCase().replace(/_/g, ' '))}</Text>
      )}
    </Box>
  )
}
