/**
 * src/services/git.js — local git operations for UI code (#470, #479).
 *
 * The only way UI code touches the local clone. Three rules:
 *   1. Every function takes the checkout directory explicitly. It comes from `findLocalCheckout(repo)`
 *      (#471), so nothing here ever runs against `process.cwd()` by accident.
 *   2. Every command runs through `runGit()` (src/executor/git.js): classified, writes audited, argv an array.
 *   3. UI code imports these instead of spawning git, which also gives tests one seam to mock.
 */

import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { GIT_OP_TIMEOUT_MS, assertGitOk, runGit } from '../executor/git.js'

const PUSH_TIMEOUT_MS = 300_000

/**
 * Branch and remote names must not be parseable as options or contain control characters.
 * @param {unknown} value
 * @param {string} what
 */
function assertSafeRef(value, what) {
  if (typeof value !== 'string' || !value || value.startsWith('-') || /[\0\r\n]/.test(value)) {
    throw new Error(`Invalid ${what}`)
  }
}

// ─── Which clone is the viewed repo? (#471) ──────────────────────────────────

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
 * @returns {boolean}
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
// asks on every mount.
const checkoutCache = new Map()

/** Forget memoized checkout lookups (tests, or after the user changes remotes). */
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
    const result = await runGit(['remote', '-v'], { cwd, reject: false })
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
 * The message UI code shows when the viewed repo has no clone here.
 * @param {string} repo
 * @returns {string}
 */
export function noLocalCheckoutMessage(repo) {
  return `No local checkout of ${repo} here; run lazyhub inside a clone to use local git actions`
}

// ─── Branches ────────────────────────────────────────────────────────────────

/**
 * Name of the checked-out branch in `dir` ('' for a detached HEAD).
 * @param {string} dir
 * @returns {Promise<string>}
 */
export async function currentBranch(dir) {
  const result = await runGit(['branch', '--show-current'], { cwd: dir })
  return String(result.stdout || '').trim()
}

/**
 * Create `name` from HEAD and check it out.
 * @param {string} dir
 * @param {string} name
 */
export async function createBranch(dir, name) {
  assertSafeRef(name, 'branch name')
  await runGit(['checkout', '-b', name], { cwd: dir })
}

/**
 * Check out `branch` from the remote that points at the viewed repo. For `origin`
 * this is a plain checkout; for another remote (a fork clone viewing upstream) the
 * branch is fetched from that remote and tracked, so git never guesses the fork's
 * branch of the same name.
 * @param {{ dir: string, remote: string }} local from findLocalCheckout
 * @param {string} branch
 */
export async function checkout(local, branch) {
  assertSafeRef(branch, 'branch name')
  assertSafeRef(local.remote, 'remote name')
  const run = (args) => runGit(args, { cwd: local.dir })
  if (local.remote === 'origin') return run(['checkout', branch])
  await run(['fetch', local.remote, branch])
  const exists = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: local.dir, reject: false })
  return exists.exitCode === 0
    ? run(['checkout', branch])
    : run(['checkout', '-b', branch, '--track', `${local.remote}/${branch}`])
}

/**
 * Push `branch` (default HEAD) to `remote`. Throws with git's first error line on failure.
 * @param {string} dir
 * @param {string} remote
 * @param {string} [branch]
 * @returns {Promise<string>} git's output
 */
export async function push(dir, remote, branch = 'HEAD') {
  assertSafeRef(remote, 'remote name')
  assertSafeRef(branch, 'branch name')
  const result = await runGit(['push', remote, branch], { cwd: dir, reject: false, timeout: PUSH_TIMEOUT_MS })
  assertGitOk(result, 'git push', PUSH_TIMEOUT_MS)
  return result.stdout
}

/**
 * Local commits on `branch` that `remote/branch` does not have.
 * @param {string} dir
 * @param {string} remote
 * @param {string} branch
 * @returns {Promise<{ sha: string, message: string }[] | null>} null when the remote-tracking branch is absent
 */
