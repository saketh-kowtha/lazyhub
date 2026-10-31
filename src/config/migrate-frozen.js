/**
 * config/migrate-frozen.js — drop frozen copies of old defaults from a user config (#475).
 *
 * Releases before #475 copied the whole bundled defaultConfig.toml into the user's
 * lazyhub.toml on first run. Because config merges per key, that copy pinned every
 * action's scope/keys/label and every keymap binding to the values of the day, so a
 * later default change (a widened scope, a renamed action id) never reached the user.
 *
 * `stripFrozenDefaults` is pure and idempotent: it removes any [actions.<id>] field or
 * [keymaps.<scope>] binding that equals a value lazyhub ever shipped as a default, and
 * every binding that points at an action id which no longer exists. Anything the user
 * actually changed is kept untouched. Unknown ids that were never shipped are dropped
 * from the effective config and reported so the UI can say so once.
 */

import { LEGACY_ACTION_VALUES, LEGACY_KEYMAP_BINDINGS } from './legacy-defaults.js'
import { isPlainObject } from './schema.js'

const PLATFORM_OR_UNBIND = new Set(['unbind', 'darwin', 'linux', 'win32'])

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

function isShippedValue(id, field, value, current) {
  if (current !== undefined && sameValue(current[field], value)) return true
  return (LEGACY_ACTION_VALUES[id]?.[field] || []).some(shipped => sameValue(shipped, value))
}

/**
 * Remove frozen default copies from a parsed (raw, unvalidated) user config.
 * Does not mutate its input.
 *
 * @param {Object} userRaw parsed user TOML
 * @param {Object} defaults the current bundled defaults (needs `.actions`)
 * @returns {{ config: Object, dropped: number, unknown: string[] }}
 *   config: user config without frozen defaults; dropped: number of entries removed;
 *   unknown: sorted, de-duplicated action ids that exist neither now nor in any
 *   past release (worth telling the user about)
 */
export function stripFrozenDefaults(userRaw, defaults) {
  if (!isPlainObject(userRaw)) return { config: userRaw, dropped: 0, unknown: [] }
  const knownActions = isPlainObject(defaults?.actions) ? defaults.actions : {}
  const config = { ...userRaw }
  const unknown = new Set()
  let dropped = 0

  if (isPlainObject(userRaw.actions)) {
    const actions = {}
    for (const [id, entry] of Object.entries(userRaw.actions)) {
      if (!isPlainObject(entry)) { actions[id] = entry; continue }
      if (!knownActions[id]) {
        if (LEGACY_ACTION_VALUES[id]) { dropped += 1; continue }
        unknown.add(id)
        actions[id] = entry
        continue
      }
      const kept = {}
      for (const [field, value] of Object.entries(entry)) {
        if (isShippedValue(id, field, value, knownActions[id])) dropped += 1
        else kept[field] = value
      }
      if (Object.keys(kept).length > 0) actions[id] = kept
    }
    if (Object.keys(actions).length > 0) config.actions = actions
    else delete config.actions
  }

  if (isPlainObject(userRaw.keymaps)) {
    const keymaps = {}
    for (const [scope, bindings] of Object.entries(userRaw.keymaps)) {
      if (!isPlainObject(bindings)) { keymaps[scope] = bindings; continue }
      const kept = {}
      for (const [key, actionId] of Object.entries(bindings)) {
        if (typeof actionId !== 'string' || PLATFORM_OR_UNBIND.has(key)) { kept[key] = actionId; continue }
        if ((LEGACY_KEYMAP_BINDINGS[scope]?.[key] || []).includes(actionId)) { dropped += 1; continue }
        if (!knownActions[actionId]) {
          unknown.add(actionId)
          dropped += 1
          continue
        }
        kept[key] = actionId
      }
      if (Object.keys(kept).length > 0) keymaps[scope] = kept
    }
    if (Object.keys(keymaps).length > 0) config.keymaps = keymaps
    else delete config.keymaps
  }

  return { config, dropped, unknown: [...unknown].sort() }
}
