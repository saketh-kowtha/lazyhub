/**
 * FormCompose.jsx — multi-field form dialog primitive.
 * Props: title, fields ([{name, label, type: 'text'|'multiline'|'select'}])
 *        onSubmit(values), onCancel()
 */

import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { editTextInEditor } from '../../services/platform.js'
import { useTheme } from '../../theme.js'
import { TextInput } from '../../utils.js'
import { useKeyScope } from '../../keyscope.js'
import { matchesAction } from '../../config/actions.js'

export function FormCompose({ title, fields = [], onSubmit, onCancel }) {
  useKeyScope('dialog')
  const { t } = useTheme()
  const [activeField, setActiveField] = useState(0)
  const [values, setValues] = useState(() => {
    const v = {}
    fields.forEach(f => { v[f.name] = f.defaultValue || '' })
    return v
  })

  const openEditor = useCallback((fieldName) => {
    // Leaves the alternate screen so terminal editors (vim/nano) render cleanly and
    // re-enters it afterwards so Ink's state isn't garbled.
    const { ok, text } = editTextInEditor(values[fieldName] || '', { filename: 'compose.md' })
    if (ok) setValues(prev => ({ ...prev, [fieldName]: text }))
  }, [values])

  useInput((input, key) => {
    if (matchesAction('dialog.cancel', input, key)) { onCancel(); return }

    if (key.tab && key.shift) {
      setActiveField(f => (f - 1 + fields.length) % fields.length)
      return
    }
    if (key.tab) {
      setActiveField(f => (f + 1) % fields.length)
      return
    }

    if ((key.return && key.ctrl) || matchesAction('dialog.submit', input, key)) {
      onSubmit(values)
      return
    }

    const field = fields[activeField]
    if (!field) return

    // Use Ctrl+E for editor to avoid 'e' key hijacking
    if (field.type === 'multiline' && matchesAction('dialog.editor', input, key)) {
      openEditor(field.name)
      return
    }

    if (field.type === 'multiline') {
      if (key.backspace || key.delete) {
        setValues(prev => ({ ...prev, [field.name]: (prev[field.name] || '').slice(0, -1) }))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setValues(prev => ({ ...prev, [field.name]: (prev[field.name] || '') + input }))
      }
    }
  })

  return (
    <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
      {title && (
        <Box marginBottom={1}>
          <Text color={t.ui.selected} bold>{title}</Text>
        </Box>
      )}
      {fields.map((field, i) => {
        const isActive = i === activeField
        const val = values[field.name] || ''
        return (
          <Box key={field.name} flexDirection="column" marginBottom={1}>
            <Text color={isActive ? t.ui.selected : t.ui.muted} bold={isActive}>
              {field.label}:
            </Text>
            <Box borderStyle={isActive ? 'round' : 'single'} borderColor={isActive ? t.ui.selected : t.ui.border} paddingX={1}>
              {field.type === 'multiline' ? (
                <Box flexDirection="column">
                  {val ? (
                    val.split('\n').slice(0, 3).map((line, li) => (
                      <Box key={li}>
                        <Text wrap="truncate">{line || ' '}</Text>
                      </Box>
                    ))
                  ) : (
                    <Text color={t.ui.dim}>
                      {isActive ? '' : 'Press Ctrl+E to open editor'}
                    </Text>
                  )}
                  {isActive && <Text color={t.ui.dim}>[Ctrl+E] open editor  [Ctrl+Enter / Ctrl+G] submit</Text>}
                </Box>
              ) : (
                <TextInput
                  value={val}
                  onChange={(v) => setValues(prev => ({ ...prev, [field.name]: v }))}
                  focus={isActive}
                  onEnter={() => setActiveField(f => Math.min(fields.length - 1, f + 1))}
                />
              )}
            </Box>
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text color={t.ui.dim}>[Tab] next field  [Ctrl+Enter / Ctrl+G] submit  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}
