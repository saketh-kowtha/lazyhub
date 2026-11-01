// Deterministic teardown for the PTY harness (#505).
//
// Root cause of `ENOTEMPTY: rmdir /tmp/lazyhub-pty-*`: the flows ran `term.kill()` /
// `tmux kill-session` (both only SEND a signal) and then removed the temp dir at once. The app
// under test uses that dir as HOME and was still writing (cache, logs, config) while rmSync walked
// the tree, so a file appeared after readdir and rmdir failed. Fix: stop the process tree and WAIT
// until every pid is gone before removing anything. rmSync retries stay only as a last safety net.
//
// Safety: a pid is only ever SIGKILLed if it is still the same process we recorded (pid plus its
// start time), so a recycled pid is never signalled.
import { spawnSync } from 'child_process'
import { rmSync } from 'fs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}

/** Start time of a pid ('' when it does not exist): with the pid, this identifies one process. */
export function startTimeOf(pid) {
  return (spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).stdout || '').trim()
}

/** Every descendant of pid, found with `pgrep -P` (the app spawns gh and helpers). */
export function descendantsOf(pid) {
  const all = []
  const walk = parent => {
    const out = spawnSync('pgrep', ['-P', String(parent)], { encoding: 'utf8' }).stdout || ''
    for (const line of out.split('\n')) {
      const child = Number(line)
      if (child > 0 && !all.includes(child)) { all.push(child); walk(child) }
    }
  }
  walk(pid)
  return all
}

/**
 * Wait until the tracked processes are gone. `roots` are re-expanded on every poll, so a child
 * spawned while we wait is tracked too. Survivors get SIGKILL after `graceMs`, but only while they
 * are still the process we recorded. Returns the pids that are still alive (empty on success).
 *
 * @param {number[]} roots   pids whose descendants are tracked as well
 * @param {{graceMs?: number, killMs?: number, extra?: number[]}} [opts]
 * @returns {Promise<number[]>} survivors
 */
export async function waitForPidsGone(roots, { graceMs = 3000, killMs = 3000, extra = [] } = {}) {
  const tracked = new Map() // pid -> start time when first seen
  const track = pid => { if (!tracked.has(pid)) tracked.set(pid, startTimeOf(pid)) }
  const refresh = () => {
    for (const pid of [...roots, ...extra]) if (isAlive(pid)) track(pid)
    for (const root of roots) if (isAlive(root)) for (const pid of descendantsOf(root)) track(pid)
  }
  // A pid that now has a different start time is a recycled one: it is not ours and counts as gone.
  const live = () => [...tracked].filter(([pid, started]) => isAlive(pid) && startTimeOf(pid) === started).map(([pid]) => pid)
  const until = async ms => {
    const deadline = Date.now() + ms
    refresh()
    while (live().length && Date.now() < deadline) { await sleep(25); refresh() }
  }
  refresh()
  await until(graceMs)
  for (const pid of live()) { try { process.kill(pid, 'SIGKILL') } catch {} }
  await until(killMs)
  const survivors = live()
  if (survivors.length) process.stderr.write(`pty cleanup: still running after SIGKILL, temp dir may not remove cleanly: ${survivors.join(' ')}\n`)
  return survivors
}

/**
 * Stop a node-pty process and its descendants and wait for them to be gone.
 * `term` is { pid, kill(), exited: Promise } as built by spawnTerminal.
 *
 * @returns {Promise<number[]>} survivors (empty on success)
 */
export async function stopTerminal(term) {
  if (!term) return []
  const known = [term.pid, ...descendantsOf(term.pid)].filter(Boolean)
  try { term.kill() } catch {}
  const survivors = await waitForPidsGone([term.pid].filter(Boolean), { extra: known })
  await Promise.race([term.exited, sleep(1000)])
  return survivors
}

/** Kill a tmux session and wait for the whole process tree inside it. */
export async function stopTmuxSession(session) {
  const panes = spawnSync('tmux', ['list-panes', '-s', '-t', session, '-F', '#{pane_pid}'], { encoding: 'utf8' }).stdout || ''
  const roots = panes.split('\n').map(Number).filter(pid => pid > 0)
  const known = roots.flatMap(descendantsOf)
  spawnSync('tmux', ['kill-session', '-t', session])
  return waitForPidsGone(roots, { extra: known })
}

/** Remove a temp dir. Callers must have stopped every writer first; retries are a safety net only. */
export function removeTempDir(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
