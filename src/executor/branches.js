import { execa } from 'execa'
import { getRepo, runGh } from './core.js'
import { logger } from '../utils-core.js'

/**
 * Request reviewers for a PR.
 * @param repo
 * @param number
 * @param reviewers
 */
export async function requestReviewers(repo, number, reviewers) {
  const args = [
    'pr', 'edit', String(number),
    '--repo', getRepo(repo),
    '--add-reviewer', reviewers.join(','),
  ]
  return runGh(args)
}

/**
 * Remove reviewer requests from a PR.
 * @param repo
 * @param number
 * @param reviewers
 */
export async function removeReviewers(repo, number, reviewers) {
  const args = [
    'pr', 'edit', String(number),
    '--repo', getRepo(repo),
    '--remove-reviewer', reviewers.join(','),
  ]
  return runGh(args)
}

// ─── Branch functions ─────────────────────────────────────────────────────────

/**
 * Encode a git ref name for a REST path: "/" stays a path separator and every
 * other character is encoded per segment (`feat/a b` -> `feat/a%20b`).
 * @param {string} name
 */
export function encodeRefPath(name) {
  return String(name).split('/').map(encodeURIComponent).join('/')
}

const BRANCH_PAGE_SIZE = 100
/** Pages fetched per listing, so a repo with thousands of branches stays bounded (1000 branches). */
export const BRANCH_MAX_PAGES = 10

/**
 * List branches in a repo, following pages until a short page or BRANCH_MAX_PAGES.
 * @param repo
 */
export async function listBranches(repo) {
  const r = getRepo(repo)
  const all = []
  for (let page = 1; page <= BRANCH_MAX_PAGES; page++) {
    const args = [
      'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/branches?per_page=${BRANCH_PAGE_SIZE}&page=${page}`,
      '--jq', '[.[] | {name: .name, protected: .protected, commit: {sha: .commit.sha}}]',
    ]
    const rows = await runGh(args)
    if (!Array.isArray(rows)) return page === 1 ? rows : all
    all.push(...rows)
    if (rows.length < BRANCH_PAGE_SIZE) break
  }
  return all
}

/**
 * Checkout a PR's branch.
 * @param repo
 * @param number
 */
export async function checkoutBranch(repo, number) {
  const args = ['pr', 'checkout', String(number), '--repo', getRepo(repo)]
  return runGh(args)
}

/**
 * Delete a branch.
 * @param repo
 * @param branchName
 */
export async function deleteBranch(repo, branchName) {
  const r = getRepo(repo)
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/git/refs/heads/${encodeRefPath(branchName)}`,
    '--method', 'DELETE',
  ]
  return runGh(args)
}

// ─── Actions / runs functions ─────────────────────────────────────────────────

/**
 * Get PR state for a given branch head ref.
 *
 * Runs `gh pr list --head <branch>` and maps the first result to the IPC
 * response shape expected by the nvim statusline.
 *
 * CI status mapping:
 *   SUCCESS          → 'pass'
 *   FAILURE / ERROR  → 'fail'
 *   anything else    → 'pending'
 *   missing          → null
 *
 * @param {string} branch  - head ref name (e.g. 'feat/my-feature')
 * @param {string} [repo]  - optional repo override; falls back to GHUI_REPO
 * @returns {Promise<{prNumber:number|null, prState?:string, ciStatus?:string|null}>}
 */
export async function getPRStateForBranch(branch, repo) {
  if (!branch) return { prNumber: null }

  const args = [
    'pr', 'list',
    '--head', branch,
    '--json', 'number,state,statusCheckRollup',
    '--limit', '1',
  ]

  if (repo || process.env.GHUI_REPO) {
    args.push('--repo', getRepo(repo))
  }

  let results
  try {
    results = await runGh(args)
  } catch (err) {
    // If the call fails (e.g. no remote, rate-limit), degrade gracefully.
    logger.error(`getPRStateForBranch: gh pr list failed for ${branch}: ${err.message}`)
    return { prNumber: null }
  }

  if (!Array.isArray(results) || results.length === 0) {
    return { prNumber: null }
  }

  const pr = results[0]

  // Map statusCheckRollup to ciStatus
  let ciStatus = null
  const rollup = pr.statusCheckRollup
  if (Array.isArray(rollup) && rollup.length > 0) {
    // Rollup is an array of check objects; derive overall status from the worst conclusion
    const conclusions = rollup.map(c => (c.conclusion || c.state || '').toUpperCase())
    if (conclusions.some(c => c === 'FAILURE' || c === 'ERROR' || c === 'TIMED_OUT' || c === 'CANCELLED')) {
      ciStatus = 'fail'
    } else if (conclusions.every(c => c === 'SUCCESS')) {
      ciStatus = 'pass'
    } else {
      ciStatus = 'pending'
    }
  } else if (typeof rollup === 'string') {
    const s = rollup.toUpperCase()
    if (s === 'SUCCESS') ciStatus = 'pass'
    else if (s === 'FAILURE' || s === 'ERROR') ciStatus = 'fail'
    else if (s) ciStatus = 'pending'
  }

  return {
    prNumber: pr.number,
    prState:  pr.state,
    ciStatus,
  }
}

/**
 * Get a single remote branch (returns null if not found).
 * @param repo
 * @param branch
 */
export async function getRemoteBranch(repo, branch) {
  if (!branch) return null
  try {
    const r = getRepo(repo)
    return await runGh(['api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/branches/${encodeRefPath(branch)}`])
  } catch {
    return null
  }
}

