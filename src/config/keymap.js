/**
 * config/keymap.js — TOML-backed keymap resolution.
 */

import { useInput } from 'ink'
import { useCallback, useMemo, useRef } from 'react'
import { loadConfig } from './loader.js'
import { getActionConfig } from './actions.js'

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
  // A modified key (Ctrl+R) must not also read as its bare character (`r`).
  if (input && !key.ctrl && !key.meta) tokens.add(input)
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

// Scrolling/refresh/search actions (scope 'list') are shared by the full-screen
// views, so `j`, `gg`, `r` and `/` mean the same thing there (#312).
const VIEW_SCOPES = new Set(['pr-detail', 'pr-checks', 'diff', 'pr-comments', 'issue-detail'])

/**
 * Whether an action declared for `actionScope` is live in the keymap scope.
 * `actionScope` may list several scopes separated by commas (shared verbs).
 * @param {string} actionScope scope(s) on the action
 * @param {string} keymapScope scope being resolved
 * @returns {boolean} true when the action applies there
 */
export function actionScopeMatches(actionScope, keymapScope) {
  return String(actionScope || '').split(',').some(declared => {
    if (declared === keymapScope) return true
    if (declared === 'list') return keymapScope.endsWith('-list') || VIEW_SCOPES.has(keymapScope)
    return false
  })
}

function buildScopeBindings(scopes, config) {
  const bindings = new Map()
  for (const scope of scopes) {
    for (const [actionId, action] of Object.entries(config?.actions || {})) {
      if (!actionScopeMatches(action.scope, scope)) continue
      for (const key of action.keys || []) {
        const token = normalizeKeyToken(key)
        if (token) bindings.set(token, actionId)
      }
    }
  }

  for (const scope of scopes) {
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
  }
  return bindings
}

/**
 *
 * @param scope
 * @param config
 */
export function createKeymap(scope, config = loadConfig()) {
  const scopeBindings = buildScopeBindings([].concat(scope), config)
  return {
    /**
     * Resolve a literal token, e.g. a two-key chord such as 'gg'.
     * @param {string} token key token
     * @returns {string|null} action id
     */
    resolveToken(token) {
      return scopeBindings.get(token) ?? null
    },
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

const CHORD_WINDOW_MS = 400

/**
 * Resolve key events to registry action ids for one or more scopes, including
 * two-key chords bound as e.g. `gg` (cursor.top). A view calls the returned
 * function where its old `input === 'x'` chain began and branches on the action
 * id, so the TOML keymap decides which key means which verb.
 * @param {string|string[]} scopes keymap scopes, in precedence order
 * @param {object} [config] effective config (defaults to the cached app config)
 * @returns {(input: string, key: object) => string|null} resolver
 */
export function useActionResolver(scopes, config) {
  const scopeKey = [].concat(scopes).join('|')
  const keymap = useMemo(
    () => createKeymap(scopeKey.split('|'), config || getActionConfig()),
    [scopeKey, config],
  )
  const last = useRef({ input: null, at: 0 })
  return useCallback((input, key) => {
    const now = Date.now()
    const prev = last.current
    const plain = input && input.length === 1 && !key.ctrl && !key.meta ? input : null
    last.current = { input: plain, at: now }
    if (plain && prev.input && now - prev.at <= CHORD_WINDOW_MS) {
      const chord = keymap.resolveToken(`${prev.input}${plain}`)
      if (chord) { last.current = { input: null, at: 0 }; return chord }
    }
    return keymap.resolve(input, key)
  }, [keymap])
}

// ─── Prefix keys (which-key) ─────────────────────────────────────────────────
// A prefix key (`g`) arms a short window in which the next key picks a
// continuation. Handlers registered through useKeymapInput run before the root
// handler (children's effects register first), so while a prefix is armed they
// must not also act on the continuation key. This module state is the single
// place that coordination lives.

let armedPrefix = null

/**
 * Arm a prefix. `continuations` are the keys that complete it.
 * @param {string} prefix the prefix key
 * @param {Iterable<string>} continuations keys that complete the prefix
 */
export function armPrefix(prefix, continuations) {
  armedPrefix = { prefix, continuations: new Set(continuations) }
}

/** Clear any armed prefix. */
export function disarmPrefix() {
  armedPrefix = null
}

/**
 * The armed prefix, if any.
 * @returns {{ prefix: string, continuations: Set<string> }|null} snapshot
 */
export function getArmedPrefix() {
  return armedPrefix
}

/**
 * True when this event belongs to the armed prefix and must not reach view handlers.
 * @param {string} input typed character
 * @param {object} [key] Ink key flags
 * @returns {boolean} whether view handlers must skip the event
 */
export function prefixConsumes(input, key = {}) {
  if (!armedPrefix) return false
  if (key.escape) return true
  return armedPrefix.continuations.has(input)
}

/**
 * Transitional hook for feature panes while handlers move to action dispatch.
 * Keeps `src/features` free of direct Ink useInput calls, and keeps prefix
 * continuations (`g p`) away from view-level handlers.
 * @param handler
 * @param opts
 */
export function useKeymapInput(handler, opts) {
  return useInput((input, key) => {
    if (prefixConsumes(input, key)) return
    handler(input, key)
  }, opts)
}
