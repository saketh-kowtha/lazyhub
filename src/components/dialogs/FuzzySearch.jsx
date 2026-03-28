/**
 * FuzzySearch.jsx — fuzzy search dialog primitive.
 * Props: items, onSubmit(item), onCancel(), searchFields
 */

import React, { useState, useMemo } from 'react'
import { Box, Text, useInput } from 'ink'
import chalk from 'chalk'
import { useTheme } from '../../theme.js'
import { TextInput } from '../../utils.js'

// ... (highlightMatch and matchesQuery)

export function FuzzySearch({ items = [], onSubmit, onCancel, searchFields = ['title', 'name'] }) {
  const { t } = useTheme()
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)

  const filtered = useMemo(() => {
    return items.filter(item => matchesQuery(item, query, searchFields))
  }, [items, query, searchFields])

  useInput((input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    if (key.return) {
      if (filtered[cursor]) onSubmit(filtered[cursor])
      return
    }
    if (key.upArrow || (key.ctrl && input === 'k')) {
      setCursor(c => Math.max(0, c - 1))
      return
    }
    if (key.downArrow || (key.ctrl && input === 'j')) {
      setCursor(c => Math.min(filtered.length - 1, c + 1))
      return
    }
    // Note: backspace and character input are now handled by TextInput
  })

  const visibleItems = filtered.slice(0, 15)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
      <Box marginBottom={1}>
        <Text color={t.ui.muted}>Search: </Text>
        <TextInput
          value={query}
          onChange={(v) => { setQuery(v); setCursor(0) }}
          focus={true}
        />
      </Box>
      {visibleItems.length === 0 && (
        <Text color={t.ui.muted}>  No results</Text>
      )}
      {visibleItems.map((item, i) => {
        const display = getDisplayText(item, searchFields)
        const highlighted = highlightMatch(display, query)
        const isSelected = i === cursor
        return (
          <Box key={item.id || item.number || i}>
            <Text color={isSelected ? t.ui.selected : t.ui.muted}>
              {isSelected ? '▶ ' : '  '}
            </Text>
            <Text color={isSelected ? t.ui.selected : undefined}>
              {highlighted}
            </Text>
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text color={t.ui.dim}>[↑↓] navigate  [Enter] select  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}
