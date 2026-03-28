/**
 * FuzzySearch.jsx — fuzzy search dialog primitive.
 * Props: items, onSubmit(item), onCancel(), searchFields
 */

import React, { useState, useMemo } from 'react'
import { Box, Text, useInput } from 'ink'
import chalk from 'chalk'
import { t } from '../../theme.js'
import { TextInput } from '../../utils.js'

function highlightMatch(str, query) {
  if (!query) return str
  const lowerStr = str.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const idx = lowerStr.indexOf(lowerQuery)
  if (idx === -1) return str
  const before = str.slice(0, idx)
  const match = str.slice(idx, idx + query.length)
  const after = str.slice(idx + query.length)
  return before + chalk.bold.white(match) + after
}

function matchesQuery(item, query, searchFields) {
  if (!query) return true
  const lq = query.toLowerCase()
  for (const field of searchFields) {
    const val = item[field]
    if (val != null && String(val).toLowerCase().includes(lq)) return true
  }
  return false
}

function getDisplayText(item, searchFields) {
  const primary = item[searchFields[0]] || item.title || item.name || String(item)
  return String(primary)
}

export function FuzzySearch({ items = [], onSubmit, onCancel, searchFields = ['title', 'name'] }) {
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
