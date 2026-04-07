/**
 * src/features/settings/index.jsx — In-app settings and theme picker
 */

import React, { useState, useContext } from 'react'
import { Box, Text, useInput } from 'ink'
import { THEME_NAMES, useTheme } from '../../theme.js'
import { AppContext } from '../../context.js'
import { loadConfig, saveConfig, BUILTIN_PANES } from '../../config.js'
import { logger, TextInput } from '../../utils.js'
import { MultiSelect } from '../../components/dialogs/MultiSelect.jsx'

const PROVIDERS = ['anthropic', 'openai', 'ollama']
const PROVIDER_LABELS = {
  anthropic: 'Anthropic (Claude)',
  openai:    'OpenAI-compatible',
  ollama:    'Ollama (local)',
}

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

  const ai = config.ai || {}

  function aiProviderSummary(ai) {
    const provider = ai.provider || 'anthropic'
    if (provider === 'ollama') {
      const model   = ai.model || 'llama3'
      const baseUrl = ai.openaiBaseUrl || 'http://localhost:11434/v1'
      const port    = baseUrl.match(/:(\d+)/)?.[1]
      return `${model}  (Ollama${port ? ` :${port}` : ''})`
    }
    const model = ai.model || (provider === 'openai' ? 'gpt-4o' : 'claude-sonnet-4-6')
    if (provider === 'anthropic') {
      return `${model}  (Anthropic)`
    }
    // openai-compat — show endpoint hint
    const baseUrl = ai.openaiBaseUrl || 'https://api.openai.com/v1'
    let endpointHint
    if (baseUrl.includes('localhost') || baseUrl.includes('127.0.0.1')) {
      const port = baseUrl.match(/:(\d+)/)?.[1]
      endpointHint = port ? `local :${port}` : 'local'
    } else if (baseUrl.includes('groq.com'))    { endpointHint = 'Groq' }
    else if (baseUrl.includes('together'))       { endpointHint = 'Together' }
    else if (baseUrl.includes('fireworks'))      { endpointHint = 'Fireworks' }
    else if (baseUrl.includes('openai.azure'))   { endpointHint = 'Azure OpenAI' }
    else if (baseUrl.includes('openai.com'))     { endpointHint = 'OpenAI' }
    else if (baseUrl.includes('mistral'))        { endpointHint = 'Mistral' }
    else if (baseUrl.includes('deepseek'))       { endpointHint = 'DeepSeek' }
    else if (baseUrl.includes('x.ai'))           { endpointHint = 'xAI' }
    else { endpointHint = baseUrl.replace(/^https?:\/\//, '').split('/')[0] }
    return `${model}  (${endpointHint})`
  }

  const OPTIONS = [
    { id: 'theme',      label: 'Theme',         value: themeName },
    { id: 'mouse',      label: 'Mouse Support',  value: config.mouse ? 'Enabled' : 'Disabled' },
    { id: 'aiReview',   label: 'AI Code Review', value: config.aiReviewEnabled !== false ? 'Enabled' : 'Disabled' },
    { id: 'panes',      label: 'Active Panes',   value: (config.panes || []).join(', ') },
    { id: 'pageSize',   label: 'Page Size',      value: config.pr?.pageSize || 50 },
    { id: 'aiProvider', label: 'AI Provider',    value: aiProviderSummary(ai) },
  ]

  useInput((input, key) => {
    if (dialog) return
    if (key.escape || input === 'q') { onBack(); return }
    if (input === 'j' || key.downArrow) { setCursor(c => (c + 1) % OPTIONS.length); return }
    if (input === 'k' || key.upArrow)   { setCursor(c => (c - 1 + OPTIONS.length) % OPTIONS.length); return }
    if (key.return) { setDialog(OPTIONS[cursor].id) }
  })

  const updateConfig = (patch) => {
    const next = { ...config, ...patch }
    setConfig(next)
    saveConfig(next)
    if (patch.theme) setTheme(patch.theme)
    logger.info(`Config updated`, { component: 'Settings' })
  }

  const updateAI = (aiPatch) => {
    updateConfig({ ai: { ...(config.ai || {}), ...aiPatch } })
  }

  // ── Instant-toggle dialogs ────────────────────────────────────────────────
  if (dialog === 'mouse') {
    const next = !config.mouse
    updateConfig({ mouse: next })
    setMouseEnabled(next)
    setDialog(null)
  }

  if (dialog === 'aiReview') {
    updateConfig({ aiReviewEnabled: config.aiReviewEnabled === false })
    setDialog(null)
  }

  // ── Sub-screen dialogs ────────────────────────────────────────────────────
  if (dialog === 'theme') {
    return (
      <ThemePicker
        current={config.theme || 'github-dark'}
        onSelect={(theme) => { updateConfig({ theme }); setDialog(null) }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'panes') {
    const allKnown = [...BUILTIN_PANES, ...Object.keys(config.customPanes || {})]
    return (
      <MultiSelect
        items={allKnown.map(id => ({ id, name: id, selected: (config.panes || []).includes(id) }))}
        onSubmit={(selectedIds) => { updateConfig({ panes: selectedIds }); setDialog(null) }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'aiProvider') {
    return (
      <AIProviderEditor
        ai={config.ai || {}}
        onSave={(aiPatch) => { updateAI(aiPatch); setDialog(null) }}
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
              <Text color={isSelected ? t.ui.selected : undefined}>{String(opt.value)}</Text>
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

// ─── AI Provider Editor ───────────────────────────────────────────────────────

const AI_FIELDS_ANTHROPIC = ['provider', 'anthropicApiKey', 'model']
const AI_FIELDS_OPENAI    = ['provider', 'openaiApiKey', 'openaiBaseUrl', 'model']
const AI_FIELDS_OLLAMA    = ['provider', 'openaiBaseUrl', 'model']

const FIELD_LABELS = {
  provider:        'Provider',
  anthropicApiKey: 'Anthropic API Key',
  openaiApiKey:    'API Key',
  openaiBaseUrl:   'Base URL',
  model:           'Model',
}

const FIELD_HINTS_BY_PROVIDER = {
  anthropic: {
    provider:        'anthropic → Claude  |  openai → OpenAI/Groq/etc.  |  ollama → local Ollama (no key needed)',
    anthropicApiKey: 'sk-ant-…  required to use Claude models',
    model:           'leave empty for default (claude-sonnet-4-6)',
  },
  openai: {
    provider:        'anthropic → Claude  |  openai → OpenAI/Groq/etc.  |  ollama → local Ollama (no key needed)',
    openaiApiKey:    'sk-…  API key from your provider',
    openaiBaseUrl:   'https://api.openai.com/v1  or  https://api.groq.com/openai/v1  etc.',
    model:           'leave empty for default (gpt-4o)',
  },
  ollama: {
    provider:        'anthropic → Claude  |  openai → OpenAI/Groq/etc.  |  ollama → local Ollama (no key needed)',
    openaiBaseUrl:   'http://localhost:11434/v1  (Ollama default port)',
    model:           'e.g. llama3, mistral, codellama  (leave empty for llama3)',
  },
}

function AIProviderEditor({ ai, onSave, onCancel }) {
  const { t } = useTheme()
  const [values, setValues] = useState({
    provider:        ai.provider        || 'anthropic',
    anthropicApiKey: ai.anthropicApiKey || '',
    openaiApiKey:    ai.openaiApiKey    || '',
    openaiBaseUrl:   ai.openaiBaseUrl   || '',
    model:           ai.model           || '',
  })
  const [cursor,  setCursor]  = useState(0)
  const [editing, setEditing] = useState(null)

  const fields = values.provider === 'openai'
    ? AI_FIELDS_OPENAI
    : values.provider === 'ollama'
      ? AI_FIELDS_OLLAMA
      : AI_FIELDS_ANTHROPIC

  const hints = FIELD_HINTS_BY_PROVIDER[values.provider] || FIELD_HINTS_BY_PROVIDER.anthropic

  function displayValue(field) {
    const v = values[field]
    if (field === 'provider') return PROVIDER_LABELS[v] || v
    if (field === 'anthropicApiKey' || field === 'openaiApiKey') {
      if (!v) return '(not set)'
      return v.slice(0, 4) + '•'.repeat(Math.max(4, v.length - 8)) + v.slice(-4)
    }
    if (field === 'openaiBaseUrl') {
      if (!v) {
        return values.provider === 'ollama'
          ? 'http://localhost:11434/v1'
          : 'https://api.openai.com/v1'
      }
      return v
    }
    if (field === 'model') {
      if (!v) {
        if (values.provider === 'ollama')    return 'llama3 (default)'
        if (values.provider === 'openai')    return 'gpt-4o (default)'
        return 'claude-sonnet-4-6 (default)'
      }
      return v
    }
    return v || '(not set)'
  }

  useInput((input, key) => {
    if (editing) return

    if (key.escape) { onCancel(); return }
    if (key.return) {
      if (fields[cursor] === 'provider') {
        setValues(v => {
          const next = PROVIDERS[(PROVIDERS.indexOf(v.provider) + 1) % PROVIDERS.length]
          return { ...v, provider: next }
        })
        setCursor(0)
      } else {
        setEditing(fields[cursor])
      }
      return
    }
    if ((key.ctrl && input === 'g') || input === 's') { onSave(values); return }
    if (input === 'j' || key.downArrow) { setCursor(c => (c + 1) % fields.length); return }
    if (input === 'k' || key.upArrow)   { setCursor(c => (c - 1 + fields.length) % fields.length); return }
  })

  if (editing) {
    const isKey = editing === 'anthropicApiKey' || editing === 'openaiApiKey'
    return (
      <FieldEditor
        label={FIELD_LABELS[editing]}
        hint={hints[editing]}
        value={values[editing]}
        mask={isKey}
        onSave={(v) => { setValues(prev => ({ ...prev, [editing]: v })); setEditing(null) }}
        onCancel={() => setEditing(null)}
      />
    )
  }

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={2} paddingY={1}>
      <Box marginBottom={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold>AI Provider Settings</Text>
        <Text color={t.ui.dim}>[s / Ctrl+G] save  [Esc] cancel</Text>
      </Box>

      {fields.map((field, i) => {
        const isSelected = i === cursor
        return (
          <Box key={field} paddingX={1} backgroundColor={isSelected ? t.ui.headerBg : undefined} flexDirection="column">
            <Box>
              <Text color={isSelected ? t.ui.selected : t.ui.muted} width={22}>{FIELD_LABELS[field]}:</Text>
              <Text color={isSelected ? t.ui.selected : undefined}>{displayValue(field)}</Text>
              {field === 'provider' && isSelected && (
                <Text color={t.ui.dim}>  [Enter] cycle</Text>
              )}
              {field !== 'provider' && isSelected && (
                <Text color={t.ui.dim}>  [Enter] edit</Text>
              )}
            </Box>
            {isSelected && hints[field] && (
              <Text color={t.ui.dim} dimColor>  {hints[field]}</Text>
            )}
          </Box>
        )
      })}

      {values.provider === 'ollama' && (
        <Box marginTop={1} paddingX={1}>
          <Text color={t.ci.pass}>✓ No API key needed for Ollama</Text>
        </Box>
      )}

      <Box marginTop={1} borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor={t.ui.border}>
        <Text color={t.ui.dim}>[j/k] navigate  [Enter] cycle/edit  [s] save  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}

// ─── Single-field text editor ─────────────────────────────────────────────────

function FieldEditor({ label, hint, value, mask, onSave, onCancel }) {
  const { t } = useTheme()
  const [v, setV] = useState(value)

  useInput((_, key) => {
    if (key.escape) onCancel()
  })

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={2} paddingY={1}>
      <Box marginBottom={1}>
        <Text color={t.ui.selected} bold>{label}</Text>
      </Box>
      {hint && <Text color={t.ui.dim} dimColor>{hint}</Text>}
      <Box marginTop={1}>
        <Text color={t.ui.muted}>&gt; </Text>
        <TextInput
          value={v}
          onChange={setV}
          focus={true}
          mask={mask ? '•' : undefined}
          onEnter={() => onSave(v.trim())}
        />
      </Box>
      <Box marginTop={1}>
        <Text color={t.ui.dim}>[Enter] confirm  [Esc] cancel</Text>
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
