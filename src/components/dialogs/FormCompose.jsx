/**
 * FormCompose.jsx — multi-field form dialog primitive.
 * Props: title, fields ([{name, label, type: 'text'|'multiline'|'select'}])
 *        onSubmit(values), onCancel()
 */

import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { t } from '../../theme.js'

export function FormCompose({ title, fields = [], onSubmit, onCancel }) {
  const [activeField, setActiveField] = useState(0)
  const [values, setValues] = useState(() => {
    const v = {}
    fields.forEach(f => { v[f.name] = f.defaultValue || '' })
    return v
  })

  const openEditor = useCallback((fieldName) => {
    const editor = process.env.EDITOR || process.env.VISUAL || 'vi'
    const tmpFile = join(tmpdir(), `ghui-compose-${Date.now()}.md`)
    writeFileSync(tmpFile, values[fieldName] || '')
    spawnSync(editor, [tmpFile], { stdio: 'inherit' })
    try {
      const content = readFileSync(tmpFile, 'utf8')
      setValues(prev => ({ ...prev, [fieldName]: content }))
      unlinkSync(tmpFile)
    } catch {
      // ignore
    }
  }, [values])

  useInput((input, key) => {
    if (key.escape) { onCancel(); return }

    if (key.tab) {
      setActiveField(f => (f + 1) % fields.length)
      return
    }

    if (key.return && key.ctrl) {
      onSubmit(values)
      return
    }

    const field = fields[activeField]
    if (!field) return

    if (field.type === 'multiline' && input === 'e') {
      openEditor(field.name)
      return
    }

    if (field.type === 'text' || field.type === 'multiline') {
      if (key.return && field.type === 'text') {
        setActiveField(f => Math.min(fields.length - 1, f + 1))
        return
      }
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
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
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
                      <Text key={li} wrap="truncate">{line || ' '}</Text>
                    ))
                  ) : (
                    <Text color={t.ui.dim}>
                      {isActive ? '' : 'Press e to open editor'}
                    </Text>
                  )}
                  {isActive && <Text color={t.ui.dim}>[e] open editor  [Ctrl+Enter] submit</Text>}
                </Box>
              ) : (
                <Box>
                  <Text wrap="truncate">{val}</Text>
                  {isActive && <Text color={t.ui.dim}>|</Text>}
                </Box>
              )}
            </Box>
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text color={t.ui.dim}>[Tab] next field  [Ctrl+Enter] submit  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}
