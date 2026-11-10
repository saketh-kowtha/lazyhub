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

/** Optional render probe (ROW-RENDER, #597): called once per ListRow render. Off (null) by default. */
let rowRenderProbe = null
/** @param {(() => void) | null} fn */
export function setRowRenderProbe(fn) { rowRenderProbe = fn }

/**
 * Memoised on `selected` and `children`. Children are fresh elements on every parent render, so the
 * real memo boundary is the row component that owns the cells (PRRow, IssueRow, NotificationRow...):
 * give it primitive or identity-stable props and ListRow only renders when that row does.
 * @param {{ selected: boolean, children?: React.ReactNode, key?: React.Key }} props
 */
export const ListRow = React.memo(function ListRow({ selected, children }) {
  const { t } = useTheme()
  if (rowRenderProbe) rowRenderProbe()
  return (
    <Box paddingX={1} height={1} backgroundColor={selected ? t.ui.headerBg : undefined}>
      <Text color={selected ? t.ui.selected : undefined}>{selected ? SELECTION_GLYPH : ' '}</Text>
      {children}
    </Box>
  )
})
