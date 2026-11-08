/**
 * src/services/ai-cli.js — The one place AI CLIs (claude, codex, gemini, agy) are spawned.
 * Providers in src/ai/providers/ only build an argv + auth spec and call runAiCli().
 *
 * Security requirements (mirroring executor.js):
 *  - spawn with an argv array and shell:false (own process group) — no exec, no shell interpretation
 *  - Prompt piped via stdin — never as argv (diffs exceed ARG_MAX; injection risk)
 *  - Isolation — empty 0700 temp cwd + throwaway HOME; minimal env plus the
 *    provider's explicit env-var auth only (no repo, no user agent settings)
 *  - Cleanup of the sandbox on success, error, timeout and parent termination
 *  - 60s hard timeout; SIGTERM then SIGKILL (after 5s) to the whole process group
 *  - stderr is capped (16KB), used only to classify errors, never shown or logged
 *  - Two profiles: 'sandbox' (throwaway HOME, default) and 'login' (#364: the CLI's
 *    own login is used in place from the real HOME; env is a strict allowlist and
 *    the CLI must have its tools turned off by the provider's argv)
 *  - 256KB output cap — larger responses truncated and treated as malformed
 */

import { spawn as _spawn } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, normalize, sep } from 'node:path'


const OUTPUT_CAP_BYTES   = 256 * 1024  // 256KB
const DEFAULT_TIMEOUT_MS = 60_000       // 60s
const KILL_GRACE_MS      = 5_000        // SIGTERM → SIGKILL grace
const STDERR_CAP_BYTES   = 16 * 1024
export const MIN_TIMEOUT_MS = 10_000
export const MAX_TIMEOUT_MS = 300_000

/**
 * Clamp a configured timeout to 10s..300s (default 60s).
 * @param {unknown} ms
 * @returns {number}
 */
export function clampTimeout(ms) {
  const n = Number(ms)
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.floor(n)))
}

// Never forward anything else from the parent env (proxy, GH_*, NODE_OPTIONS,
// other providers' keys...). Provider-specific vars arrive via `auth.env`.
const BASE_ENV_ALLOW = ['PATH', 'USER', 'LANG', 'LC_ALL']
// Login profile: the same list plus the real HOME. Nothing else is ever forwarded.
export const LOGIN_ENV_ALLOW = [...BASE_ENV_ALLOW, 'HOME']

const _activeDirs     = new Set()
const _activeChildren = new Set()
let   _hooksInstalled = false

/**
 * Collect the named env vars from the parent environment (non-empty only).
 * @param {string[]} names
 * @returns {Record<string,string>}
 */
export function pickEnv(names) {
  /** @type {Record<string,string>} */
  const out = {}
  for (const n of names) if (process.env[n]) out[n] = process.env[n]
  return out
}

function isolationError(message, cause) {
  return Object.assign(new Error(`Isolation unavailable: ${message}`), { isIsolationFailure: true, cause })
}

/** Synchronously kill live children and remove every live sandbox. Idempotent. */
export function cleanupAllIsolated() {
  for (const c of _activeChildren) killGroup(c, 'SIGKILL')
  _activeChildren.clear()
  for (const d of _activeDirs) { try { rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } }
  _activeDirs.clear()
}

function installExitHooks() {
  if (_hooksInstalled) return
  _hooksInstalled = true
  process.on('exit', cleanupAllIsolated)
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const handler = () => {
      cleanupAllIsolated()
      // Preserve default termination when nobody else handles the signal.
      if (process.listenerCount(sig) === 1) {
        process.removeListener(sig, handler)
        process.kill(process.pid, sig)
      }
    }
    process.on(sig, handler)
  }
}

