/**
 * keyscope.js — keyboard scope isolation for Ink TUI.
 *
 * Prevents useInput handlers in lower-priority components from firing when
 * a higher-priority scope (e.g. text input dialog) is active.
 *
 * Scope priority: global(0) < pane(1) < view(2) < overlay(3) < dialog(4) < input(5)
 *
 * Usage:
 *   const { isActive } = useKeyScope('pane')
 *   useInput(handler, { isActive })
 *
 *   // Or the convenience hook that combines claim + useInput:
 *   useScopedInput('view', (input, key) => { … })
 *
 * Legacy aliases kept for backward compat: list=pane, detail=view
 */

import React, { createContext, useContext, useState, useRef, useCallback, useMemo, useEffect } from 'react'
import { useInput } from 'ink'

export const SCOPE_LEVEL = {
  global:  0,
  pane:    1,
  list:    1,   // alias
  view:    2,
  detail:  2,   // alias
  overlay: 3,
  dialog:  4,
  input:   5,
}

const KeyScopeContext = createContext({
  activeScope: 'global',
  claim: (_scope) => () => {},
})

export function KeyScopeProvider({ children }) {
  const [, forceRender] = useState(0)
  const stackRef = useRef([{ id: 'root', scope: 'global' }])

  const claim = useCallback((scope) => {
    const id = Symbol('scope')
    stackRef.current = [...stackRef.current, { id, scope }]
    forceRender(n => n + 1)
    return () => {
      stackRef.current = stackRef.current.filter(c => c.id !== id)
      forceRender(n => n + 1)
    }
  }, [])

  const activeScope = stackRef.current[stackRef.current.length - 1]?.scope ?? 'global'

  const value = useMemo(() => ({ activeScope, claim }), [activeScope, claim])
  return React.createElement(KeyScopeContext.Provider, { value }, children)
}

/**
 * Claim a keyboard scope for this component.
 * Pass active=false to not claim (useful for conditional input modes).
 * Returns { isActive } — true iff this component's scope is the top of stack.
 */
export function useKeyScope(scope, active = true) {
  const ctx = useContext(KeyScopeContext)
  const releaseRef = useRef(null)

  useEffect(() => {
    if (active) {
      releaseRef.current = ctx.claim(scope)
      return () => {
        releaseRef.current?.()
        releaseRef.current = null
      }
    }
    return undefined
  }, [active, scope]) // eslint-disable-line react-hooks/exhaustive-deps

  const isActive = active && ctx.activeScope === scope
  return { isActive, activeScope: ctx.activeScope }
}

/** Read the current scope without claiming one. */
export function useActiveScope() {
  return useContext(KeyScopeContext).activeScope
}

/**
 * Convenience: claim a keyboard scope AND wire up a useInput handler in one call.
 * The handler only fires when this component's scope is the top of the stack.
 *
 * @param {string} scope - Scope name (global/pane/view/overlay/dialog/input)
 * @param {Function} handler - useInput handler (input, key) => void
 * @param {object} [opts]
 * @param {boolean} [opts.active=true] - When false, neither claims scope nor wires handler
 */
export function useScopedInput(scope, handler, opts = {}) {
  const active = opts.active !== false
  const { isActive } = useKeyScope(scope, active)
  useInput(handler, { isActive })
  return { isActive }
}
