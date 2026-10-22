/**
 * src/ui/WhichKey.jsx — popup listing the valid continuations of a prefix key.
 *
 * Shown by app.jsx while a prefix (`g`) is armed. Items come from the action
 * registry (prefixContinuations), so the list is contextual and follows user
 * rebinds. It floats above the footer via Popover, so nothing reflows.
 */

import React from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../theme/index.js'
import { Popover } from './Popover.jsx'

const COLUMN_WIDTH = 26

/**
 * @param {object} props
 * @param {string} props.prefix the armed prefix key
 * @param {{key: string, label: string}[]} props.items continuations to list
 * @param {() => void} props.onClose dismiss (Esc)
 * @returns {import('react').ReactElement} popup
 */
export function WhichKey({ prefix, items, onClose }) {
  const { scheme } = useTheme()
  const { stdout } = useStdout()
  const termCols = stdout?.columns || 80
  const termRows = stdout?.rows || 24

  const perRow = Math.max(1, Math.min(2, Math.floor((termCols - 8) / COLUMN_WIDTH)))
  const rows = []
  for (let i = 0; i < items.length; i += perRow) rows.push(items.slice(i, i + perRow))

  const width = Math.min(termCols - 2, perRow * COLUMN_WIDTH + 4)
  const height = rows.length + 4 // border (2) + header + rule
  const anchor = { x: 1, y: Math.max(0, termRows - height - 2), width: 0, height: 0 }

  return (
    <Popover
      anchor={anchor}
      popoverWidth={width}
      popoverHeight={height}
      termCols={termCols}
      termRows={termRows}
      preferredSide="below"
      onClose={onClose}
    >
      <Box flexDirection="column" borderStyle="round" borderColor={scheme.border.focused} paddingX={1} width={width} height={height}>
        <Box justifyContent="space-between">
          <Text color={scheme.fg.default} bold>{prefix}  go to / prefix</Text>
          <Text color={scheme.fg.subtle}>Esc cancel</Text>
        </Box>
        {rows.map((row, i) => (
          <Box key={i}>
            {row.map(item => (
              <Box key={item.key} width={COLUMN_WIDTH}>
                <Text color={scheme.accent.secondary} bold>{item.key}</Text>
                <Text color={scheme.fg.muted}>  {item.label}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Popover>
  )
}
