/**
 * OptionPicker.jsx — single-select option picker with virtual scrolling.
 * Props: options ([{value, label, description?}]), onSubmit(value), onCancel(), title?, promptText?
 */

import React, { useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { useTheme } from '../../theme.js'
import { TextInput } from '../../utils.js'
import { useVirtualList } from '../../hooks/useVirtualList.js'
import { useKeyScope } from '../../keyscope.js'

export function OptionPicker({ options = [], onSubmit, onCancel, title, promptText }) {
  useKeyScope('dialog')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const [step, setStep] = useState('pick') // 'pick' | 'text'
  const [pickedValue, setPickedValue] = useState(null)
  const [textInput, setTextInput] = useState('')

  // Chrome: border(2) + optional title(2) + footer(2) = 6; options with descriptions use 2 rows each
  const rowsPerOption = options.some(o => o.description) ? 2 : 1
  const chrome  = 2 + (title ? 2 : 0) + 2
  const listHeight = Math.max(2, Math.floor(((stdout?.rows || 24) - chrome) / rowsPerOption))

  const { cursor, scrollOffset, visibleItems, moveCursor, jumpTop, jumpBottom,
          canScrollUp, canScrollDown } =
    useVirtualList({ items: options, height: listHeight })

  useInput((input, key) => {
    if (step === 'pick') {
      if (key.escape)    { onCancel(); return }
      if (key.upArrow   || input === 'k') { moveCursor(cursor - 1); return }
      if (key.downArrow || input === 'j') { moveCursor(cursor + 1); return }
      if (input === 'g') { jumpTop();    return }
      if (input === 'G') { jumpBottom(); return }
      if (key.return) {
        const val = options[cursor]?.value
        if (val == null) return
        if (promptText) { setPickedValue(val); setStep('text') }
        else            { onSubmit(val) }
        return
      }
    } else if (step === 'text') {
      if (key.escape) { onCancel(); return }
    }
  })

  if (step === 'text') {
    return (
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
        <Box marginBottom={1}>
          <Text color={t.ui.selected} bold>Selected: </Text>
          <Text>{options.find(o => o.value === pickedValue)?.label ?? pickedValue}</Text>
        </Box>
        <Box>
          <Text color={t.ui.muted}>{promptText}: </Text>
          <TextInput
            value={textInput}
            onChange={setTextInput}
            focus={true}
            onEnter={() => onSubmit({ value: pickedValue, text: textInput })}
          />
        </Box>
        <Box marginTop={1}>
          <Text color={t.ui.dim}>[Enter] confirm  [Esc] cancel</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
      {title && (
        <Box marginBottom={1} justifyContent="space-between">
          <Text color={t.ui.selected} bold>{title}</Text>
          {(canScrollUp || canScrollDown) && (
            <Text color={t.ui.dim}>
              {cursor + 1}/{options.length}
              {canScrollUp   ? ' ↑' : '  '}
              {canScrollDown ? '↓'  : ' '}
            </Text>
          )}
        </Box>
      )}

      {visibleItems.map((option, i) => {
        const isCursor = scrollOffset + i === cursor
        return (
          <Box key={option.value ?? i} flexDirection="column">
            <Box>
              <Text color={isCursor ? t.ui.selected : t.ui.muted}>{isCursor ? '▶ ' : '  '}</Text>
              <Text color={isCursor ? t.ui.selected : undefined} bold={isCursor}>{option.label}</Text>
            </Box>
            {option.description && (
              <Box marginLeft={4}>
                <Text color={t.ui.dim}>{option.description}</Text>
              </Box>
            )}
          </Box>
        )
      })}

      <Box marginTop={1}>
        <Text color={t.ui.dim}>[j/k] navigate  [g/G] top/bottom  [Enter] select  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}
