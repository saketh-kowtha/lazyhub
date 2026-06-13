import { execa } from 'execa'
import { runGh } from './core.js'

/**
 * List the authenticated user's gists.
 */
export async function listGists() {
  return runGh(['gist', 'list', '--json', 'id,description,public,updatedAt,files', '--limit', '30'])
}

/**
 * View raw content of a gist.
 * @param id
 */
export async function getGist(id) {
  return runGh(['gist', 'view', id, '--raw'])
}

/**
 * Delete a gist by ID.
 * @param id
 */
export async function deleteGist(id) {
  return runGh(['gist', 'delete', id, '--yes'])
}

// ─── Git conflict-resolution helpers ─────────────────────────────────────────

/**
 * Returns true if the working tree is in a mid-merge state (MERGE_HEAD exists).
 */
export async function isInMerge() {
  const result = await execa('git', ['rev-parse', '--verify', 'MERGE_HEAD'],
    { cwd: process.cwd(), reject: false })
  return result.exitCode === 0
}

/**
 * Parse `git status --porcelain` and return conflicting file entries.
 * Each entry: { path, xy, resolved }
 *   xy       — two-letter status code (UU, AA, DD, AU, UA, DU, UD)
 *   resolved — file has been `git add`-ed (index clean, worktree clean)
 */
export async function getConflictedFiles() {
  const result = await execa('git', ['status', '--porcelain'],
    { cwd: process.cwd(), reject: false })
  if (result.exitCode !== 0 || !result.stdout.trim()) return []

  return result.stdout.trim().split('\n')
    .filter(Boolean)
    .map(line => {
      const xy   = line.slice(0, 2)
      const path = line.slice(3).trim()
      return { path, xy }
    })
    .filter(({ xy }) => /^(UU|AA|DD|AU|UA|DU|UD)$/.test(xy))
}

/**
 * Count `<<<<<<<` conflict markers in a local file.
 * Returns 0 if the file is clean (resolved) or doesn't exist.
 * @param {string} filePath
 */
export async function countFileConflicts(filePath) {
  try {
    const r = await execa('grep', ['-c', '^<<<<<<< ', filePath],
      { cwd: process.cwd(), reject: false })
    return parseInt(r.stdout.trim(), 10) || 0
  } catch { return 0 }
}

/**
 * Stage (git add) one or more files, marking them as resolved.
 * @param {string[]} files
 */
export async function gitAdd(files) {
  if (!files?.length) return
  const result = await execa('git', ['add', '--', ...files],
    { cwd: process.cwd(), reject: false })
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || 'git add failed').split('\n')[0].trim())
  }
}

/**
 * Unstage (git restore --staged) one or more files.
 * @param {string[]} files
 */
export async function gitUnstage(files) {
  if (!files?.length) return
  const result = await execa('git', ['restore', '--staged', '--', ...files],
    { cwd: process.cwd(), reject: false })
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || 'git restore failed').split('\n')[0].trim())
  }
}

/**
 * Abort an in-progress merge (`git merge --abort`).
 */
export async function gitMergeAbort() {
  const result = await execa('git', ['merge', '--abort'],
    { cwd: process.cwd(), reject: false })
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || 'git merge --abort failed').split('\n')[0].trim())
  }
}

/**
 * Commit with a message. Throws if the commit fails.
 * @param {string} message
 */
export async function gitCommit(message) {
  const result = await execa('git', ['commit', '-m', message],
    { cwd: process.cwd(), reject: false })
  if (result.exitCode !== 0) {
    throw new Error((result.stderr || result.stdout || 'git commit failed').split('\n')[0].trim())
  }
  return result.stdout
}

/**
 * Start merging `branch` into the current branch (`git merge <branch> --no-edit`).
 * May exit non-zero when conflicts occur — that is expected; check for MERGE_HEAD.
 * @param {string} branch
 */
export async function gitMergeBranch(branch) {
  return execa('git', ['merge', branch, '--no-edit'],
    { cwd: process.cwd(), reject: false })
}

/**
 * Read the auto-generated merge commit message from .git/MERGE_MSG.
 */
export async function getMergeCommitMessage() {
  try {
    const r = await execa('cat', ['.git/MERGE_MSG'],
      { cwd: process.cwd(), reject: false })
    return r.stdout.trim() || 'Merge conflict resolution'
  } catch { return 'Merge conflict resolution' }
}
