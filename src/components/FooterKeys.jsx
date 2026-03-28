/**
 * FooterKeys.jsx — footer key hint bar component.
 * Props: keys ([{key, label}])
 */

import React from 'react'
import { Box, Text } from 'ink'
import { t } from '../theme.js'

export function FooterKeys({ keys = [] }) {
  return (
    <Box paddingX={1} gap={2} flexWrap="wrap">
      {keys.map(({ key, label }) => (
        <Box key={key + label}>
          <Text color={t.ui.selected}>[{key}]</Text>
          <Text> </Text>
          <Text color={t.ui.muted}>{label}</Text>
        </Box>
      ))}
    </Box>
  )
}
