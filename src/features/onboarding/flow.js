/**
 * features/onboarding/flow.js — logic behind the zero-configuration first run (#70).
 *
 * Everything here is read-only: each gh call goes through runGh() as an
 * allowlisted read. The governance report is not shown on first run (#517); it
 * lives behind `lazyhub watch-only`.
 * Nothing is installed, created, authenticated or written; no marker file is
 * kept either: a first run is simply "no lazyhub.toml yet", and the normal
 * startup that follows completion creates it.
 */

import { existsSync } from 'fs'
import { classifyGhFailure, runGh } from '../../executor.js'
import { resolveCurrentRepo } from '../../executor/activity.js'
import { CONFIG_PATH } from '../../config.js'
import { isOwnerName } from '../../config/schema.js'
export { isOwnerName }

// One explicit, bounded page. Repositories beyond it are reached by validated
// owner/name lookup (lookupRepo), not by silently paging the whole account.
const REPO_LIST_PATH = 'user/repos?per_page=100&sort=pushed'

/**
 * Whether to show the first-run flow. Never for non-interactive sessions or
 * when an external launcher (nvim, MCP, tests) already picked a repository.
 *
 * @param {{argv?: string[], env?: object, isTTY?: boolean, configExists?: boolean}} [opts]
 * @returns {boolean}
 */
export function shouldOnboard({
  argv = process.argv, env = process.env,
  isTTY = !!(process.stdin.isTTY && process.stdout.isTTY),
  configExists = existsSync(CONFIG_PATH),
} = {}) {
  if (!isTTY || env.LAZYHUB_SKIP_ONBOARDING === '1') return false
  if (argv.includes('--onboarding')) return true
  return !configExists && !env.GHUI_REPO
}

/**
 * Bucket a failed gh call for display.
 *
 * @param {any} err
 * @returns {'no_gh'|'auth'|'rate_limit'|'permission'|'error'}
 */
export function classifyFailure(err) {
  const { kind } = classifyGhFailure(err)
  if (kind === 'gh_missing') return 'no_gh'
  if (kind === 'not_signed_in') return 'auth'
  if (kind === 'rate_limit' || kind === 'secondary_limit') return 'rate_limit'
  if (['sso', 'scope', 'forbidden', 'repo_not_found', 'not_found'].includes(kind)) return 'permission'
  return 'error'
}

/**
 * Confirm the existing gh login works and list candidate repositories.
 * The current directory's repository (if any) is first.
 *
 * @returns {Promise<{login: string, repos: {name: string, current: boolean}[], listError: string|null}>}
 * @throws when gh is missing or not signed in
 */
export async function loadSession() {
  const user = await runGh(['api', 'user'])
  const login = typeof user?.login === 'string' ? user.login : ''
  let current = null
  try { current = await resolveCurrentRepo() } catch { /* not inside a repository */ }
  let names = []
  let listError = null
  try {
    const rows = await runGh(['api', REPO_LIST_PATH])
    names = (Array.isArray(rows) ? rows : []).map(r => r?.full_name).filter(n => typeof n === 'string')
  } catch (err) {
    listError = classifyFailure(err)
    if (!current) throw err
  }
  const repos = [...(current ? [current] : []), ...names.filter(n => n !== current)]
    .map(name => ({ name, current: name === current }))
  return { login, repos, listError }
}

/**
 * Confirm a typed owner/name exists and is readable by the gh login (one typed
 * read). Resolves to GitHub's canonical spelling.
 *
 * @param {string} slug  owner/name
 * @returns {Promise<string>}
 * @throws when the slug is malformed, missing or unreadable
 */
export async function lookupRepo(slug) {
  if (!isOwnerName(slug)) throw new Error('not found: invalid owner/name')
  const view = await runGh(['repo', 'view', slug, '--json', 'nameWithOwner'])
  const name = view?.nameWithOwner
  if (typeof name !== 'string' || !isOwnerName(name)) throw new Error('not found')
  return name
}

/**
 * Stable identity of a repository row: GitHub names are unique and
 * case-insensitive, so selection survives list refreshes and filtering.
 *
 * @param {string} name  owner/name
 * @returns {string}
 */
export const repoKey = name => name.toLowerCase()

/**
 * How many list rows fit (one spare row so Ink never fills the screen): see docs/mockups/onboarding-first-run-a-search.md.
 *
 * @param {number} termRows
 * @param {number} [extraLines]  optional notices shown above the list
 * @returns {number}
 */
export function listWindowSize(termRows, extraLines = 0) {
  return Math.max(3, termRows - 12 - extraLines)
}

/**
 * First visible index so that `selected` is inside a window of `size` rows.
 *
 * @param {number} total
 * @param {number} selected
 * @param {number} size
 * @returns {number}
 */
export function windowStart(total, selected, size) {
  if (total <= size) return 0
  const start = selected - Math.floor(size / 2)
  return Math.max(0, Math.min(start, total - size))
}
