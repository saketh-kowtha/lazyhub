/**
 * OptionPicker.jsx — single-select option picker dialog primitive.
 * Props: options ([{value, label, description?}]), onSubmit(value), onCancel(), title?, promptText?
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { t } from '../../theme.js'

export function OptionPicker({ options = [], onSubmit, onCancel, title, promptText }) {
  const [cursor, setCursor] = useState(0)
  const [step, setStep] = useState('pick') // 'pick' | 'text'
  const [pickedValue, setPickedValue] = useState(null)
  const [textInput, setTextInput] = useState('')

  useInput((input, key) => {
    if (step === 'pick') {
      if (key.escape) { onCancel(); return }
      if (key.upArrow || input === 'k') {
        setCursor(c => Math.max(0, c - 1))
        return
      }
      if (key.downArrow || input === 'j') {
        setCursor(c => Math.min(options.length - 1, c + 1))
        return
      }
      if (key.return) {
        const val = options[cursor]?.value
        if (promptText) {
          setPickedValue(val)
          setStep('text')
        } else {
          onSubmit(val)
        }
        return
      }
    } else if (step === 'text') {
      if (key.escape) { onCancel(); return }
      if (key.return) {
        onSubmit({ value: pickedValue, text: textInput })
        return
      }
      if (key.backspace || key.delete) {
        setTextInput(t => t.slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setTextInput(t => t + input)
      }
    }
  })

  if (step === 'text') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
        <Box marginBottom={1}>
          <Text color={t.ui.selected} bold>Selected: </Text>
          <Text>{options.find(o => o.value === pickedValue)?.label || pickedValue}</Text>
        </Box>
        <Box>
          <Text color={t.ui.muted}>{promptText}: </Text>
          <Text color={t.ui.selected}>{textInput}</Text>
          <Text color={t.ui.dim}>█</Text>
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
        <Box marginBottom={1}>
          <Text color={t.ui.selected} bold>{title}</Text>
        </Box>
      )}
      {options.map((option, i) => {
        const isCursor = i === cursor
        return (
          <Box key={option.value || i} flexDirection="column">
            <Box>
              <Text color={isCursor ? t.ui.selected : t.ui.muted}>
                {isCursor ? '▶ ' : '  '}
              </Text>
              <Text color={isCursor ? t.ui.selected : undefined} bold={isCursor}>
                {option.label}
              </Text>
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
        <Text color={t.ui.dim}>[j/k] navigate  [Enter] select  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}
