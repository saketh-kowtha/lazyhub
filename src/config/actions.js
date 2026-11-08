/**
 * config/actions.js — action/key metadata from lazyhub.toml.
 */

import { loadConfig } from './loader.js'
import { buildEffectiveActionKeys, eventToTokens } from './keymap.js'

/** @type {any} */
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
export function getAction(/** @type {any} */ id, config = getActionConfig()) {
  return config?.actions?.[id] || null
}

/**
 *
 * @param id
 * @param config
 */
export function actionHint(/** @type {any} */ id, config = getActionConfig()) {
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
export function actionHints(/** @type {any} */ ids, config = getActionConfig()) {
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

const effectiveKeyCache = new WeakMap()

/**
 * The key to show for an action: its effective binding after `[keymaps.*]`
 * rebinds, or null when the action is unbound. This is what every hint line
 * renders, so a hint can never name a key the keymap does not bind (#511).
 * @param {string} id registry action id
 * @param {Record<string, any>} [config] effective config
 * @returns {string|null} key label, e.g. 'Ctrl+R'
 */
export function effectiveHintKey(id, config = getActionConfig()) {
  let keys = effectiveKeyCache.get(config)
  if (!keys) {
    keys = buildEffectiveActionKeys(config)
    effectiveKeyCache.set(config, keys)
  }
  const bound = keys[id] || []
  if (bound.length === 0) return null
  const action = getAction(id, config)
  return action?.hint && bound.length > 1 ? action.hint : bound[0]
}

/**
 * One hint line (`[j/k] nav  [Esc] exit`) generated from the registry.
 * Unbound actions are left out. An entry is an action id, or `[id, label]` to
 * override the registry label with a shorter one.
 * @param {(string|[string, string])[]} entries action ids
 * @param {Record<string, any>} [config] effective config
 * @returns {string} hint line
 */
export function hintLine(entries, config = getActionConfig()) {
  const parts = []
  for (const entry of entries) {
    const [id, label] = Array.isArray(entry) ? entry : [entry, null]
    const key = effectiveHintKey(id, config)
    if (!key) continue
    parts.push(`[${key}] ${label ?? getAction(id, config)?.label ?? id}`)
  }
  return parts.join('  ')
}

function matchesKeyToken(/** @type {any} */ token, /** @type {any} */ input, /** @type {any} */ key) {
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
    default: return input === token && !key.ctrl && !key.meta
  }
}

/**
 *
 * @param id
 * @param input
 * @param key
 * @param config
 */
export function matchesAction(/** @type {any} */ id, /** @type {any} */ input, /** @type {any} */ key, config = getActionConfig()) {
  const action = getAction(id, config)
  const effective = buildEffectiveActionKeys(config)[id] || action?.keys || []
  const event = eventToTokens(input, key)
  return Boolean(effective.some((/** @type {any} */ token) => event.has(token) || matchesKeyToken(token, input, key)))
}

/**
 *
 * @param id
 * @param fallback
 * @param config
 */
export function firstActionKey(/** @type {any} */ id, /** @type {any} */ fallback, config = getActionConfig()) {
  const action = getAction(id, config)
  return buildEffectiveActionKeys(config)[id]?.[0] || action?.keys?.[0] || fallback
}

/**
 *
 * @param scope
 * @param config
 */
export function actionsByScope(/** @type {any} */ scope, config = getActionConfig()) {
  return Object.entries(config?.actions || {})
    .filter(([, action]) => action.scope === scope)
    .map(([id, action]) => ({ id, ...action }))
}
