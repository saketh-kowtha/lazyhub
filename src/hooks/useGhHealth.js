/**
 * useGhHealth.js — global degraded-state tracker for gh-backed requests.
 */

import { useEffect, useState } from 'react'

const state = {
  lastError: null,
  failing: new Set(),
}
const listeners = new Set()

function snapshot() {
  return {
    error: state.lastError,
    failingCount: state.failing.size,
    degraded: state.failing.size > 0,
  }
}

function emit() {
  const next = snapshot()
  for (const listener of listeners) listener(next)
}

/**
 * Mark a gh-backed call site as failing.
 * @param {string} callSite
 * @param {unknown} error
 */
export function recordGhFailure(callSite, error) {
  state.failing.add(callSite)
  state.lastError = error
  emit()
}

/**
 * Mark a gh-backed call site as healthy.
 * @param {string} callSite
 */
export function recordGhSuccess(callSite) {
  state.failing.delete(callSite)
  if (state.failing.size === 0) state.lastError = null
  emit()
}

/**
 * Subscribe to the global gh health snapshot.
 */
export function useGhHealth() {
  const [value, setValue] = useState(snapshot)
  useEffect(() => {
    listeners.add(setValue)
    return () => listeners.delete(setValue)
  }, [])
  return value
}
