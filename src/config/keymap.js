/**
 * config/keymap.js — TOML-backed keymap resolution.
 */

import { useInput } from 'ink'
import { useMemo } from 'react'
import { loadConfig } from './loader.js'

const SPECIAL = {
  enter: 'Enter',
  return: 'Enter',
  esc: 'Esc',
  escape: 'Esc',
  tab: 'Tab',
  space: 'Space',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  pageup: 'PageUp',
  pagedown: 'PageDown',
}

function normalizeKeyName(name) {
  const raw = String(name || '').trim()
  if (!raw) return ''
  const angle = raw.match(/^<(.+)>$/)
  const body = angle ? angle[1] : raw
  const lower = body.toLowerCase()
  if (SPECIAL[lower]) return SPECIAL[lower]
  const ctrl = lower.match(/^c-(.+)$/)
  if (ctrl) return `Ctrl+${ctrl[1].toUpperCase()}`
  const shift = lower.match(/^s-(.+)$/)
  if (shift) return `Shift+${shift[1].toUpperCase()}`
  const meta = lower.match(/^m-(.+)$/)
  if (meta) return `Meta+${meta[1].toUpperCase()}`
  if (raw.length === 1) return raw
  return raw
}

/**
 *
 * @param token
 */
export function normalizeKeyToken(token) {
  const raw = String(token || '').trim()
  if (!raw) return ''
  if (raw === '<space><space>') return raw
  return normalizeKeyName(raw)
}

/**
 *
 * @param input
 * @param key
 */
export function eventToTokens(input, key = {}) {
  const tokens = new Set()
  if (input) tokens.add(input)
  if (key.return) tokens.add('Enter')
  if (key.escape) tokens.add('Esc')
  if (key.tab) tokens.add(key.shift ? 'Shift+Tab' : 'Tab')
  if (key.upArrow) tokens.add('Up')
  if (key.downArrow) tokens.add('Down')
  if (key.leftArrow) tokens.add('Left')
  if (key.rightArrow) tokens.add('Right')
  if (key.pageUp) tokens.add('PageUp')
  if (key.pageDown) tokens.add('PageDown')
  if (input === ' ') tokens.add('Space')
  if (key.ctrl && input) tokens.add(`Ctrl+${input.toUpperCase()}`)
  if (key.meta && input) tokens.add(`Meta+${input.toUpperCase()}`)
  if (key.shift && input && input.length === 1) tokens.add(`Shift+${input.toUpperCase()}`)
  return tokens
}

/**
 *
 * @param config
 */
export function buildEffectiveActionKeys(config = loadConfig()) {
  const byAction = {}
  for (const [id, action] of Object.entries(config?.actions || {})) {
    byAction[id] = new Set((action.keys || []).map(normalizeKeyToken).filter(Boolean))
  }
  for (const bindings of Object.values(config?.keymaps || {})) {
    if (!bindings || typeof bindings !== 'object') continue
    const unbind = bindings.unbind && typeof bindings.unbind === 'object' ? bindings.unbind : {}
    for (const [key, actionId] of Object.entries(bindings)) {
      if (key === 'unbind') continue
      if (typeof actionId !== 'string') continue
      byAction[actionId] ||= new Set()
      byAction[actionId].add(normalizeKeyToken(key))
    }
    for (const [key, enabled] of Object.entries(unbind)) {
      if (!enabled) continue
      const token = normalizeKeyToken(key)
      for (const set of Object.values(byAction)) set.delete(token)
    }
  }
  return Object.fromEntries(Object.entries(byAction).map(([id, keys]) => [id, [...keys]]))
}

function actionScopeMatches(actionScope, keymapScope) {
  if (actionScope === keymapScope) return true
  if (actionScope === 'list' && keymapScope.endsWith('-list')) return true
  return false
}

function buildScopeBindings(scope, config) {
  const bindings = new Map()
  for (const [actionId, action] of Object.entries(config?.actions || {})) {
    if (!actionScopeMatches(action.scope, scope)) continue
    for (const key of action.keys || []) {
      const token = normalizeKeyToken(key)
      if (token) bindings.set(token, actionId)
    }
  }

  const scopeBindings = config?.keymaps?.[scope] || {}
  const unbind = scopeBindings.unbind && typeof scopeBindings.unbind === 'object' ? scopeBindings.unbind : {}
  for (const [key, enabled] of Object.entries(unbind)) {
    if (enabled) bindings.delete(normalizeKeyToken(key))
  }
  for (const [key, actionId] of Object.entries(scopeBindings)) {
    if (key === 'unbind' || typeof actionId !== 'string') continue
    const token = normalizeKeyToken(key)
    if (token) bindings.set(token, actionId)
  }
  return bindings
}

/**
 *
 * @param scope
 * @param config
 */
export function createKeymap(scope, config = loadConfig()) {
  const scopeBindings = buildScopeBindings(scope, config)
  return {
    resolve(input, key) {
      const event = eventToTokens(input, key)
      for (const [token, actionId] of scopeBindings.entries()) {
        if (event.has(token)) return actionId
      }
      return null
    },
    matches(actionId, input, key) {
      const event = eventToTokens(input, key)
      for (const [token, mappedAction] of scopeBindings.entries()) {
        if (mappedAction === actionId && event.has(token)) return true
      }
      return false
    },
    keys(actionId) {
      return [...scopeBindings.entries()]
        .filter(([, mappedAction]) => mappedAction === actionId)
        .map(([token]) => token)
    },
  }
}

/**
 *
 * @param scope
 * @param config
 */
export function useKeymap(scope, config) {
  return useMemo(() => createKeymap(scope, config), [scope, config])
}

/**
 * Transitional hook for feature panes while handlers move to action dispatch.
 * Keeps `src/features` free of direct Ink useInput calls.
 * @param handler
 * @param opts
 */
export function useKeymapInput(handler, opts) {
  return useInput(handler, opts)
}