export async function unpushedCommits(dir, remote, branch) {
  if (!branch) return []
  assertSafeRef(remote, 'remote name')
  assertSafeRef(branch, 'branch name')
  try {
    const result = await runGit(['log', `${remote}/${branch}..${branch}`, '--pretty=format:%h\t%s'], { cwd: dir, reject: false })
    if (result.exitCode !== 0) return null // remote-tracking branch absent
    if (!result.stdout.trim()) return []
    return result.stdout.trim().split('\n').map(line => {
      const tab = line.indexOf('\t')
      return { sha: line.slice(0, tab), message: line.slice(tab + 1) }
    })
  } catch {
    return null
  }
}

// ─── Conflict resolution ─────────────────────────────────────────────────────

/**
 * True when the working tree is in a mid-merge state (MERGE_HEAD exists).
 * @param {string} dir
 * @returns {Promise<boolean>}
 */
export async function isInMerge(dir) {
  const result = await runGit(['rev-parse', '--verify', 'MERGE_HEAD'], { cwd: dir, reject: false })
  return result.exitCode === 0
}

/**
 * Conflicting files from `git status --porcelain`: [{ path, xy }] where xy is
 * one of UU, AA, DD, AU, UA, DU, UD.
 * @param {string} dir
 * @returns {Promise<{ path: string, xy: string }[]>}
 */
export async function conflictedFiles(dir) {
  const result = await runGit(['status', '--porcelain'], { cwd: dir, reject: false })
  if (result.exitCode !== 0 || !result.stdout.trim()) return []
  return result.stdout.trim().split('\n')
    .filter(Boolean)
    .map(line => ({ xy: line.slice(0, 2), path: line.slice(3).trim() }))
    .filter(({ xy }) => /^(UU|AA|DD|AU|UA|DU|UD)$/.test(xy))
}

/**
 * Count `<<<<<<<` conflict markers in a file of the checkout. 0 when it is clean or does not exist.
 * @param {string} dir
 * @param {string} file
 * @returns {Promise<number>}
 */
export async function countConflictMarkers(dir, file) {
  try {
    const text = readFileSync(isAbsolute(file) ? file : join(dir, file), 'utf8')
    return text.split('\n').filter(line => line.startsWith('<<<<<<< ')).length
  } catch {
    return 0
  }
}

/**
 * Stage files (marks conflicts resolved).
 * @param {string} dir
 * @param {string[]} files
 */
export async function stage(dir, files) {
  if (!files?.length) return
  assertGitOk(await runGit(['add', '--', ...files], { cwd: dir, reject: false }), 'git add')
}

/**
 * Unstage files.
 * @param {string} dir
 * @param {string[]} files
 */
export async function unstage(dir, files) {
  if (!files?.length) return
  assertGitOk(await runGit(['restore', '--staged', '--', ...files], { cwd: dir, reject: false }), 'git restore')
}

/**
 * Abort an in-progress merge.
 * @param {string} dir
 */
export async function mergeAbort(dir) {
  assertGitOk(await runGit(['merge', '--abort'], { cwd: dir, reject: false }), 'git merge --abort')
}

/**
 * Commit the index with a message. Throws if the commit fails.
 * @param {string} dir
 * @param {string} message
 * @returns {Promise<string>} git's output
 */
export async function commit(dir, message) {
  const result = await runGit(['commit', '-m', message], { cwd: dir, reject: false })
  assertGitOk(result, 'git commit')
  return result.stdout
}

/**
 * Start merging `branch` into the current branch. A non-zero exit is expected when
 * conflicts occur: check `isInMerge` afterwards.
 * @param {string} dir
 * @param {string} branch
 * @returns {Promise<any>} the git result
 */
export async function mergeBranch(dir, branch) {
  assertSafeRef(branch, 'branch name')
  const result = await runGit(['merge', branch, '--no-edit'], { cwd: dir, reject: false })
  if (result.timedOut) throw new Error(`git merge timed out after ${GIT_OP_TIMEOUT_MS / 1000} s`)
  return result
}

/**
 * The auto-generated merge commit message of an in-progress merge.
 * @param {string} dir
 * @returns {Promise<string>}
 */
export async function mergeMessage(dir) {
  const fallback = 'Merge conflict resolution'
  try {
    const where = await runGit(['rev-parse', '--git-path', 'MERGE_MSG'], { cwd: dir, reject: false })
    const path = String(where.stdout || '').trim() || '.git/MERGE_MSG'
    return readFileSync(isAbsolute(path) ? path : join(dir, path), 'utf8').trim() || fallback
  } catch {
    return fallback
  }
}
