/**
 * src/services/git.js — local git operations for UI code (#470, #479).
 *
 * Every function takes the checkout directory explicitly (resolved by
 * `findLocalCheckout`, #471), so nothing here ever runs against `process.cwd()`
 * by accident. UI components import these instead of spawning git themselves,
 * which also gives tests one seam to mock. Arguments are always arrays.
 */

import { execa } from 'execa'

const GIT_TIMEOUT_MS = 60_000
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

/**
 * Name of the checked-out branch in `dir` ('' for a detached HEAD).
 * @param {string} dir
 * @returns {Promise<string>}
 */
export async function currentBranch(dir) {
  const result = await execa('git', ['branch', '--show-current'], { cwd: dir, timeout: GIT_TIMEOUT_MS })
  return String(result.stdout || '').trim()
}

/**
 * Create `name` from HEAD and check it out.
 * @param {string} dir
 * @param {string} name
 */
export async function createBranch(dir, name) {
  assertSafeRef(name, 'branch name')
  await execa('git', ['checkout', '-b', name], { cwd: dir, timeout: GIT_TIMEOUT_MS })
}

/**
 * Push HEAD to `remote`.
 * @param {string} dir
 * @param {string} remote
 */
export async function pushHead(dir, remote) {
  assertSafeRef(remote, 'remote name')
  await execa('git', ['push', remote, 'HEAD'], { cwd: dir, timeout: PUSH_TIMEOUT_MS })
}
