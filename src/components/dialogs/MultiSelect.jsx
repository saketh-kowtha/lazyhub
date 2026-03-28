/**
 * MultiSelect.jsx — multi-select checklist dialog primitive.
 * Props: items ([{id, name, color?, selected?}]), onSubmit(selectedIds[]), onCancel()
 */

import React, { useState, useMemo } from 'react'
import { Box, Text, useInput } from 'ink'
import { t } from '../../theme.js'

export function MultiSelect({ items = [], onSubmit, onCancel }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [selected, setSelected] = useState(() => {
    const s = new Set()
    items.forEach(item => { if (item.selected) s.add(item.id) })
    return s
  })

  const filtered = useMemo(() => {
    if (!query) return items
    const lq = query.toLowerCase()
    return items.filter(item => item.name.toLowerCase().includes(lq))
  }, [items, query])

  useInput((input, key) => {
    if (key.escape) { onCancel(); return }
    if (key.return) {
      onSubmit(Array.from(selected))
      return
    }
    if (key.upArrow) {
      setCursor(c => Math.max(0, c - 1))
      return
    }
    if (key.downArrow) {
      setCursor(c => Math.min(filtered.length - 1, c + 1))
      return
    }
    if (input === ' ') {
      const item = filtered[cursor]
      if (item) {
        setSelected(prev => {
          const next = new Set(prev)
          if (next.has(item.id)) next.delete(item.id)
          else next.add(item.id)
          return next
        })
      }
      return
    }
    if (key.backspace || key.delete) {
      setQuery(q => q.slice(0, -1))
      setCursor(0)
      return
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery(q => q + input)
      setCursor(0)
    }
  })

  const visibleItems = filtered.slice(0, 15)

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
      <Box marginBottom={1}>
        <Text color={t.ui.muted}>Filter: </Text>
        <Text color={t.ui.selected}>{query}</Text>
        <Text color={t.ui.dim}>█</Text>
      </Box>
      {visibleItems.length === 0 && (
        <Text color={t.ui.muted}>  No items</Text>
      )}
      {visibleItems.map((item, i) => {
        const isSelected = selected.has(item.id)
        const isCursor = i === cursor
        const checkbox = isSelected ? '◉' : '○'
        return (
          <Box key={item.id || i}>
            <Text color={isCursor ? t.ui.selected : t.ui.muted}>
              {isCursor ? '▶ ' : '  '}
            </Text>
            <Text color={isSelected ? t.ui.selected : t.ui.muted}>{checkbox} </Text>
            <Text color={isCursor ? t.ui.selected : undefined}>
              {item.color ? `● ${item.name}` : item.name}
            </Text>
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text color={t.ui.dim}>[Space] toggle  [Enter] confirm  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}
