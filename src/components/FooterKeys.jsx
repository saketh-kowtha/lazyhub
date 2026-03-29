/**
 * FooterKeys.jsx — footer key hint bar component.
 * Props: keys ([{key, label}])
 */

import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../theme.js'

const GROUP_SIZE = 3

export function FooterKeys({ keys = [] }) {
  const { t } = useTheme()
  const { stdout } = useStdout()
  const termWidth = stdout?.columns || 80
  const borderLine = '─'.repeat(termWidth)

  // Separate [?] help key from the rest
  const helpKey = keys.find(k => k.key === '?')
  const regularKeys = keys.filter(k => k.key !== '?')

  // Build grouped items: insert dim '·' separator every GROUP_SIZE keys
  const groupedItems = []
  regularKeys.forEach(({ key, label }, i) => {
    if (i > 0 && i % GROUP_SIZE === 0) {
      groupedItems.push({ type: 'sep', id: `sep-${i}` })
    }
    groupedItems.push({ type: 'key', key, label })
  })

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={t.ui.dim}>{borderLine}</Text>
      </Box>
      <Box paddingX={1} justifyContent="space-between">
        <Box gap={1} flexWrap="wrap">
          {groupedItems.map((item) => {
            if (item.type === 'sep') {
              return (
                <Box key={item.id}>
                  <Text color={t.ui.dim}>  ·  </Text>
                </Box>
              )
            }
            return (
              <Box key={item.key + item.label}>
                <Text color={t.ui.selected}>[{item.key}]</Text>
                <Text> </Text>
                <Text color={t.ui.muted}>{item.label}</Text>
              </Box>
            )
          })}
        </Box>
        {helpKey && (
          <Box>
            <Text color={t.ui.selected}>[{helpKey.key}]</Text>
            <Text> </Text>
            <Text color={t.ui.muted}>{helpKey.label}</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
