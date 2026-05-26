/**
 * FooterKeys.jsx — footer key hint bar.
 * Keys shape: { key, label, group? }
 * When group numbers present, renders groups separated by ┊ (U+250A).
 * Falls back to plain │ separators when no groups defined.
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

  // Detect if caller uses groups
  const hasGroups = regularKeys.some(k => k.group != null)

  const renderKey = (k, i, isFirst) => (
    <Box key={k.key + k.label} gap={0}>
      {!isFirst && <Text color={t.ui.dim}> │ </Text>}
      <Text color={t.ui.selected} bold>{k.key}</Text>
      <Text color={t.ui.dim}> {k.label}</Text>
    </Box>
  )

  const renderGrouped = () => {
    // Split into groups preserving order
    const groups = []
    const seen = new Map()
    for (const k of regularKeys) {
      const g = k.group ?? 1
      if (!seen.has(g)) { seen.set(g, []); groups.push(seen.get(g)) }
      seen.get(g).push(k)
    }
    return groups.map((grp, gi) => (
      <Box key={gi} gap={0}>
        {gi > 0 && <Text color={t.ui.dim}>  ┊  </Text>}
        {grp.map((k, i) => (
          <Box key={k.key + k.label} gap={0}>
            {i > 0 && <Text color={t.ui.dim}> │ </Text>}
            <Text color={t.ui.selected} bold>{k.key}</Text>
            <Text color={t.ui.dim}> {k.label}</Text>
          </Box>
        ))}
      </Box>
    ))
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={t.ui.dim}>{'─'.repeat(termWidth)}</Text>
      </Box>
      <Box paddingX={1} justifyContent="space-between">
        <Box gap={0} flexWrap="wrap">
          {hasGroups
            ? renderGrouped()
            : regularKeys.map((k, i) => renderKey(k, i, i === 0))
          }
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
