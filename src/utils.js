import React, { useState, useEffect } from 'react'
import { Text, useInput, Box } from 'ink'
import { t } from './theme.js'

/**
 * src/utils.js — shared utility functions
 */

/**
 * Strips ANSI escape codes from a string to prevent Terminal Injection.
 */
export function stripAnsi(str) {
  if (typeof str !== 'string') return str
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
}

/**
 * Sanitize untrusted text for rendering.
 * Strips ANSI codes and potentially other dangerous characters.
 */
export function sanitize(str) {
  return stripAnsi(str || '')
}

/**
 * A basic text input component with cursor support and common shortcuts.
 */
export function TextInput({ value, onChange, placeholder, focus, mask, onEnter }) {
  const [cursor, setCursor] = useState(value?.length || 0)

  // Sync cursor if value changes externally
  useEffect(() => {
    if (cursor > value?.length) setCursor(value?.length || 0)
  }, [value, cursor])

  useInput((input, key) => {
    if (!focus) return

    if (key.return) {
      if (onEnter) onEnter()
      return
    }

    if (key.leftArrow) {
      setCursor(c => Math.max(0, c - 1))
      return
    }
    if (key.rightArrow) {
      setCursor(c => Math.min(value.length, c + 1))
      return
    }

    if (key.ctrl && input === 'a') { // Ctrl+A: start of line
      setCursor(0)
      return
    }
    if (key.ctrl && input === 'e') { // Ctrl+E: end of line
      setCursor(value.length)
      return
    }
    if (key.ctrl && input === 'u') { // Ctrl+U: clear line
      onChange('')
      setCursor(0)
      return
    }
    if (key.ctrl && input === 'k') { // Ctrl+K: clear to end of line
      onChange(value.slice(0, cursor))
      return
    }

    if (key.backspace || key.delete) {
      if (cursor > 0) {
        const nextValue = value.slice(0, cursor - 1) + value.slice(cursor)
        onChange(nextValue)
        setCursor(c => c - 1)
      }
      return
    }

    if (input && !key.ctrl && !key.meta) {
      const nextValue = value.slice(0, cursor) + input + value.slice(cursor)
      onChange(nextValue)
      setCursor(c => c + input.length)
    }
  })

  const renderedValue = mask ? mask.repeat(value.length) : value
  const beforeCursor = renderedValue.slice(0, cursor)
  const atCursor = renderedValue.slice(cursor, cursor + 1) || ' '
  const afterCursor = renderedValue.slice(cursor + 1)

  return (
    <Box>
      {value.length === 0 && !focus ? (
        <Text color={t.ui.dim}>{placeholder}</Text>
      ) : (
        <Box>
          <Text>{beforeCursor}</Text>
          <Text backgroundColor={focus ? t.ui.selected : undefined} color={focus ? 'black' : undefined}>
            {atCursor}
          </Text>
          <Text>{afterCursor}</Text>
        </Box>
      )}
    </Box>
  )
}