/**
 * Compare two refs: how many commits head is ahead/behind base on GitHub.
 * Returns { ahead_by, behind_by, commits: [{sha, commit:{message}}] } or null.
 * @param repo
 * @param base
 * @param head
 */
export async function compareBranches(repo, base, head) {
  if (!base || !head) return null
  try {
    const r = getRepo(repo)
    return await runGh(['api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/compare/${encodeRefPath(base)}...${encodeRefPath(head)}`])
  } catch {
    return null
  }
}

/**
 * Get local commits on `branch` not yet pushed to origin/branch.
 * Returns array of {sha, message} or null if origin/branch doesn't exist.
 * @param branch
 */
export async function getUnpushedCommits(branch) {
  if (!branch) return []
  try {
    const result = await execa('git', [
      'log', `origin/${branch}..${branch}`,
      '--pretty=format:%h\t%s',
    ], { cwd: process.cwd(), reject: false })
    if (result.exitCode !== 0) return null  // remote tracking branch absent
    if (!result.stdout.trim()) return []
    return result.stdout.trim().split('\n').map(line => {
      const tab = line.indexOf('\t')
      return { sha: line.slice(0, tab), message: line.slice(tab + 1) }
    })
  } catch {
    return null
  }
}

/**
 * True when a remote URL points at the given owner/repo slug (any host,
 * ssh or https, optional .git suffix). Case-insensitive like GitHub.
 * @param {string} url
 * @param {string} repo  "owner/name" (a leading host segment is ignored)
 */
export function remoteMatchesRepo(url, repo) {
  const want = String(repo || '').split('/').filter(Boolean).slice(-2).join('/').toLowerCase()
  if (!want || !url) return false
  const path = String(url).trim().replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '').replace(/^[^/:]+[:/]/, '')
  const got = path.replace(/\/+$/, '').replace(/\.git$/i, '').split('/').slice(-2).join('/').toLowerCase()
  return got === want
}

/**
 * Directory of the local checkout of `repo`, or null when there is none.
 * Only the launch directory is considered (lazyhub keeps no clone registry):
 * it counts when one of its remotes is `repo`. Never throws.
 * @param {string} repo
 * @returns {Promise<string|null>}
 */
export async function findLocalCheckout(repo) {
  const cwd = process.cwd()
  try {
    const result = await execa('git', ['remote', '-v'], { cwd, reject: false })
    if (result.exitCode) return null
    const urls = String(result.stdout || '').split('\n').map(l => l.split(/\s+/)[1]).filter(Boolean)
    return urls.some(u => remoteMatchesRepo(u, repo)) ? cwd : null
  } catch {
    return null
  }
}

/**
 * Get the current local git branch name.
 */
export async function getCurrentBranch() {
  try {
    const result = await execa('git', ['branch', '--show-current'], { cwd: process.cwd() })
    return result.stdout.trim() || null
  } catch {
    return null
  }
}

/**
 * Push a branch to origin.
 * @param branch
 */
export async function pushBranch(branch) {
  const result = await execa('git', ['push', 'origin', branch], {
    cwd: process.cwd(),
    reject: false,
  })
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || 'git push failed').split('\n')[0].trim())
  }
  return result.stdout
}
