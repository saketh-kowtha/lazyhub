/**
 * src/focus/FocusProvider.js — React binding for the focus router (#483).
 *
 * One root useInput feeds every key event to the router. Components register through
 * useFocusEntry(); the claim happens in a layout effect against a ref-held stack, so
 * the commit that mounts a dialog already routes keys to it (no one-commit lag).
 */

import React, { createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useRootInput } from '../hooks/useSafeInput.js'
import { useCovered } from '../shell/covered.js'
import { focusRouter } from './router.js'

const FocusContext = createContext({ router: focusRouter, activeScope: 'global', provided: false })

/**
 * Owns the single root useInput and re-renders consumers when the stack changes.
 * @param {{ children: import('react').ReactNode, router?: object, globals?: (input: string, key: object) => void }} props
 * @returns {import('react').ReactElement} provider element
 */
export function FocusProvider({ children, router = focusRouter, globals }) {
  const [activeScope, setActiveScope] = useState(() => router.activeScope())

  useLayoutEffect(() => {
    // The router's own answer is synchronous; only the React-visible copy (context
    // consumers re-rendering) trails by a microtask, as the old passive-effect claim did.
    let live = true
    const sync = () => setActiveScope(router.activeScope())
    const later = () => { Promise.resolve().then(() => { if (live) sync() }) }
    later() // claims made by children's layout effects, before this subscription existed
    const off = router.subscribe(later)
    return () => { live = false; off() }
  }, [router])

  const globalsRef = useRef(globals)
  globalsRef.current = globals
  useLayoutEffect(() => {
    if (!globals) return undefined
    router.setGlobals((input, key) => globalsRef.current?.(input, key))
    return () => router.setGlobals(null)
  }, [router, Boolean(globals)]) // eslint-disable-line react-hooks/exhaustive-deps

  useRootInput((input, key) => { router.dispatch(input, key) })

  const value = useMemo(() => ({ router, activeScope, provided: true }), [router, activeScope])
  return React.createElement(FocusContext.Provider, { value }, children)
}

/**
 * Register the app's global key handler: it runs for every key no entry captured, after
 * the entries (children first), exactly like the old root-level useInput in App.
 * @param {(input: string, key: object) => void} handler latest handler; kept in a ref
 */
export function useFocusGlobals(handler) {
  const ctx = useContext(FocusContext)
  const latest = useRef(handler)
  latest.current = handler
  useLayoutEffect(() => {
    if (!ctx.provided) return undefined
    ctx.router.setGlobals((input, key) => latest.current?.(input, key))
    return () => ctx.router.setGlobals(null)
  }, [ctx.router, ctx.provided])
  // Outside a provider nothing feeds the router: listen directly.
  // The handler re-checks the provider itself: a test double may ignore `isActive`.
  useRootInput((input, key) => { if (!ctx.provided) latest.current?.(input, key) }, { isActive: !ctx.provided })
}

/** The scope on top of the stack, read without claiming one. */
export function useFocusScope() {
  return useContext(FocusContext).activeScope
}

let anonymous = 0

/**
 * Register a key handler with the focus manager.
 *
 * @param {string|null} id stable name for describeFocus (null: generated)
 * @param {((input: string, key: object) => void)|null} handler latest handler; kept in a ref so it may change every render
 * @param {object} [opts]
 * @param {string|null} [opts.scope] scope to claim; the handler only fires while it is the active scope
 * @param {boolean} [opts.active=true] false neither claims nor receives keys
 * @param {boolean} [opts.captures] take keys exclusively
 * @param {boolean} [opts.skipOnPrefix] ignore the continuation of an armed prefix
 * @param {boolean} [opts.yieldToModal] scope-less listener that stays silent while an overlay, dialog or input is on top
 * @param {boolean} [opts.isActive] extra live gate for scope-less listeners
 * @returns {{ isActive: boolean, activeScope: string }} activation state
 */
export function useFocusEntry(id, handler, opts = {}) {
  const ctx = useContext(FocusContext)
  const { scope = null, captures = false, skipOnPrefix = false, yieldToModal = false } = opts
  // A covered view (an overlay or a deeper view is on screen instead) neither claims nor receives keys (#597).
  const covered = useCovered()
  const active = (opts.active ?? true) && !covered
  const gate = opts.isActive
  const latest = useRef({ handler, gate })
  latest.current = { handler, gate }
  const idRef = useRef(null)
  if (idRef.current === null) idRef.current = id ?? `entry-${++anonymous}`
  const hasHandler = Boolean(handler)

  useLayoutEffect(() => {
    if (!active || !ctx.provided) return undefined
    return ctx.router.claim({
      id: idRef.current,
      scope,
      captures,
      skipOnPrefix,
      yieldToModal,
      handler: hasHandler ? (input, key) => latest.current.handler?.(input, key) : null,
      isActive: () => latest.current.gate !== false,
    })
  }, [ctx.router, ctx.provided, active, scope, captures, skipOnPrefix, yieldToModal, hasHandler])

  // Outside a FocusProvider nothing feeds the router, so fall back to a plain listener.
  // The handler re-checks the gate itself: it must stay inert inside a provider even
  // where a test double ignores `isActive`.
  const standalone = !ctx.provided && active && hasHandler && gate !== false
  useRootInput((input, key) => { if (standalone) latest.current.handler?.(input, key) }, {
    isActive: standalone,
  })

  const live = ctx.router.activeScope()
  return { isActive: active && (scope ? live === scope : true), activeScope: ctx.provided ? live : ctx.activeScope }
}
