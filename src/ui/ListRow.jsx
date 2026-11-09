/**
 * src/ui/ListRow.jsx — the shared list row frame (R8, #486; #460).
 * One line, a gutter glyph that marks the selected row without relying on colour (so the
 * cursor survives NO_COLOR), and the selected background. Cells are passed as children and
 * decide their own colour from `selected`.
 */

import React from 'react'
import { Box, Text } from 'ink'
import { useTheme } from '../theme.js'

export const SELECTION_GLYPH = '▎'

/** @param {{ selected: boolean, children?: React.ReactNode, key?: React.Key }} props */
export function ListRow({ selected, children }) {
  const { t } = useTheme()
  return (
    <Box paddingX={1} height={1} backgroundColor={selected ? t.ui.headerBg : undefined}>
      <Text color={selected ? t.ui.selected : undefined}>{selected ? SELECTION_GLYPH : ' '}</Text>
      {children}
    </Box>
  )
}
