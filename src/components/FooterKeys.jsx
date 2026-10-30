/**
 * FooterKeys.jsx — footer key hint bar. Always exactly two rows (rule + one hint
 * line); it never wraps. When the hints do not fit the terminal width the
 * lowest-priority keys (the LAST ones in `keys`) are dropped first; `?` help is
 * kept for as long as there is any room, and a lone remaining hint is ellipsized.
 * Keys shape: { key, label, group? }. Groups render separated by ┊ (U+250A).
 */

import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../theme.js'
import { displayWidth, truncateEllipsis } from '../utils.js'

const SEP_IN_GROUP = ' │ '
const SEP_BETWEEN_GROUPS = '  ┊  '

const hintWidth = k => displayWidth(k.key) + 1 + displayWidth(k.label)

/** Display width of `keys` rendered with their separators. */
function rowWidth(keys) {
  let w = 0
  keys.forEach((k, i) => {
    if (i > 0) w += (k.group ?? 1) !== (keys[i - 1].group ?? 1) ? displayWidth(SEP_BETWEEN_GROUPS) : displayWidth(SEP_IN_GROUP)
    w += hintWidth(k)
  })
  return w
}

/**
 * Pick the hints that fit in `width` columns (pure; exported for tests).
 * @param {{key:string,label:string,group?:number}[]} keys in priority order, most important first
 * @param {number} width columns available for the whole line
 * @returns {{ regular: {key:string,label:string,group?:number}[], help: {key:string,label:string}|null }}
 */
export function fitFooterKeys(keys, width) {
  const help = keys.find(k => k.key === '?') || null
  let regular = keys.filter(k => k.key !== '?')
  const helpW = help ? 2 + hintWidth(help) + 1 : 0 // "│ ? help" plus a gap
  const budget = Math.max(0, width - helpW)
  while (regular.length > 1 && rowWidth(regular) > budget) regular = regular.slice(0, -1)
  if (regular.length === 1 && rowWidth(regular) > budget) {
    const k = regular[0]
    const room = budget - displayWidth(k.key) - 1
    regular = room >= 2 ? [{ ...k, label: truncateEllipsis(k.label, room) }] : []
  }
  // Not even one hint plus help fits: help alone is the most useful thing to show.
  return { regular, help: help && helpW <= width ? help : null }
}

export function FooterKeys({ keys = [], hidden = false }) {
  const { t } = useTheme()
  const { stdout } = useStdout()
  if (hidden) return null
  const termWidth = stdout?.columns || 80
  const { regular, help } = fitFooterKeys(keys, Math.max(0, termWidth - 2))

  return (
    <Box flexDirection="column" flexShrink={0}>
      <Text color={t.ui.dim} wrap="truncate">{'─'.repeat(termWidth)}</Text>
      <Box paddingX={1} justifyContent="space-between" height={1} overflow="hidden">
        <Text wrap="truncate">
          {regular.map((k, i) => {
            const sep = i === 0 ? '' : (k.group ?? 1) !== (regular[i - 1].group ?? 1) ? SEP_BETWEEN_GROUPS : SEP_IN_GROUP
            return (
              <React.Fragment key={k.key + k.label}>
                {sep && <Text color={t.ui.dim}>{sep}</Text>}
                <Text color={t.ui.selected} bold>{k.key}</Text>
                <Text color={t.ui.dim}> {k.label}</Text>
              </React.Fragment>
            )
          })}
        </Text>
        {help && (
          <Text wrap="truncate">
            <Text color={t.ui.dim}>│ </Text>
            <Text color={t.ui.selected} bold>{help.key}</Text>
            <Text color={t.ui.dim}> {help.label}</Text>
          </Text>
        )}
      </Box>
    </Box>
  )
}
