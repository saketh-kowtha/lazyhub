/**
 * config/actions.js — action/key metadata from lazyhub.toml.
 */

import { loadConfig } from './loader.js'
import { buildEffectiveActionKeys, eventToTokens } from './keymap.js'

let cachedConfig = null

/**
 *
 */
export function getActionConfig() {
  if (!cachedConfig) cachedConfig = loadConfig()
  return cachedConfig
}

/**
 *
 */
export function resetActionConfigCache() {
  cachedConfig = null
}

/**
 *
 * @param id
 * @param config
 */
export function getAction(id, config = getActionConfig()) {
  return config?.actions?.[id] || null
}

/**
 *
 * @param id
 * @param config
 */
export function actionHint(id, config = getActionConfig()) {
  const action = getAction(id, config)
  if (!action) return null
  return {
    key: action.hint || action.keys?.join(' / ') || id,
    label: action.label || id,
    description: action.description || '',
    group: action.group || '',
  }
}

/**
 *
 * @param ids
 * @param config
 */
export function actionHints(ids, config = getActionConfig()) {
  const seen = new Set()
  const hints = []
  for (const id of ids) {
    const hint = actionHint(id, config)
    if (!hint) continue
    const sig = `${hint.key}:${hint.label}`
    if (seen.has(sig)) continue
    seen.add(sig)
    hints.push(hint)
  }
  return hints
}

function matchesKeyToken(token, input, key) {
  switch (token) {
    case 'Enter': return key.return
    case 'Esc': return key.escape
    case 'Tab': return key.tab && !key.shift
    case 'Shift+Tab': return key.tab && key.shift
    case 'Up': return key.upArrow
    case 'Down': return key.downArrow
    case 'Left': return key.leftArrow
    case 'Right': return key.rightArrow
    case 'Space': return input === ' '
    case 'Ctrl+A': return key.ctrl && input === 'a'
    case 'Ctrl+E': return key.ctrl && input === 'e'
    case 'Ctrl+G': return key.ctrl && (input === 'g' || input === '\x07')
    case 'Ctrl+Shift+G': return key.ctrl && input === 'G'
    case 'Ctrl+J': return key.ctrl && input === 'j'
    case 'Ctrl+K': return key.ctrl && input === 'k'
    case 'Ctrl+N': return key.ctrl && input === 'n'
    case 'Ctrl+P': return key.ctrl && input === 'p'
    case 'PageDown': return key.pageDown
    case 'PageUp': return key.pageUp
    case '<space><space>': return false
    default: return input === token
  }
}

/**
 *
 * @param id
 * @param input
 * @param key
 * @param config
 */
export function matchesAction(id, input, key, config = getActionConfig()) {
  const action = getAction(id, config)
  const effective = buildEffectiveActionKeys(config)[id] || action?.keys || []
  const event = eventToTokens(input, key)
  return Boolean(effective.some(token => event.has(token) || matchesKeyToken(token, input, key)))
}

/**
 *
 * @param id
 * @param fallback
 * @param config
 */
export function firstActionKey(id, fallback, config = getActionConfig()) {
  const action = getAction(id, config)
  return buildEffectiveActionKeys(config)[id]?.[0] || action?.keys?.[0] || fallback
}

/**
 *
 * @param scope
 * @param config
 */
export function actionsByScope(scope, config = getActionConfig()) {
  return Object.entries(config?.actions || {})
    .filter(([, action]) => action.scope === scope)
    .map(([id, action]) => ({ id, ...action }))
}
