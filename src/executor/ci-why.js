/**
 * ci-why.js — typed READ-ONLY lookups for "Why is CI red?" (issue #359, steps 2 and 3).
 * Everything goes through runGh() with array args; nothing here mutates.
 *
 * Two bounded questions:
 *  - which files did the PR change (path, previous path, status)? At most
 *    FILE_MAX_PAGES pages; past that the answer says `truncated` so the view can
 *    say the match is partial instead of pretending the list is complete.
 *  - did the same check fail on the base branch? One commits call plus one
 *    check-runs call per recent commit, at most BASE_RUNS_MAX commits.
 *
 * All text returned is untrusted GitHub data; the view cleans it before drawing.
 */

import { getRepo, runGh } from './core.js'

const FILE_PAGE = 100
export const FILE_MAX_PAGES = 10
export const BASE_RUNS_DEFAULT = 3
export const BASE_RUNS_MAX = 10

const repoPath = repo => encodeURIComponent(getRepo(repo)).replace('%2F', '/')

/**
 * @typedef {{path: string, previousPath: string|null, status: string}} ChangedFile
 */

/**
 * The PR's changed files, paths only (no patch text), up to FILE_MAX_PAGES pages.
 * Never throws for an expected failure: `error` says what went wrong and the files
 * fetched so far are kept.
 *
 * @param {string} repo
 * @param {number|string} number
 * @returns {Promise<{files: ChangedFile[], truncated: boolean, error: string|null}>}
 */
export async function listPRChangedPaths(repo, number) {
  const jq = '[.[] | {path: .filename, previousPath: .previous_filename, status: .status}]'
  /** @type {ChangedFile[]} */
  const files = []
  for (let page = 1; page <= FILE_MAX_PAGES; page++) {
    let rows
    try {
      rows = await runGh(['api', `repos/${repoPath(repo)}/pulls/${Number(number)}/files?per_page=${FILE_PAGE}&page=${page}`, '--jq', jq])
    } catch (err) {
      return { files, truncated: false, error: String(err?.message || err).split('\n')[0].slice(0, 120) || 'request failed' }
    }
    const list = Array.isArray(rows) ? rows : []
    for (const r of list) {
      if (r && typeof r.path === 'string' && r.path) {
        files.push({ path: r.path, previousPath: typeof r.previousPath === 'string' && r.previousPath ? r.previousPath : null, status: String(r.status || 'modified') })
      }
    }
    if (list.length < FILE_PAGE) return { files, truncated: false, error: null }
  }
  return { files, truncated: true, error: null }
}

/**
 * How a named check fared on the last few base-branch commits.
 *
 * `state`: 'ok' (some data), 'rate_limit', 'unavailable'. `samples` has one entry per
 * commit examined: `outcome` is 'failure' | 'success' | 'other' | 'missing' (the check did
 * not run there). `partial` is true when a commit's check list was longer than one page
 * (the check may be on a page we did not read) or a later call failed.
 *
 * @param {string} repo
 * @param {string} baseBranch
 * @param {string} checkName
 * @param {{limit?: number}} [opts]
 * @returns {Promise<{state: 'ok'|'rate_limit'|'unavailable', detail: string, samples: {sha: string, outcome: string}[], partial: boolean}>}
 */
export async function getBaseCheckHistory(repo, baseBranch, checkName, { limit = BASE_RUNS_DEFAULT } = {}) {
  const n = Math.max(1, Math.min(Math.floor(Number(limit)) || BASE_RUNS_DEFAULT, BASE_RUNS_MAX))
  if (!baseBranch) return { state: 'unavailable', detail: 'Base branch is unknown', samples: [], partial: false }
  /** @param {any} err */
  const fail = err => {
    const text = `${err?.message || ''}\n${err?.stderr || ''}`
    return /rate limit/i.test(text)
      ? { state: /** @type {const} */ ('rate_limit'), detail: 'GitHub API rate limit exceeded' }
      : { state: /** @type {const} */ ('unavailable'), detail: 'Could not read base-branch checks' }
  }
  let shas
  try {
    shas = await runGh(['api', `repos/${repoPath(repo)}/commits?sha=${encodeURIComponent(baseBranch)}&per_page=${n}`, '--jq', '[.[].sha]'])
  } catch (err) {
    return { ...fail(err), samples: [], partial: false }
  }
  if (!Array.isArray(shas) || shas.length === 0) return { state: 'unavailable', detail: 'No recent base-branch commits', samples: [], partial: false }
  const jq = '{total: .total_count, runs: [.check_runs[] | {name: .name, conclusion: .conclusion, status: .status}]}'
  /** @type {{sha: string, outcome: string}[]} */
  const samples = []
  let partial = false
  for (const sha of shas.slice(0, n)) {
    if (!/^[0-9a-f]{7,64}$/i.test(String(sha))) continue
    try {
      const res = await runGh(['api', `repos/${repoPath(repo)}/commits/${sha}/check-runs?per_page=100&filter=latest`, '--jq', jq])
      const runs = Array.isArray(res?.runs) ? res.runs : []
      const mine = runs.filter((/** @type {any} */ r) => r.name === checkName)
      let outcome = 'missing'
      if (mine.some((/** @type {any} */ r) => /^(failure|timed_out|startup_failure)$/.test(r.conclusion || ''))) outcome = 'failure'
      else if (mine.some((/** @type {any} */ r) => r.conclusion === 'success')) outcome = 'success'
      else if (mine.length) outcome = 'other'
      if (outcome === 'missing' && Number(res?.total) > runs.length) partial = true
      samples.push({ sha: String(sha).slice(0, 7), outcome })
    } catch (err) {
      if (samples.length === 0) return { ...fail(err), samples: [], partial: false }
      partial = true
      break
    }
  }
  return { state: 'ok', detail: '', samples, partial }
}
