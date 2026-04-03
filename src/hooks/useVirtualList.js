/**
 * src/hooks/useVirtualList.js
 *
 * Shared virtual-scroll hook used by every list/dialog in the app.
 * Renders only the visible window — safe for repos with tens of thousands of items.
 *
 * Usage:
 *   const { cursor, scrollOffset, visibleItems, moveCursor, jumpTop, jumpBottom } =
 *     useVirtualList({ items, height })
 *
 *   // In JSX:
 *   visibleItems.map((item, i) => {
 *     const isSelected = scrollOffset + i === cursor
 *     ...
 *   })
 */

import { useState, useCallback, useEffect } from 'react'

/**
 * Virtual-scroll hook: returns only the visible window of items.
 * @param {object} opts
 * @param {Array}  opts.items
 * @param {number} opts.height
 * @param {number} [opts.initialCursor]
 * @param {number} [opts.initialScrollOffset]
 */
export function useVirtualList({ items, height, initialCursor = 0, initialScrollOffset = 0 }) {
  const count = items.length

  const [cursor,      setCursor]      = useState(() => Math.min(initialCursor, Math.max(0, count - 1)))
  const [scrollOffset, setScrollOffset] = useState(initialScrollOffset)

  // Clamp cursor + offset when items array changes length (filter, refresh, etc.)
  useEffect(() => {
    if (count === 0) { setCursor(0); setScrollOffset(0); return }
    setCursor(c      => Math.min(c, count - 1))
    setScrollOffset(s => Math.max(0, Math.min(s, Math.max(0, count - height))))
  }, [count, height])

  /** Move cursor to absolute index `next`, auto-scrolling the window. */
  const moveCursor = useCallback((next) => {
    if (count === 0) return
    const clamped = Math.max(0, Math.min(count - 1, next))
    setCursor(clamped)
    setScrollOffset(prev => {
      if (clamped < prev)              return clamped
      if (clamped >= prev + height)    return Math.max(0, clamped - height + 1)
      return prev
    })
  }, [count, height])

  const jumpTop = useCallback(() => {
    setCursor(0)
    setScrollOffset(0)
  }, [])

  const jumpBottom = useCallback(() => {
    if (!count) return
    const last = count - 1
    setCursor(last)
    setScrollOffset(Math.max(0, last - height + 1))
  }, [count, height])

  // Ensure offset never drifts out of range (height change, e.g. terminal resize)
  const safeOffset    = Math.max(0, Math.min(scrollOffset, Math.max(0, count - height)))
  const visibleItems  = items.slice(safeOffset, safeOffset + height)
  const canScrollUp   = safeOffset > 0
  const canScrollDown = safeOffset + height < count

  return {
    cursor,
    scrollOffset: safeOffset,
    visibleItems,
    moveCursor,
    jumpTop,
    jumpBottom,
    canScrollUp,
    canScrollDown,
    // raw setters for special cases (e.g. reset cursor on query change)
    setCursor,
    setScrollOffset,
  }
}
