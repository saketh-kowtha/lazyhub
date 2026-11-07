/**
 * ui/row-layout.js -- the width contract for list rows (#512, #488 R10).
 *
 * A row is exactly one terminal line and never wider than its pane. Every row
 * gets its width from the pane (never from Yoga's guess about wide characters):
 * fixed cells keep their width, the title takes what is left, and optional
 * cells are dropped, never wrapped, when the pane is too narrow for them.
 */

import { displayWidth, inkSafe, truncateEllipsis } from '../utils.js'

/** Smallest title a row keeps before dropping an optional cell. */
export const MIN_TITLE_COLS = 14

/**
 * Width available to a pane's rows. The App passes `innerWidth`; a pane
 * rendered on its own falls back to the terminal width minus the pane border.
 * @param {number|undefined} innerWidth width from the App
 * @param {{columns?: number}|undefined} stdout Ink stdout
 * @returns {number} columns a row may use
 */
export function paneWidth(innerWidth, stdout) {
  if (innerWidth && innerWidth > 0) return innerWidth
  return Math.max(20, (stdout?.columns || 80) - 2)
}

/**
 * Plan a row: which optional cells fit, and how wide the title is.
 * @param {number} width columns the row may use, padding included
 * @param {{fixed: number, optional?: {key: string, width: number}[], minTitle?: number}} plan
 *   `fixed` columns are always drawn (padding, markers, number); `optional` cells are
 *   listed in drop order, first dropped first. A cell is kept only while the title
 *   keeps `minTitle` columns.
 * @returns {{titleWidth: number, show: Record<string, boolean>}} layout
 */
export function planRow(width, { fixed, optional = [], minTitle = MIN_TITLE_COLS }) {
  const show = Object.fromEntries(optional.map(cell => [cell.key, true]))
  let used = fixed + optional.reduce((sum, cell) => sum + cell.width, 0)
  for (const cell of optional) {
    if (width - used >= minTitle) break
    show[cell.key] = false
    used -= cell.width
  }
  return { titleWidth: Math.max(4, width - used), show }
}

/**
 * Terminal columns of cell text once it is made Ink-safe.
 * @param {string} text cell text
 * @returns {number} columns
 */
export function cellWidth(text) {
  return displayWidth(inkSafe(text))
}

/**
 * Fit text to exactly `width` terminal columns: cut with an ellipsis, then pad.
 * @param {string} text cell text
 * @param {number} width columns
 * @returns {string} text that takes exactly `width` columns
 */
export function fitCell(text, width) {
  if (width <= 0) return ''
  const safe = inkSafe(text)
  const out = displayWidth(safe) > width ? truncateEllipsis(safe, width) : safe
  return out + ' '.repeat(Math.max(0, width - displayWidth(out)))
}
