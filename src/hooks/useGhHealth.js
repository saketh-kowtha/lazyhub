/**
 * useGhHealth.js — global degraded-state tracker for gh-backed requests.
 */

import { useEffect, useState } from 'react'
import { getDaemonFallback, onDaemonFallback } from '../daemon/fallback.js'
import { getContainedToast, onContained } from '../contain.js'
import { classifyGhFailure } from '../executor/classify.js'

// Only failures of the connection, the login or the rate limit say the whole gh session is
// degraded (#564). Anything else (a 422 for an unknown author, a missing item, a bad query)
// is caused by that call's own input and is shown by the pane that owns it.
const GLOBAL_KINDS = new Set([
  'gh_missing', 'gh_too_old', 'not_signed_in', 'wrong_host', 'sso', 'scope', 'forbidden', 'repo_not_found',
  'rate_limit', 'secondary_limit', 'offline',
])

/**
 * True when a failure belongs in global health (connection, auth, rate limit).
 * @param {unknown} error
 */
export function isGlobalGhFailure(error) {
  try { return GLOBAL_KINDS.has(classifyGhFailure(error).kind) } catch { return false }
}

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
  if (!isGlobalGhFailure(error)) {
    // Input-caused: the owning pane shows it. A newer, scoped failure replaces an older global one.
    clearGhFailure(callSite)
    return
  }
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
 * Forget a call site's failure when its owner unmounts or its query key changes (#564).
 * @param {string} callSite
 */
export function clearGhFailure(callSite) {
  if (!state.failing.delete(callSite)) return
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