/**
 * Build the sandbox: <root>/{work,home,tmp}, all 0700. Throws an
 * `isIsolationFailure` error (after removing anything created) on any failure.
 *
 * profile 'sandbox': HOME and the XDG dirs point at the throwaway home.
 * profile 'login':   HOME is the real one (the CLI's login is used in place and is
 *                    never read, copied or written by lazyhub); only cwd and TMPDIR
 *                    are the sandbox. The env is the LOGIN_ENV_ALLOW allowlist.
 * @param {{env?:Record<string,string>, homeEnv?:Record<string,string>, files?:Record<string,string>, fileEnv?:Record<string,string>}} auth
 * @param {'sandbox'|'login'} profile
 */
function createIsolation(auth, profile) {
  let root
  try {
    root = mkdtempSync(join(tmpdir(), 'lazyhub-ai-'))  // created 0700
    chmodSync(root, 0o700)
    _activeDirs.add(root)
    const work = join(root, 'work')
    const home = join(root, 'home')
    const tmp  = join(root, 'tmp')
    for (const d of [work, home, tmp]) mkdirSync(d, { mode: 0o700 })

    const login = profile === 'login'
    const env = login
      ? { ...pickEnv(LOGIN_ENV_ALLOW), ...(auth.env || {}) }
      : { ...(auth.env || {}), ...pickEnv(BASE_ENV_ALLOW) }
    for (const [name, rel] of Object.entries(auth.homeEnv || {})) {
      const p = join(home, normalize(rel))
      if (p !== home && !p.startsWith(home + sep)) throw new Error('config dir escapes isolated HOME')
      mkdirSync(p, { recursive: true, mode: 0o700 })
      env[name] = p
    }
    // Lazyhub-owned files (e.g. a CLI settings override) live in the sandbox root, 0600.
    for (const [rel, body] of Object.entries(auth.files || {})) {
      const p = join(root, normalize(rel))
      if (!p.startsWith(root + sep)) throw new Error('file escapes sandbox')
      writeFileSync(p, body, { mode: 0o600 })
      for (const [name, r] of Object.entries(auth.fileEnv || {})) if (r === rel) env[name] = p
    }
    if (login) {
      Object.assign(env, { TMPDIR: tmp, TERM: 'dumb', NO_COLOR: '1' })
    } else {
      Object.assign(env, {
        HOME:            home,
        TMPDIR:          tmp,
        XDG_CONFIG_HOME: join(home, '.config'),
        XDG_DATA_HOME:   join(home, '.local', 'share'),
        XDG_CACHE_HOME:  join(home, '.cache'),
      })
    }
    installExitHooks()
    return { root, work, env }
  } catch (err) {
    if (root) {
      try { rmSync(root, { recursive: true, force: true }) } catch { /* best effort */ }
      _activeDirs.delete(root)
    }
    throw isolationError(err.message, err)
  }
}

/**
 * Signal a child's whole process group (CLIs spawn helpers); fall back to the pid.
 * @param {any} child
 * @param {NodeJS.Signals} sig
 */
function killGroup(child, sig) {
  try {
    if (child?.pid) process.kill(-child.pid, sig)
    else child?.kill?.(sig)
  } catch {
    try { child?.kill?.(sig) } catch { /* already gone */ }
  }
}

/**
 * Spawn an AI CLI in an isolated sandbox, pipe stdin, capture stdout.
 * Enforces isolation (cwd + env), timeout (SIGTERM then SIGKILL on the process group),
 * output caps and a minimal env. The sandbox is removed on success, error, timeout
 * and parent termination. Rejects with `isIsolationFailure` if it can't be built.
 *
 * Errors never carry stderr text: it can echo auth URLs or tokens. They carry only
 * classification flags (`isAuth`) and the exit code.
 *
 * @param {object} opts
 * @param {string}   opts.cmd        - Executable (resolved by caller)
 * @param {string[]} opts.args       - Argv array (never includes the prompt)
 * @param {string}   opts.stdin      - Text to pipe to the process's stdin
 * @param {number}   [opts.timeoutMs] - Timeout in ms (default: 60000)
 * @param {'sandbox'|'login'} [opts.profile] - Isolation profile (default 'sandbox')
 * @param {object}   [opts.auth]     - Explicit auth handoff (everything else is withheld)
 * @returns {Promise<string>} stdout (up to OUTPUT_CAP_BYTES)
 */
