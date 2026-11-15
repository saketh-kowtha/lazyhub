// @ts-check
/**
 * features/queue/scope.js - which slice of the account the review queue shows (#177).
 *
 * Scopes, in cycle order: this repository (only when lazyhub was launched in a clone or with
 * --repo), the whole account, each organisation, each configured repository set. A scope is
 * only a search filter handed to fetchReviewQueueEvidence({scope}); the account scope sends no
 * filter, so the default behaviour is unchanged. Hosts are never mixed: a query only ever runs
 * against the host in GH_HOST (the queue memory is keyed by host as well).
 *
 * The starting scope: inside a repo launch, that repo. Otherwise the scope remembered from the
 * last session ([state] queueScope, like prScope), if it still exists, else the account.
 */
import { loadState, saveState } from '../../config.js'
import { loadConfig as loadTomlConfig } from '../../config/loader.js'
import { isOwnerName } from '../../config/schema.js'

export const ACCOUNT_SCOPE_ID = 'account'

/**
 * @typedef {{org?: string, repos?: string[]}} ScopeFilter
 * @typedef {{id: string, kind: 'repo'|'account'|'org'|'set', label: string, note: string, fetch: ScopeFilter|undefined}} QueueScope
 */

/**
 * The repository the user launched in (cwd) or named with --repo, or null. A repo that came from
 * the saved default, the first-run picker, a `owner/repo#N` reference or an in-app switch is not
 * "where the user is", so it does not narrow the queue.
 * @param {Record<string, string|undefined>} [env]
 * @returns {{repo: string, source: 'cwd'|'flag'}|null}
 */
export function launchRepoFromEnv(env = process.env) {
  const repo = env.GHUI_REPO || ''
  const source = env.GHUI_REPO_SOURCE
  if (!repo || !isOwnerName(repo)) return null
  if (source !== 'cwd' && source !== 'flag') return null
  return { repo, source }
}

/**
 * @param {object} input
 * @param {{repo: string, source: 'cwd'|'flag'}|null} [input.launch]
 * @param {string[]} [input.orgs] configured [queue].orgs
 * @param {Record<string, string[]>} [input.sets] configured [queue.sets]
 * @returns {QueueScope[]}
 */
export function buildScopes({ launch = null, orgs = [], sets = {} } = {}) {
  /** @type {QueueScope[]} */
  const out = []
  if (launch) {
    out.push({
      id: `repo:${launch.repo}`, kind: 'repo', label: `repo ${launch.repo}`,
      note: launch.source === 'cwd' ? 'from this directory' : 'from --repo',
      fetch: { repos: [launch.repo] },
    })
  }
  out.push({ id: ACCOUNT_SCOPE_ID, kind: 'account', label: 'account', note: 'all repos you can see', fetch: undefined })
  const seen = new Set()
  for (const org of [...(launch ? [launch.repo.split('/')[0]] : []), ...orgs]) {
    const key = org.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ id: `org:${org}`, kind: 'org', label: `org ${org}`, note: `every repo in ${org}`, fetch: { org } })
  }
  for (const [name, repos] of Object.entries(sets)) {
    out.push({
      id: `set:${name}`, kind: 'set', label: `set ${name}`,
      note: `${repos.length} ${repos.length === 1 ? 'repo' : 'repos'}`, fetch: { repos: [...repos] },
    })
  }
  return out
}

/**
 * The scope list for this process: the launch repo from the environment plus [queue] config.
 * @param {Record<string, string|undefined>} [env]
 * @returns {QueueScope[]}
 */
export function loadScopes(env = process.env) {
  const queue = /** @type {any} */ (loadTomlConfig()).queue || {}
  return buildScopes({ launch: launchRepoFromEnv(env), orgs: queue.orgs || [], sets: queue.sets || {} })
}

/** Scope remembered from the last session, or null. */
export function rememberedQueueScope() {
  const saved = /** @type {any} */ (loadState()).queueScope
  return typeof saved === 'string' && saved ? saved : null
}

/**
 * Remember the scope for the next launch. A repo scope is a property of where lazyhub was
 * launched, not a preference, so it is not stored.
 * @param {string} id
 */
export function rememberQueueScope(id) {
  if (id.startsWith('repo:') || rememberedQueueScope() === id) return
  saveState({ queueScope: id })
}

/**
 * Pick the scope the queue opens on.
 * @param {QueueScope[]} scopes
 * @param {string|null} remembered
 * @returns {QueueScope}
 */
export function initialScope(scopes, remembered) {
  const repo = scopes.find(s => s.kind === 'repo')
  if (repo) return repo
  return scopes.find(s => s.id === remembered) || scopes.find(s => s.kind === 'account') || scopes[0]
}

/**
 * @param {QueueScope[]} scopes
 * @param {string} currentId
 * @returns {QueueScope} the scope after `currentId`, wrapping around
 */
export function nextScope(scopes, currentId) {
  const at = scopes.findIndex(s => s.id === currentId)
  return scopes[(at + 1) % scopes.length]
}

// The scope the queue shows survives opening a PR and coming back, like the group and row do.
/** @type {string|null} */
let sessionScopeId = null

/**
 * @param {QueueScope[]} scopes
 * @returns {QueueScope} the scope to show now (this session's choice, else the starting scope)
 */
export function currentScope(scopes) {
  return scopes.find(s => s.id === sessionScopeId) || initialScope(scopes, rememberedQueueScope())
}

/** @param {QueueScope} scope */
export function chooseScope(scope) {
  sessionScopeId = scope.id
  rememberQueueScope(scope.id)
}

/** Forget this session's scope choice (tests). */
export function resetQueueScope() { sessionScopeId = null }
