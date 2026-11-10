/**
 * src/hooks/useListController.js — one cursor/scroll/gg/G controller for a list pane (R8, #486).
 *
 * Built on `useVirtualList` (the window math) and adds what every pane used to hand-roll:
 * clamp-on-shrink with *selection memory* (when a refetch reorders or drops rows, the cursor
 * follows the same entity by id, or clamps onto a real row when it is gone), the `gg` two-key
 * jump with its timer cleaned up on unmount, `G`, and an empty-list guard.
 *
 * A pane calls `handleKey(input, key)` from its own key handler; it returns true when the
 * key was a navigation key and has been consumed:
 *
 *   const list = useListController({ items, height, getId: n => n.id })
 *   useKeymapInput((input, key) => { if (list.handleKey(input, key)) return; ... })
 */

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useVirtualList } from './useVirtualList.js'
import { firstActionKey, matchesAction } from '../config/actions.js'

const GG_WINDOW_MS = 400

/**
 * @template T
 * @param {object} opts
 * @param {T[]} opts.items
 * @param {number} opts.height rows visible at once
 * @param {(item: T) => string | number} [opts.getId] enables selection memory across refetches
 */
export function useListController({ items, height, getId }) {
  const v = useVirtualList({ items, height })
  const count = items.length
  // The first render after a shrink still holds the old cursor; never expose it.
  const cursor = count === 0 ? 0 : Math.min(v.cursor, count - 1)
  const selected = count === 0 ? undefined : items[cursor]
  // The window array keeps its identity while the cursor moves inside it.
  const { scrollOffset } = v
  const visibleItems = useMemo(() => items.slice(scrollOffset, scrollOffset + height), [items, scrollOffset, height])

  const idRef = useRef(/** @type {string | number | undefined} */ (undefined))
  const lastKeyRef = useRef(/** @type {string | null} */ (null))
  const timerRef = useRef(/** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined))
  useEffect(() => () => clearTimeout(timerRef.current), [])

  const { moveCursor: rawMove, jumpTop: rawTop, jumpBottom: rawBottom } = v
  // Callbacks handed to panes and rows must keep one identity while the cursor moves (#597), so
  // they read the latest values from this ref instead of closing over them. Assigned in render.
  const live = useRef(/** @type {any} */ (null))
  live.current = { items, count, getId, cursor, rawMove, rawTop, rawBottom }
  // The remembered id is set where the user moves (not re-derived after every render), so a
  // refetch that hands back new-but-equal rows, or reorders them, cannot fight the cursor.
  const remember = useCallback((idx) => {
    const { getId: gid, items: its, count: n } = live.current
    if (!gid) return
    const it = its[Math.max(0, Math.min(n - 1, idx))]
    idRef.current = it === undefined ? undefined : gid(it)
  }, [])
  const virtualMove = useCallback((idx) => { remember(idx); live.current.rawMove(idx) }, [remember])
  const jumpTop = useCallback(() => { remember(0); live.current.rawTop() }, [remember])
  const jumpBottom = useCallback(() => { remember(live.current.count - 1); live.current.rawBottom() }, [remember])
  // Selection memory: the remembered id is looked up in the new items.
  useEffect(() => {
    if (!getId || idRef.current === undefined) return
    const idx = items.findIndex(it => getId(it) === idRef.current)
    if (idx !== -1 && idx !== cursor) rawMove(idx)
    else if (idx === -1) idRef.current = undefined
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps
  // Nothing remembered yet (first rows, or the row left): remember what is selected now.
  useEffect(() => { if (getId && idRef.current === undefined && selected !== undefined) idRef.current = getId(selected) })

  /** @returns {boolean} true when the key was navigation and is consumed */
  const handleKey = useCallback((input, key) => {
    if (matchesAction('cursor.down', input, key)) { virtualMove(live.current.cursor + 1); return true }
    if (matchesAction('cursor.up', input, key)) { virtualMove(live.current.cursor - 1); return true }
    const top = firstActionKey('cursor.top', 'gg')[0]
    if (input === top) {
      if (lastKeyRef.current === top) {
        clearTimeout(timerRef.current)
        lastKeyRef.current = null
        jumpTop()
        return true
      }
      lastKeyRef.current = top
      timerRef.current = setTimeout(() => { lastKeyRef.current = null }, GG_WINDOW_MS)
      return true
    }
    lastKeyRef.current = null
    if (matchesAction('cursor.bottom', input, key)) { jumpBottom(); return true }
    return false
  }, [virtualMove, jumpTop, jumpBottom])

  return {
    cursor,
    scrollOffset: v.scrollOffset,
    visibleItems,
    selected,
    handleKey,
    moveTo: virtualMove,
    jumpTop,
    jumpBottom,
    canScrollUp: v.canScrollUp,
    canScrollDown: v.canScrollDown,
  }
}
