/** TooSmall.jsx — shown instead of a broken frame when the terminal is below the minimum size. */

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'

export function TooSmall({ cols, rows, minCols, minRows }) {
  const { t } = useTheme()
  return (
    <Box flexDirection="column" height={rows} width={cols} overflow="hidden" justifyContent="center" alignItems="center">
      <Text color={t.ci.fail} bold wrap="truncate">Terminal too small</Text>
      <Text color={t.ui.muted} wrap="truncate">needs {minCols}x{minRows}</Text>
      <Text color={t.ui.dim} wrap="truncate">now {cols}x{rows}</Text>
    </Box>
  )
}
