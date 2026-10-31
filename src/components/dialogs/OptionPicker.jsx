/**
 * OptionPicker.jsx — single-select option picker with virtual scrolling.
 * Props: options ([{value, label, description?}]), onSubmit(value), onCancel(), title?, promptText?
 *   initialIndex? - option under the cursor when the picker opens (the safe default).
 *   promptKey?    - with promptText: Enter submits the highlighted option at once, and this key
 *                   opens the optional text prompt first (e.g. a merge commit message).
 *                   Without it, Enter on any option opens the prompt (older behaviour).
 */

import React, { useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { useTheme } from '../../theme.js'
import { TextInput } from '../../utils.js'
import { useVirtualList } from '../../hooks/useVirtualList.js'
import { useKeyScope } from '../../keyscope.js'
import { matchesAction } from '../../config/actions.js'

export function OptionPicker({ options = [], onSubmit, onCancel, title, promptText, initialIndex = 0, promptKey = '' }) {
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
    useVirtualList({ items: options, height: listHeight, initialCursor: initialIndex })

  useInput((input, key) => {
    if (step === 'pick') {
      if (matchesAction('dialog.cancel', input, key)) { onCancel(); return }
      if (matchesAction('dialog.up', input, key)) { moveCursor(cursor - 1); return }
      if (matchesAction('dialog.down', input, key)) { moveCursor(cursor + 1); return }
      if (matchesAction('dialog.top', input, key)) { jumpTop();    return }
      if (matchesAction('dialog.bottom', input, key)) { jumpBottom(); return }
      if (promptKey && promptText && input === promptKey) {
        const val = options[cursor]?.value
        if (val == null || options[cursor]?.skipPrompt) return
        setPickedValue(val); setStep('text')
        return
      }
      if (matchesAction('dialog.confirm', input, key)) {
        const val = options[cursor]?.value
        if (val == null) return
        if (promptText && !promptKey && !options[cursor]?.skipPrompt) { setPickedValue(val); setStep('text') }
        else            { onSubmit(val) }
        return
      }
    } else if (step === 'text') {
      if (matchesAction('dialog.cancel', input, key)) { onCancel(); return }
    }
  })

  if (step === 'text') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
        {title && (
          <Box marginBottom={1}>
            <Text color={t.ui.selected} bold>{title}</Text>
          </Box>
        )}
        <Box marginBottom={1}>
          <Text color={t.ui.selected} bold>Selected: </Text>
          <Text>{options.find(o => o.value === pickedValue)?.label ?? pickedValue}</Text>
        </Box>
        <Text color={t.ui.muted}>{promptText}:</Text>
        <Box borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
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
        <Text color={t.ui.dim}>
          {promptKey && promptText
            ? `[j/k] choose  [Enter] ${options[cursor]?.label ?? 'select'}  [${promptKey}] add message  [Esc] cancel`
            : '[j/k] navigate  [g/G] top/bottom  [Enter] select  [Esc] cancel'}
        </Text>
      </Box>
    </Box>
  )
}