export async function runAiCli({ cmd, args, stdin, timeoutMs = DEFAULT_TIMEOUT_MS, profile = 'sandbox', auth = {} }) {
  const iso = createIsolation(auth, profile)

  try {
    const { stdout } = await new Promise((resolve, reject) => {
      // spawn, not execFile: Node's execFile cannot start the child in its own process
      // group, and a timeout must reach helpers the CLI forked. argv array, no shell.
      const child = _spawn(cmd, args, {
        cwd:      iso.work,
        env:      iso.env,
        detached: true,
        shell:    false,
        timeout:  timeoutMs,
        killSignal: 'SIGTERM',
        stdio:    ['pipe', 'pipe', 'pipe'],
      })
      _activeChildren.add(child)

      const out = []
      const errBuf = []
      let outBytes = 0, errBytes = 0
      let capped = false, timedOut = false, settled = false
      const termTimer = setTimeout(() => { timedOut = true; killGroup(child, 'SIGTERM') }, timeoutMs)
      const killTimer = setTimeout(() => killGroup(child, 'SIGKILL'), timeoutMs + KILL_GRACE_MS)
      termTimer.unref?.()
      killTimer.unref?.()

      const finish = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(termTimer)
        clearTimeout(killTimer)
        _activeChildren.delete(child)
        killGroup(child, 'SIGKILL')  // helpers the CLI left behind
        fn(value)
      }

      child.stdout?.on('data', (chunk) => {
        if (capped) return
        outBytes += chunk.length
        if (outBytes > OUTPUT_CAP_BYTES) { capped = true; killGroup(child, 'SIGKILL'); return }
        out.push(chunk)
      })
      child.stderr?.on('data', (chunk) => {
        // Kept only to classify errors; capped; never surfaced.
        if (errBytes >= STDERR_CAP_BYTES) return
        errBytes += chunk.length
        errBuf.push(chunk)
      })
      child.stdin?.on?.('error', () => { /* process exited before reading stdin */ })
      child.on('error', (/** @type {any} */ err) => {
        if (err.code === 'ENOENT') finish(reject, Object.assign(new Error(`Command not found: ${cmd}`), { isNotFound: true }))
        else finish(reject, Object.assign(new Error(`${cmd} failed to start`), { exitCode: err.code }))
      })
      child.on('close', (code, signal) => {
        if (capped) return finish(reject, Object.assign(new Error(`Output exceeded ${OUTPUT_CAP_BYTES} byte cap`), { isOutputCap: true }))
        if (timedOut || signal === 'SIGTERM') return finish(reject, Object.assign(new Error(`Process timed out after ${timeoutMs}ms`), { isTimeout: true }))
        if (code !== 0) {
          const tail = Buffer.concat(errBuf).toString('utf8')
          return finish(reject, Object.assign(new Error(`${cmd} exited with ${code ?? signal ?? 'an error'}`), {
            exitCode: code,
            isAuth: /not logged in|unauthenticated|not authenticated|please (?:log ?in|sign in)|login required|\/login/i.test(tail),
          }))
        }
        finish(resolve, { stdout: Buffer.concat(out).toString('utf8') })
      })

      if (stdin) {
        child.stdin.write(stdin, 'utf8', (writeErr) => {
          if (!writeErr) child.stdin.end()  // on error the process already exited
        })
      } else {
        child.stdin.end()
      }
    })

    return stdout.slice(0, OUTPUT_CAP_BYTES)
  } finally {
    try { rmSync(iso.root, { recursive: true, force: true }) } catch { /* best effort */ }
    _activeDirs.delete(iso.root)
  }
}

/** Back-compat name used by the providers. */
export const spawnAndPipe = runAiCli
