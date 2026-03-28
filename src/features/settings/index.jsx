/**
 * src/features/settings/index.jsx — In-app settings and theme picker
 */

import React, { useState, useContext } from 'react'
import { Box, Text, useInput } from 'ink'
import { t, THEME_NAMES, BUILTIN_THEMES } from '../../theme.js'
import { AppContext } from '../../context.js'
import { loadConfig, saveConfig } from '../../config.js'

export function SettingsPane({ onBack }) {
  const { notifyDialog } = useContext(AppContext)
  const [config, setConfig] = useState(() => loadConfig())
  const [cursor, setCursor] = useState(0)
  const [dialog, setDialog] = useState(null)

  const OPTIONS = [
    { id: 'theme', label: 'Theme', value: config.theme || 'github-dark' },
    { id: 'mouse', label: 'Mouse Support', value: config.mouse ? 'Enabled' : 'Disabled' },
    { id: 'pageSize', label: 'Page Size', value: config.pr?.pageSize || 50 },
  ]

  useInput((input, key) => {
    if (dialog) return

    if (key.escape || input === 'q') { onBack(); return }
    if (input === 'j' || key.downArrow) { setCursor(c => (c + 1) % OPTIONS.length); return }
    if (input === 'k' || key.upArrow)   { setCursor(c => (c - 1 + OPTIONS.length) % OPTIONS.length); return }

    if (key.return) {
      setDialog(OPTIONS[cursor].id)
    }
  })

  const updateConfig = (patch) => {
    const next = { ...config, ...patch }
    setConfig(next)
    saveConfig(next)
    // Note: Theme change won't reflect instantly across all components 
    // unless we use a ThemeProvider, but it will save for next restart.
  }

  if (dialog === 'theme') {
    return (
      <ThemePicker
        current={config.theme || 'github-dark'}
        onSelect={(theme) => { updateConfig({ theme }); setDialog(null) }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'mouse') {
    updateConfig({ mouse: !config.mouse })
    setDialog(null)
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box marginBottom={1} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor={t.ui.border}>
        <Text color={t.ui.selected} bold>⚙ Settings</Text>
      </Box>

      <Box flexDirection="column" flexGrow={1}>
        {OPTIONS.map((opt, i) => {
          const isSelected = i === cursor
          return (
            <Box key={opt.id} paddingX={1} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
              <Text color={isSelected ? t.ui.selected : t.ui.muted} width={20}>{opt.label}:</Text>
              <Text color={isSelected ? t.ui.selected : undefined}>{opt.value}</Text>
            </Box>
          )
        })}
      </Box>

      <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor={t.ui.border}>
        <Text color={t.ui.dim}>[j/k] navigate  [Enter] change  [Esc] back</Text>
      </Box>
    </Box>
  )
}

function ThemePicker({ current, onSelect, onCancel }) {
  const [cursor, setCursor] = useState(THEME_NAMES.indexOf(current) || 0)

  useInput((input, key) => {
    if (key.escape) { onCancel(); return }
    if (input === 'j' || key.downArrow) { setCursor(c => (c + 1) % THEME_NAMES.length); return }
    if (input === 'k' || key.upArrow)   { setCursor(c => (c - 1 + THEME_NAMES.length) % THEME_NAMES.length); return }
    if (key.return) { onSelect(THEME_NAMES[cursor]); return }
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
      <Box marginBottom={1}>
        <Text color={t.ui.selected} bold>Select Theme</Text>
      </Box>
      {THEME_NAMES.map((name, i) => {
        const isSelected = i === cursor
        const isCurrent = name === current
        return (
          <Box key={name} gap={1}>
            <Text color={isSelected ? t.ui.selected : t.ui.muted}>
              {isSelected ? '▶' : ' '} {name}
            </Text>
            {isCurrent && <Text color={t.ui.dim}>(current)</Text>}
          </Box>
        )
      })}
      <Box marginTop={1}>
        <Text color={t.ui.dim}>[j/k] navigate  [Enter] select  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}
