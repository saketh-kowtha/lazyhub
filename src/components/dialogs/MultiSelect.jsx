/**
 * MultiSelect.jsx — multi-select checklist with virtual scrolling.
 * Renders only as many items as fit in the terminal — safe for large label/assignee lists.
 * Props: items ([{id, name, color?, selected?}]), onSubmit(selectedIds[]), onCancel()
 */

import React, { useState, useMemo } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { useTheme } from '../../theme.js'
import { useVirtualList } from '../../hooks/useVirtualList.js'
import { useKeyScope } from '../../keyscope.js'

export function MultiSelect({ items = [], onSubmit, onCancel, title }) {
  useKeyScope('dialog')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const [query, setQuery] = useState('')
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

  // Chrome: border(2) + filter-row(1) + footer(1) = 4; +2 safety
  const listHeight = Math.max(3, (stdout?.rows || 24) - 6)

  const { cursor, scrollOffset, visibleItems, moveCursor, jumpTop, jumpBottom,
          canScrollUp, canScrollDown, setCursor, setScrollOffset } =
    useVirtualList({ items: filtered, height: listHeight })

  const toggleCurrent = () => {
    const item = filtered[cursor]
    if (!item) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    })
  }

  useInput((input, key) => {
    if (key.escape)    { onCancel(); return }
    if (key.return)    { onSubmit(Array.from(selected)); return }
    if (key.upArrow)   { moveCursor(cursor - 1); return }
    if (key.downArrow) { moveCursor(cursor + 1); return }
    // Ctrl+g / Ctrl+G jump to top/bottom — plain g/G are reserved for typing
    // into the filter (e.g. label names like "bug", "enhancement").
    if (key.ctrl && input === 'g') { jumpTop();    return }
    if (key.ctrl && input === 'G') { jumpBottom(); return }
    if (input === ' ') { toggleCurrent(); return }
    if (key.backspace || key.delete) {
      setQuery(q => q.slice(0, -1)); setCursor(0); setScrollOffset(0); return
    }
    if (input && !key.ctrl && !key.meta) {
      setQuery(q => q + input); setCursor(0); setScrollOffset(0)
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
      {title && (
        <Box marginBottom={1}>
          <Text color={t.ui.selected} bold>{title}</Text>
        </Box>
      )}
      {/* Filter row */}
      <Box marginBottom={1} justifyContent="space-between">
        <Box>
          <Text color={t.ui.muted}>Filter: </Text>
          <Text color={t.ui.selected}>{query}</Text>
          <Text color={t.ui.dim}>█</Text>
        </Box>
        <Text color={t.ui.dim}>
          {filtered.length > 0 ? `${cursor + 1}/${filtered.length}` : '0'}
          {canScrollUp   ? ' ↑' : '  '}
          {canScrollDown ? '↓' : ' '}
        </Text>
      </Box>

      {/* Virtualised list */}
      {visibleItems.length === 0 ? (
        <Text color={t.ui.muted}>  No items</Text>
      ) : (
        visibleItems.map((item, i) => {
          const isSelected = selected.has(item.id)
          const isCursor   = scrollOffset + i === cursor
          return (
            <Box key={item.id ?? i}>
              <Text color={isCursor   ? t.ui.selected : t.ui.muted}>{isCursor ? '▶ ' : '  '}</Text>
              <Text color={isSelected ? t.ui.selected : t.ui.muted}>{isSelected ? '◉' : '○'} </Text>
              <Text color={isCursor   ? t.ui.selected : undefined} wrap="truncate">
                {item.color ? `● ${item.name}` : item.name}
              </Text>
            </Box>
          )
        })
      )}

      <Box marginTop={1}>
        <Text color={t.ui.dim}>[type] filter  [↑↓] nav  [Ctrl+g/G] top/bot  [Space] toggle  [Enter] confirm  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}
