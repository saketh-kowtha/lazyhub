/**
 * useTerminalSize: the single source of truth for the terminal's size.
 *
 * Subscribes to the stdout `resize` event and re-renders the caller with the new
 * `{ columns, rows }`, trailing-debounced so a drag-resize (or a multiplexer
 * relaying a burst of SIGWINCH) produces one render, not dozens. When the size
 * changes it first wipes the screen, so cells the previous frame drew outside
 * the new geometry (or that the terminal reflowed) never survive as stale text.
 *
 * Ink re-lays-out on resize by itself, but React state derived from
 * `stdout.columns` (sidebar width, list height, footer fit) is only refreshed by
 * a React render, which Ink does not trigger. Components must read the size from
 * `useLayout()` / this hook rather than caching `stdout.columns`.
 */

import { useEffect, useRef, useState } from 'react'
import { useStdout } from 'ink'

const RESIZE_DEBOUNCE_MS = 40
const CLEAR_SCREEN = '\x1b[2J\x1b[3J\x1b[H'
// Ink repaints synchronously on `resize`, with the previous React size, before our debounced
// state update lands. That one stale frame is wider/taller than the terminal; with auto-wrap
// (DECAWM) off the terminal clips it instead of wrapping it into garbage. Wrap is turned back
// on once the correct frame has been drawn.
const WRAP_OFF = '\x1b[?7l'
const WRAP_ON = '\x1b[?7h'
const WRAP_RESTORE_MS = 120

/** @param {{ columns?: number, rows?: number } | undefined} stdout */
function readTerminalSize(stdout) {
  return { columns: stdout?.columns || 80, rows: stdout?.rows || 24 }
}

/**
 * @param {{ debounceMs?: number }} [opts]
 * @returns {{ columns: number, rows: number }}
 */
export function useTerminalSize({ debounceMs = RESIZE_DEBOUNCE_MS } = {}) {
  const { stdout } = useStdout()
  const [size, setSize] = useState(() => readTerminalSize(stdout))
  const last = useRef(size)

  useEffect(() => {
    if (!stdout || typeof stdout.on !== 'function') return undefined
    const tty = Boolean(stdout.isTTY)
    const emit = seq => { if (tty) { try { stdout.write(seq) } catch { /* closed stream */ } } }
    let timer
    let wrapTimer
    const apply = () => {
      const next = readTerminalSize(stdout)
      if (last.current.columns !== next.columns || last.current.rows !== next.rows) {
        last.current = next
        emit(CLEAR_SCREEN)
        setSize(next)
      }
      clearTimeout(wrapTimer)
      wrapTimer = setTimeout(() => emit(WRAP_ON), WRAP_RESTORE_MS)
    }
    const onResize = () => {
      emit(WRAP_OFF)
      clearTimeout(wrapTimer)
      clearTimeout(timer)
      timer = setTimeout(apply, debounceMs)
    }
    // Run before Ink's own resize handler so the stale frame it draws is clipped, not wrapped.
    const subscribe = stdout.prependListener ?? stdout.on
    subscribe.call(stdout, 'resize', onResize)
    // The size may have changed between the first render and this effect.
    const initial = readTerminalSize(stdout)
    if (initial.columns !== last.current.columns || initial.rows !== last.current.rows) apply()
    return () => {
      clearTimeout(timer)
      clearTimeout(wrapTimer)
      stdout.off?.('resize', onResize)
      emit(WRAP_ON)
    }
  }, [stdout, debounceMs])

  return size
}
