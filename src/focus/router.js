/**
 * src/focus/router.js — the pure key router (#483).
 *
 * "Who handles this key" has one answer, computed here. No React, no Ink: a React
 * provider (FocusProvider) feeds it key events and registers entries; tests drive it
 * directly.
 *
 * An entry is `{ id, scope, handler, captures }`:
 *  - `scope` names a claim on the scope stack (see SCOPE_LEVEL in keyscope.js). The
 *    topmost claim decides the active scope. A scoped entry with a handler only
 *    receives keys while its scope is the active one. `scope: null` is a listener that
 *    never claims; its own `isActive` gate decides (legacy useInput isActive).
 *  - `captures: true` means the entry takes the key exclusively: no other entry, and no
 *    global handler, sees it. When several capture, the most recently claimed wins.
 *  - `skipOnPrefix: true` makes the entry ignore the continuation key of an armed prefix.
 *  - `yieldToModal: true` makes a scope-less listener (a pane's key handler) stay silent while
 *    the top of the stack is an overlay, dialog or input, so the pane needs no `if (dialog) return`.
 *
 * Dispatch order: entries in claim order (children claim before parents, as Ink's
 * listeners registered). Without a capture, every eligible entry at the active scope
 * receives the key (the legacy behaviour panes still rely on until they migrate);
 * then the `globals` handler, unless something captured.
 *
 * Exceptions: a throwing handler (or rejected promise) is caught at dispatch, reported
 * through contain.js (log + toast) and the remaining entries still run.
 */

import { reportContained } from '../contain.js'
import { isModalScope } from './scopes.js'

/** Prefix keys the manager owns: armed by the app, consumed by dispatch. */
const NO_TTL = null

/**
 * @typedef {object} FocusEntry
 * @property {string} id stable identifier, shown by describeFocus
 * @property {string|null} [scope] scope claimed (null: listener only)
 * @property {((input: string, key: object) => any)|null} [handler] key handler
 * @property {boolean} [captures] take the key exclusively
 * @property {boolean} [skipOnPrefix] ignore the continuation of an armed prefix
 * @property {boolean} [yieldToModal] a scope-less listener that is skipped while an overlay, dialog or input owns the keys
 * @property {() => boolean} [isActive] live gate; false skips the handler
 */

/**
 * Create a router.
 * @param {{ onError?: (scope: string, err: unknown) => void, now?: () => number }} [opts] injectables
 * @returns {object} router
 */
export function createFocusRouter({ onError = reportContained, now = Date.now } = {}) {
  /** @type {FocusEntry[]} */
  let entries = []
  let globals = null
  let armed = null
  const listeners = new Set()
  let seq = 0

  const notify = () => { for (const l of listeners) l() }

  function activeScope() {
    for (let i = entries.length - 1; i >= 0; i -= 1) {
      if (entries[i].scope) return entries[i].scope
    }
    return 'global'
  }

  function liveArmed() {
    if (armed && armed.expiresAt !== NO_TTL && now() > armed.expiresAt) armed = null
    return armed
  }

  function guard(id, fn, input, key) {
    try {
      const result = fn(input, key)
      if (result && typeof result.then === 'function') result.then(undefined, err => onError(id, err))
      return result
    } catch (err) {
      onError(id, err)
      return undefined
    }
  }

  return {
    /**
     * Claim a place on the stack. Synchronous: the next dispatch already sees it.
     * @param {FocusEntry} entry entry to push
     * @returns {() => void} release
     */
    claim(entry) {
      const token = ++seq
      const stored = /** @type {any} */ ({ ...entry, _token: token })
      entries = [...entries, stored]
      notify()
      return () => {
        const before = entries.length
        entries = entries.filter(e => /** @type {any} */ (e)._token !== token)
        if (entries.length !== before) notify()
      }
    },

    /** The scope of the topmost claim, or 'global'. */
    activeScope,

    /**
     * Subscribe to stack changes (the React provider re-renders on them).
     * @param {() => void} listener called after every change
     * @returns {() => void} unsubscribe
     */
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    /**
     * Handler for keys nothing captured: registry-resolved globals.
     * @param {((input: string, key: object) => void)|null} fn handler, or null to clear
     */
    setGlobals(fn) {
      globals = fn || null
    },

    /**
     * Deliver one key event.
     * @param {string} input typed character
     * @param {object} [key] Ink-shaped key flags
     * @returns {{ delivered: string[], captured: boolean }} who received it
     */
    dispatch(input, key = {}) {
      const top = activeScope()
      const prefixHit = this.prefixConsumes(input, key)
      const eligible = entries.filter(e => {
        if (!e.handler) return false
        if (e.isActive && !e.isActive()) return false
        if (e.scope && e.scope !== top) return false
        if (e.skipOnPrefix && prefixHit) return false
        if (e.yieldToModal && !e.scope && isModalScope(top)) return false
        return true
      })
      const capturing = eligible.filter(e => e.captures)
      const targets = capturing.length ? [capturing[capturing.length - 1]] : eligible
      for (const e of targets) guard(e.id, e.handler, input, key)
      const captured = capturing.length > 0
      if (!captured && globals) guard('globals', globals, input, key)
      return { delivered: targets.map(e => e.id), captured }
    },

    // ─── Prefix chords (which-key) ──────────────────────────────────────────

    /**
     * Arm a prefix. `continuations` are the keys that complete it.
     * @param {string} prefix the prefix key
     * @param {Iterable<string>} continuations keys that complete the prefix
     * @param {{ ttlMs?: number }} [opts] optional expiry (the app may own its own timer)
     */
    armPrefix(prefix, continuations, { ttlMs } = {}) {
      armed = { prefix, continuations: new Set(continuations), expiresAt: ttlMs == null ? NO_TTL : now() + ttlMs }
    },

    /** Clear any armed prefix. */
    disarmPrefix() {
      armed = null
    },

    /** @returns {{ prefix: string, continuations: Set<string> }|null} the armed prefix */
    getArmedPrefix() {
      const a = liveArmed()
      return a ? { prefix: a.prefix, continuations: a.continuations } : null
    },

    /**
     * True when this event belongs to the armed prefix and must not reach view handlers.
     * @param {string} input typed character
     * @param {object} [key] Ink key flags
     * @returns {boolean} whether view handlers must skip the event
     */
    prefixConsumes(input, key = {}) {
      const a = liveArmed()
      if (!a) return false
      if (key.escape) return true
      return a.continuations.has(input)
    },

    /**
     * Snapshot for debug-state: ids, scopes and flags only, never key content.
     * @returns {{ activeScope: string, stack: object[], armedPrefix: string|null }} description
     */
    describe() {
      const a = liveArmed()
      return {
        activeScope: activeScope(),
        stack: entries.map(e => ({
          id: String(e.id),
          scope: e.scope ?? null,
          captures: Boolean(e.captures),
          hasHandler: Boolean(e.handler),
        })),
        armedPrefix: a ? a.prefix : null,
      }
    },

    /** Drop everything (tests, provider unmount). */
    reset() {
      entries = []
      globals = null
      armed = null
      notify()
    },
  }
}

/** The app-wide router. FocusProvider uses it unless handed another. */
export const focusRouter = createFocusRouter()

/**
 * Describe the app-wide router for the debug-state snapshot.
 * @returns {{ activeScope: string, stack: object[], armedPrefix: string|null }} description
 */
export function describeFocus() {
  return focusRouter.describe()
}
