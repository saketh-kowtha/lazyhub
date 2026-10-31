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
 * Host and "owner/name" of a git remote URL (ssh, scp-style or https; optional
 * user@, port, trailing slash and .git). Lowercased, like GitHub.
 * @param {string} url
 * @returns {{ host: string, slug: string } | null}
 */
function parseRemoteUrl(url) {
  const raw = String(url || '').trim()
  if (!raw) return null
  let rest = raw.replace(/^[a-z+]+:\/\//i, '').replace(/^[^@/]+@/, '')
  const sep = rest.search(/[:/]/)
  if (sep < 0) return null
  const host = rest.slice(0, sep).toLowerCase()
  rest = rest.slice(sep + 1).replace(/^\d+\//, '') // ssh://host:2222/owner/repo
  const slug = rest.replace(/\/+$/, '').replace(/\.git$/i, '').split('/').slice(-2).join('/').toLowerCase()
  return slug.includes('/') ? { host, slug } : null
}

/**
 * True when a remote URL points at the given repo on the right host. The host is
 * the repo's own when it has one ("ghe.corp/owner/name"), otherwise GH_HOST, otherwise
 * github.com, so a github.com clone never counts as the checkout of a GHES repo.
 * @param {string} url
 * @param {string} repo  "owner/name" or "host/owner/name"
 */
export function remoteMatchesRepo(url, repo) {
  const parts = String(repo || '').split('/').filter(Boolean)
  if (parts.length < 2) return false
  const want = parts.slice(-2).join('/').toLowerCase()
  const wantHost = (parts.length > 2 ? parts[parts.length - 3] : (process.env.GH_HOST || 'github.com')).toLowerCase()
  const got = parseRemoteUrl(url)
  return !!got && got.slug === want && got.host === wantHost
}

// (cwd, host, repo) -> lookup. Remotes rarely change mid-session, and the Branches pane
// asks on every mount; clearLocalCheckoutCache() is for tests and an explicit refresh.
const checkoutCache = new Map()
export function clearLocalCheckoutCache() { checkoutCache.clear() }

/**
 * The local checkout of `repo` and the remote name that points at it, or null.
 * Only the launch directory is considered (lazyhub keeps no clone registry): it
 * counts when one of its remotes is `repo`. `origin` wins when several match.
 * Never throws.
 * @param {string} repo
 * @returns {Promise<{ dir: string, remote: string } | null>}
 */
export async function findLocalCheckout(repo) {
  const cwd = process.cwd()
  const key = `${cwd}\0${process.env.GH_HOST || ''}\0${repo}`
  if (!checkoutCache.has(key)) checkoutCache.set(key, lookupLocalCheckout(cwd, repo))
  return checkoutCache.get(key)
}

async function lookupLocalCheckout(cwd, repo) {
  try {
    const result = await execa('git', ['remote', '-v'], { cwd, reject: false })
    if (result.exitCode) return null
    const remotes = String(result.stdout || '').split('\n')
      .map(line => line.split(/\s+/))
      .filter(([name, url]) => name && remoteMatchesRepo(url, repo))
      .map(([name]) => name)
    if (!remotes.length) return null
    return { dir: cwd, remote: remotes.includes('origin') ? 'origin' : remotes[0] }
  } catch {
    return null
  }
}

/**
 * Check out `branch` from the remote that points at the viewed repo. For `origin`
 * this is a plain checkout; for another remote (a fork clone viewing upstream) the
 * branch is fetched from that remote and tracked, so git never guesses the fork's
 * branch of the same name.
 * @param {{ dir: string, remote: string }} local
 * @param {string} branch
 */
export async function checkoutRemoteBranch(local, branch) {
  const run = (args) => execa('git', args, { cwd: local.dir })
  if (local.remote === 'origin') return run(['checkout', branch])
  await run(['fetch', local.remote, branch])
  const exists = await execa('git', ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: local.dir, reject: false })
  return exists.exitCode === 0
    ? run(['checkout', branch])
    : run(['checkout', '-b', branch, '--track', `${local.remote}/${branch}`])
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
