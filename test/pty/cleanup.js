// Deterministic teardown for the PTY harness (#505).
//
// Root cause of `ENOTEMPTY: rmdir /tmp/lazyhub-pty-*`: the flows ran `term.kill()` /
// `tmux kill-session` (both only SEND a signal) and then removed the temp dir at once. The app
// under test uses that dir as HOME and was still writing (cache, logs, config) while rmSync walked
// the tree, so a file appeared after readdir and rmdir failed. Fix: stop the process tree and WAIT
// until every pid is gone before removing anything. rmSync retries stay only as a last safety net.
import { spawnSync } from 'child_process'
import { rmSync } from 'fs'

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

export function isAlive(pid) {
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
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

/** Resolves true once every pid is dead; SIGKILLs whatever is left after `graceMs`. */
export async function waitForPidsGone(pids, { graceMs = 3000, killMs = 3000 } = {}) {
  const live = () => pids.filter(isAlive)
  const until = async ms => {
    const deadline = Date.now() + ms
    while (live().length && Date.now() < deadline) await sleep(25)
  }
  await until(graceMs)
  for (const pid of live()) { try { process.kill(pid, 'SIGKILL') } catch {} }
  await until(killMs)
  return live().length === 0
}

/**
 * Stop a node-pty process and its descendants and wait for them to be gone.
 * `term` is { pid, kill(), exited: Promise } as built by spawnTerminal.
 */
export async function stopTerminal(term) {
  if (!term) return
  const pids = [term.pid, ...descendantsOf(term.pid)].filter(Boolean)
  try { term.kill() } catch {}
  await waitForPidsGone(pids)
  await Promise.race([term.exited, sleep(1000)])
}

/** Kill a tmux session and wait for the whole process tree inside it. */
export async function stopTmuxSession(session) {
  const panes = spawnSync('tmux', ['list-panes', '-s', '-t', session, '-F', '#{pane_pid}'], { encoding: 'utf8' }).stdout || ''
  const pids = []
  for (const line of panes.split('\n')) {
    const pid = Number(line)
    if (pid > 0) pids.push(pid, ...descendantsOf(pid))
  }
  spawnSync('tmux', ['kill-session', '-t', session])
  await waitForPidsGone(pids)
}

/** Remove a temp dir. Callers must have stopped every writer first; retries are a safety net only. */
export function removeTempDir(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
