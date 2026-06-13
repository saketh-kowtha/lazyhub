import { execa } from 'execa'
import { getRepo, runGh } from './core.js'

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
 * List branches in a repo.
 * @param repo
 */
export async function listBranches(repo) {
  const r = getRepo(repo)
  const args = [
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/branches?per_page=100`,
    '--jq', '[.[] | {name: .name, protected: .protected, commit: {sha: .commit.sha}}]',
  ]
  return runGh(args)
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
    'api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/git/refs/heads/${encodeURIComponent(branchName)}`,
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
 * @returns {Promise<{prNumber:number|null, prState?:string, ciStatus?:string|null, unresolvedThreads?:number}>}
 */
export async function getPRStateForBranch(branch, repo) {
  if (!branch) return { prNumber: null }

  const args = [
    'pr', 'list',
    '--head', branch,
    '--json', 'number,state,statusCheckRollup,reviewThreads',
    '--limit', '1',
  ]

  if (repo || process.env.GHUI_REPO) {
    args.push('--repo', getRepo(repo))
  }

  let results
  try {
    results = await runGh(args)
  } catch {
    // If the call fails (e.g. no remote, rate-limit), degrade gracefully.
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

  // Count unresolved review threads
  let unresolvedThreads
  if (Array.isArray(pr.reviewThreads)) {
    const count = pr.reviewThreads.filter(t => t.isResolved === false).length
    if (count > 0) unresolvedThreads = count
  }

  const response = {
    prNumber: pr.number,
    prState:  pr.state,
    ciStatus,
  }
  if (unresolvedThreads !== undefined) response.unresolvedThreads = unresolvedThreads

  return response
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
    return await runGh(['api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/branches/${encodeURIComponent(branch)}`])
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
    return await runGh(['api', `repos/${encodeURIComponent(r).replace('%2F', '/')}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`])
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
