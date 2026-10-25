/** PR detail assignees and labels. */
import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../../theme.js'
import { sanitize } from '../../../utils.js'

/** @param {{assignees: Array<{login: string}>}} props */
export function AssigneesRow({ assignees }) {
  const { t } = useTheme()
  return (
    <Box key="assignees" paddingX={1} gap={1}>
      <Text color={t.ui.dim}>Assigned</Text>
      {assignees.map(a => (
        React.createElement(Text, { key: a.login, color: t.ui.muted }, sanitize(a.login))
      ))}
    </Box>
  )
}

/** @param {{labels: Array<{name: string, color: string}>}} props */
export function LabelsRow({ labels }) {
  const { t } = useTheme()
  return (
    <Box key="labels" paddingX={1} gap={1}>
      {labels.map(l => (
        <Box key={l.name} paddingX={1} borderStyle="round" borderColor={`#${l.color}`}>
          <Text color={`#${l.color}`}>{sanitize(l.name)}</Text>
        </Box>
      ))}
    </Box>
  )
}
