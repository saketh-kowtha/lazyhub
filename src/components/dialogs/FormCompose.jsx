/**
 * FormCompose.jsx — multi-field form dialog primitive.
 * Props: title, fields ([{name, label, type: 'text'|'multiline'|'select'}])
 *        onSubmit(values), onCancel()
 */

import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { useTheme } from '../../theme.js'
import { TextInput } from '../../utils.js'

export function FormCompose({ title, fields = [], onSubmit, onCancel }) {
  const { t } = useTheme()
  const [activeField, setActiveField] = useState(0)
  const [values, setValues] = useState(() => {
    const v = {}
    fields.forEach(f => { v[f.name] = f.defaultValue || '' })
    return v
  })

  const openEditor = useCallback((fieldName) => {
    const raw = process.env.EDITOR || process.env.VISUAL || 'vi'
    if (!raw || /[\0\n\r]/.test(raw)) return
    const [editorBin, ...editorArgs] = raw.split(/\s+/).filter(Boolean)
    let tmpDir
    try {
      tmpDir = mkdtempSync(join(tmpdir(), 'lazyhub-'))
      const tmpFile = join(tmpDir, 'compose.md')
      writeFileSync(tmpFile, values[fieldName] || '', { mode: 0o600 })
      // Exit alternate screen so terminal editors (vim/nano) render cleanly;
      // re-enter after the editor closes so Ink's state isn't garbled.
      process.stdout.write('\x1b[?1049l')
      const result = spawnSync(editorBin, [...editorArgs, tmpFile], { stdio: 'inherit' })
      process.stdout.write('\x1b[?1049h\x1b[H')
      if (result.status !== 0) return
      const content = readFileSync(tmpFile, 'utf8')
      setValues(prev => ({ ...prev, [fieldName]: content }))
    } catch {
      // ignore
    } finally { try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
  }, [values])

  useInput((input, key) => {
    if (key.escape) { onCancel(); return }

    if (key.tab && key.shift) {
      setActiveField(f => (f - 1 + fields.length) % fields.length)
      return
    }
    if (key.tab) {
      setActiveField(f => (f + 1) % fields.length)
      return
    }

    if ((key.return && key.ctrl) || (key.ctrl && input === 'g')) {
      onSubmit(values)
      return
    }

    const field = fields[activeField]
    if (!field) return

    // Use Ctrl+E for editor to avoid 'e' key hijacking
    if (field.type === 'multiline' && key.ctrl && input === 'e') {
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
