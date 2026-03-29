/**
 * src/features/settings/index.jsx — In-app settings and theme picker
 */

import React, { useState, useContext } from 'react'
import { Box, Text, useInput } from 'ink'
import { THEME_NAMES, BUILTIN_THEMES, useTheme } from '../../theme.js'
import { AppContext } from '../../context.js'
import { loadConfig, saveConfig } from '../../config.js'
import { logger, TextInput } from '../../utils.js'

export function SettingsPane({ onBack }) {
  const { notifyDialog, setMouseEnabled } = useContext(AppContext)
  const { t, themeName, setTheme } = useTheme()
  const [config, setConfig] = useState(() => loadConfig())
  const [cursor, setCursor] = useState(0)
  const [dialog, setDialog] = useState(null)

  React.useEffect(() => {
    notifyDialog(!!dialog)
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

  const OPTIONS = [
    { id: 'theme',    label: 'Theme',         value: themeName },
    { id: 'mouse',    label: 'Mouse Support',  value: config.mouse ? 'Enabled' : 'Disabled' },
    { id: 'pageSize', label: 'Page Size',      value: config.pr?.pageSize || 50 },
    {
      id: 'apiKey',
      label: 'AI API Key',
      value: config.anthropicApiKey
        ? 'sk-' + '•'.repeat(8) + config.anthropicApiKey.slice(-4)
        : '(not set)',
    },
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
    if (patch.theme) setTheme(patch.theme)
    logger.info(`Config updated: ${JSON.stringify(patch)}`, { component: 'Settings' })
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
    const next = !config.mouse
    updateConfig({ mouse: next })
    setMouseEnabled(next)
    setDialog(null)
  }

  if (dialog === 'apiKey') {
    return (
      <ApiKeyEditor
        current={config.anthropicApiKey || ''}
        onSave={(key) => { updateConfig({ anthropicApiKey: key }); setDialog(null) }}
        onCancel={() => setDialog(null)}
      />
    )
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

function ApiKeyEditor({ current, onSave, onCancel }) {
  const { t } = useTheme()
  const [value, setValue] = useState(current)

  useInput((_, key) => {
    if (key.escape) onCancel()
  })

  const masked = value
    ? 'sk-' + '•'.repeat(Math.max(0, value.length - 4)) + value.slice(-4)
    : ''

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color={t.ui.selected}>Set AI (Anthropic) API Key</Text>
      </Box>
      <Box>
        <Text color={t.ui.muted}>Key: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          focus={true}
          mask="•"
          onEnter={() => onSave(value.trim())}
        />
      </Box>
      {value ? (
        <Box marginTop={1}>
          <Text color={t.ui.dim}>Will save as: {masked}</Text>
        </Box>
      ) : null}
      <Box marginTop={1}>
        <Text color={t.ui.dim}>[Enter] save  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}

function ThemePicker({ current, onSelect, onCancel }) {
  const { t } = useTheme()
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
