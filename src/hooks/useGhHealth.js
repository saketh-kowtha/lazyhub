/**
 * useGhHealth.js — global degraded-state tracker for gh-backed requests.
 */

import { useEffect, useState } from 'react'
import { getDaemonFallback, onDaemonFallback } from '../daemon/fallback.js'
import { getContainedToast, onContained } from '../contain.js'

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
    // Non-error context shown when nothing is failing, e.g. running without the background helper (#491).
    notice: getDaemonFallback(),
    // A contained handler error (#490); shown for a few seconds.
    toast: getContainedToast(),
  }
}

/**
 * Return the current gh health snapshot.
 */
export function getGhHealthSnapshot() {
  return snapshot()
}

/**
 * Reset gh health singleton state for tests.
 */
export function resetGhHealthForTest() {
  state.lastError = null
  state.failing.clear()
  emit()
}

function emit() {
  const next = snapshot()
  for (const listener of listeners) listener(next)
}

onDaemonFallback(() => emit())
onContained(() => emit())

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
