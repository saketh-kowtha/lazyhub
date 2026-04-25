/**
 * FooterKeys.jsx — footer key hint bar.
 */

import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../theme.js'

export function FooterKeys({ keys = [], hidden = false }) {
  if (hidden) return null
  const { t } = useTheme()
  const { stdout } = useStdout()
  const termWidth = stdout?.columns || 80

  const helpKey = keys.find(k => k.key === '?')
  const regularKeys = keys.filter(k => k.key !== '?')

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={t.ui.dim}>{'─'.repeat(termWidth)}</Text>
      </Box>
      <Box paddingX={1} justifyContent="space-between">
        <Box gap={0} flexWrap="wrap">
          {regularKeys.map(({ key, label }, i) => (
            <Box key={key + label} gap={0}>
              {i > 0 && <Text color={t.ui.dim}> │ </Text>}
              <Text color={t.ui.selected} bold>{key}</Text>
              <Text color={t.ui.dim}> {label}</Text>
            </Box>
          ))}
        </Box>
        {helpKey && (
          <Box gap={0}>
            <Text color={t.ui.dim}>│ </Text>
            <Text color={t.ui.selected} bold>{helpKey.key}</Text>
            <Text color={t.ui.dim}> {helpKey.label}</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
