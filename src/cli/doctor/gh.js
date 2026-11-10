/**
 * cli/doctor/gh.js — is the GitHub CLI installed, answering and logged in?
 * Read-only: runs `gh --version` and `gh auth token` (the token is never
 * printed or kept), and turns a failure into the cause plus the next step.
 */

import { probeGh, checkAuthDetailed, formatFailureLines, BOOT_PROBE_TIMEOUT_MS } from '../../bootstrap.js'

/**
 * @param {{probe?: typeof probeGh, auth?: typeof checkAuthDetailed}} [deps]
 * @returns {Promise<{ok: boolean, checks: {ok: boolean, label: string}[]}>}
 */
export async function checkGh({ probe = probeGh, auth = checkAuthDetailed } = {}) {
  const found = await probe()
  if (!found.ok) {
    const label = found.timedOut
      ? `gh did not respond within ${BOOT_PROBE_TIMEOUT_MS / 1000}s (keychain prompt or slow credential helper?); run gh auth status`
      : 'gh (GitHub CLI) is not installed; install it from https://cli.github.com, then run gh auth login'
    return { ok: false, checks: [{ ok: false, label }] }
  }
  const checks = [{ ok: true, label: `gh installed${found.version ? ` (${found.version})` : ''}` }]
  const host = process.env.GH_HOST || 'github.com'
  const a = await auth()
  if (a.ok) checks.push({ ok: true, label: `Logged in to ${host}` })
  else if (a.timedOut) checks.push({ ok: false, label: 'gh auth token did not respond; run gh auth status' })
  else checks.push({ ok: false, label: formatFailureLines(a.failure || { cause: `Not logged in to ${host}`, fix: 'gh auth login' }).replace(/^ {2}✗ /, '').replace(/\n {4}/g, '; ') })
  return { ok: checks.every(c => c.ok), checks }
}
