// @ts-check

/**
 * A fixed-width (1 column) background-activity cell for a view's header or state line (#597, V4a).
 * It is always rendered, so a revalidate lights it up without moving anything. This is the local
 * stand-in until the shared indicator component (V5) lands on main; swap the body, keep the width.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../../theme.js'

/** @param {{ active?: boolean }} props */
export function FetchCell({ active = false }) {
  const { t } = useTheme()
  return (
    <Box width={1} flexShrink={0}>
      <Text color={t.ui.dim}>{active ? '⟳' : ' '}</Text>
    </Box>
  )
}
