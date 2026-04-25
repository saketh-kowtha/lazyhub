/**
 * FuzzySearch.jsx — fuzzy search dialog with virtual scrolling.
 * Renders only as many items as fit in the terminal — safe for thousands of items.
 * Props: items, onSubmit(item), onCancel(), searchFields
 */

import React, { useMemo } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { useTheme } from '../../theme.js'
import { TextInput } from '../../utils.js'
import { useVirtualList } from '../../hooks/useVirtualList.js'
import { useState } from 'react'
import { useKeyScope } from '../../keyscope.js'

function matchesQuery(item, query, searchFields) {
  if (!query) return true
  const q = query.toLowerCase()
  return searchFields.some(field => String(item[field] ?? '').toLowerCase().includes(q))
}

function getDisplayText(item, searchFields) {
  if (item.title != null) return `${item.number != null ? '#' + item.number + ' ' : ''}${item.title}`
  if (item.name  != null) return item.name
  return String(item[searchFields[0]] ?? '')
}

export function FuzzySearch({ items = [], onSubmit, onCancel, searchFields = ['title', 'name'] }) {
  useKeyScope('dialog')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    return items.filter(item => matchesQuery(item, query, searchFields))
  }, [items, query, searchFields])

  // Chrome: border(2) + header-row(1) + margin(1) + footer(1) = 5; leave 2 extra for safety
  const listHeight = Math.max(3, (stdout?.rows || 24) - 7)

  const { cursor, scrollOffset, visibleItems, moveCursor, jumpTop, jumpBottom,
          canScrollUp, canScrollDown, setCursor, setScrollOffset } =
    useVirtualList({ items: filtered, height: listHeight })

  useInput((input, key) => {
    if (key.escape) { onCancel(); return }
    if (key.return) {
      if (filtered[cursor]) onSubmit(filtered[cursor])
      return
    }
    if (key.upArrow   || (key.ctrl && input === 'k')) { moveCursor(cursor - 1); return }
    if (key.downArrow || (key.ctrl && input === 'j')) { moveCursor(cursor + 1); return }
    // Plain g/G would hijack characters typed into the search query (e.g.
    // filtering PRs by "bug" or author "greg"). Scope jumps to Ctrl+g / Ctrl+G.
    if (key.ctrl && input === 'g') { jumpTop();    return }
    if (key.ctrl && input === 'G') { jumpBottom(); return }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
      {/* Header */}
      <Box marginBottom={1} justifyContent="space-between">
        <Box>
          <Text color={t.ui.muted}>Search: </Text>
          <TextInput
            value={query}
            onChange={(v) => { setQuery(v); setCursor(0); setScrollOffset(0) }}
            focus={true}
          />
        </Box>
        <Text color={t.ui.dim}>
          {filtered.length > 0 ? `${cursor + 1}/${filtered.length}` : '0'}
          {canScrollUp   ? ' ↑' : '  '}
          {canScrollDown ? '↓' : ' '}
        </Text>
      </Box>

      {/* Virtualised list */}
      {visibleItems.length === 0 ? (
        <Text color={t.ui.muted}>  No results</Text>
      ) : (
        visibleItems.map((item, i) => {
          const isSelected = scrollOffset + i === cursor
          const display = getDisplayText(item, searchFields)
          return (
            <Box key={item.id ?? item.number ?? i}>
              <Text color={isSelected ? t.ui.selected : t.ui.muted}>{isSelected ? '▶ ' : '  '}</Text>
              <Text color={isSelected ? t.ui.selected : undefined} wrap="truncate">{display}</Text>
            </Box>
          )
        })
      )}

      <Box marginTop={1}>
        <Text color={t.ui.dim}>[↑↓ / Ctrl+jk] navigate  [Ctrl+g/G] top/bottom  [Enter] select  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}
