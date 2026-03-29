/**
 * ConfirmDialog.jsx — confirmation dialog primitive.
 * Props: message, destructive (bool), onConfirm(), onCancel(), requireText? (string to type)
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../../theme.js'

export function ConfirmDialog({ message, destructive = false, onConfirm, onCancel, requireText }) {
  const { t } = useTheme()
  const [cursor, setCursor] = useState(1) // 0 = Yes, 1 = No (default No for safety)
  const [typed, setTyped] = useState('')

  const borderColor = destructive ? '#f85149' : t.ui.selected
  const yesColor = destructive ? '#f85149' : t.ui.selected
  const canConfirm = !requireText || typed === requireText

  useInput((input, key) => {
    if (key.escape) { onCancel(); return }
    if (key.leftArrow) { setCursor(0); return }
    if (key.rightArrow) { setCursor(1); return }
    if (key.upArrow || input === 'k') { setCursor(0); return }
    if (key.downArrow || input === 'j') { setCursor(1); return }
    if (key.return) {
      if (cursor === 0 && canConfirm) {
        onConfirm()
      } else {
        onCancel()
      }
      return
    }
    if (requireText) {
      if (key.backspace || key.delete) {
        setTyped(t => t.slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setTyped(t => t + input)
      }
    }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={borderColor} paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text color={destructive ? '#f85149' : t.ui.selected} bold>
          {destructive ? '⚠ ' : 'ℹ '}
          {message}
        </Text>
      </Box>
      {requireText && (
        <Box marginBottom={1} flexDirection="column">
          <Text color={t.ui.muted}>Type <Text bold color={t.ui.selected}>{requireText}</Text> to confirm:</Text>
          <Box>
            <Text color={canConfirm ? '#3fb950' : '#f85149'}>{typed}</Text>
            <Text color={t.ui.dim}>█</Text>
          </Box>
        </Box>
      )}
      <Box gap={4}>
        <Box>
          <Text color={cursor === 0 ? yesColor : t.ui.muted} bold={cursor === 0}>
            {cursor === 0 ? '▶ ' : '  '}
          </Text>
          <Text
            color={cursor === 0 ? yesColor : t.ui.muted}
            bold={cursor === 0}
          >
            Yes
          </Text>
          {requireText && !canConfirm && cursor === 0 && (
            <Text color={t.ui.dim}> (type to confirm)</Text>
          )}
        </Box>
        <Box>
          <Text color={cursor === 1 ? '#3fb950' : t.ui.muted} bold={cursor === 1}>
            {cursor === 1 ? '▶ ' : '  '}
          </Text>
          <Text color={cursor === 1 ? '#3fb950' : t.ui.muted} bold={cursor === 1}>
            No
          </Text>
        </Box>
      </Box>
      <Box marginTop={1}>
        <Text color={t.ui.dim}>[←→ / j/k] choose  [Enter] confirm  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}
