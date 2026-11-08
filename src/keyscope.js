/**
 * keyscope.js — keyboard scope isolation for Ink TUI.
 *
 * Prevents key handlers in lower-priority components from firing when a
 * higher-priority scope (e.g. text input dialog) is active.
 *
 * Since #483 this is a thin layer over src/focus: one root useInput, a stack of
 * entries, claims made synchronously in a layout effect.
 *
 * Scope priority: global(0) < pane(1) < view(2) < overlay(3) < dialog(4) < input(5)
 *
 * Usage:
 *   const { isActive } = useKeyScope with scope 'pane'
 *   useInput(handler, { isActive })
 *
 *   // Or the convenience hook that combines claim + handler:
 *   useScopedInput('view', (input, key) => { … })
 *
 * Legacy aliases kept for backward compat: list=pane, detail=view
 */

import React from 'react'
import { FocusProvider, useFocusEntry, useFocusScope } from './focus/FocusProvider.js'

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

/**
 * KeyScopeProvider — kept under its old name; it is the focus manager's provider.
 *
 * @param {{ children: import('react').ReactNode }} props - React children
 * @returns {import('react').ReactElement} Provider element wrapping children
 */
export function KeyScopeProvider({ children }) {
  return React.createElement(FocusProvider, null, children)
}

/**
 * Claim a keyboard scope for this component.
 * Pass active=false to not claim (useful for conditional input modes).
 * Returns { isActive } — true iff this component's scope is the top of stack.
 *
 * @param {string} scope - Scope name from SCOPE_LEVEL (global/pane/view/overlay/dialog/input)
 * @param {boolean} [active=true] - When false, scope is not claimed and isActive is always false
 * @returns {{ isActive: boolean, activeScope: string }} current scope activation state
 */
export const useKeyScope = (scope, active = true) => useFocusEntry(null, null, { scope, active })

/** Read the current scope without claiming one. */
export function useActiveScope() {
  return useFocusScope()
}

/**
 * Convenience: claim a keyboard scope AND wire up a key handler in one call.
 * The handler only fires when this component's scope is the top of the stack.
 *
 * @param {string} scope - Scope name (global/pane/view/overlay/dialog/input)
 * @param {(input:string, key:object) => void} handler - key handler
 * @param {object} [opts]
 * @param {boolean} [opts.active=true] - When false, neither claims scope nor wires handler
 */
export function useScopedInput(scope, handler, opts = {}) {
  const active = opts.active !== false
  return useFocusEntry(null, handler, { scope, active })
}
