/**
 * vitals.js - opt-in, local-only TUI vitals recorder (#597, V0).
 *
 * Enabled only by LAZYHUB_VITALS=1. Events go to a JSONL file (LAZYHUB_VITALS_FILE, default: the OS
 * temp dir, never the repo); nothing is ever sent anywhere. When disabled every method is one shared
 * no-op: no timers, no listeners, no allocations on hot paths and no fs calls.
 *
 * Privacy is structural, not by convention: an event only carries the whitelisted fields of its type.
 * Frames keep only a byte count and a clear flag (never the text). View and query-fn names must be short
 * identifiers chosen in code, else they become "?", so free text (titles, bodies, repo and branch names)
 * cannot reach the file. Callers must pass code constants, never data.
 */
import { appendFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const NAME_RE = /^[A-Za-z0-9_.:-]{1,64}$/
const MODES = new Set(['skeleton', 'data', 'empty', 'error'])
const KEY_CLASSES = new Set(['nav', 'open', 'other'])
const noop = () => {}

const safeName = value => (typeof value === 'string' && NAME_RE.test(value) ? value : '?')
const count = value => (Number.isFinite(value) && value >= 0 ? Math.min(Math.trunc(value), 2 ** 31) : 0)

/**
 * True when a stdout chunk contains a full-terminal clear (ESC[2J or ESC[3J).
 * @param {string} text
 * @returns {boolean}
 */
export function hasClear(text) {
  return text.includes('\x1b[2J') || text.includes('\x1b[3J')
}

/**
 * Build a recorder. Tests inject `append`/`now`; the app uses the env-driven singleton below.
 * @param {object} [opts]
 * @param {boolean} [opts.enabled]
 * @param {string} [opts.file] JSONL path
 * @param {(file: string, text: string) => void} [opts.append] sink, defaults to a private appendFileSync
 * @param {() => number} [opts.now] clock in ms, defaults to performance.now
 * @returns {object} recorder
 */
export function createRecorder({ enabled = false, file, append, now = () => performance.now() } = {}) {
  if (!enabled) {
    return { enabled: false, file: null, key: noop, frame: noop, mount: noop, unmount: noop, mode: noop, gh: noop, rowRender: noop, wrapStdout: stream => stream }
  }
  const target = file || join(tmpdir(), `lazyhub-vitals-${process.pid}.jsonl`)
  const sink = append || ((path, text) => appendFileSync(path, text, { mode: 0o600 }))
  // Written through on every event (enabled path only): small appends, and a crash loses nothing.
  const emit = event => {
    try { sink(target, `${JSON.stringify({ t: Math.round(now() * 1000) / 1000, ...event })}\n`) } catch { /* vitals must never break the app */ }
  }
  const frame = chunk => {
    const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : ''
    emit({ type: 'frame', bytes: Buffer.byteLength(text), clear: hasClear(text) })
  }
  return {
    enabled: true,
    file: target,
    key: cls => emit({ type: 'key', cls: KEY_CLASSES.has(cls) ? cls : 'other' }),
    frame,
    mount: view => emit({ type: 'mount', view: safeName(view) }),
    unmount: view => emit({ type: 'unmount', view: safeName(view) }),
    mode: (view, mode) => emit({ type: 'mode', view: safeName(view), mode: MODES.has(mode) ? mode : '?' }),
    gh: fn => emit({ type: 'gh', fn: safeName(fn) }),
    rowRender: (view, n = 1) => emit({ type: 'rowRender', view: safeName(view), n: count(n) }),
    /**
     * Pass-through stdout that timestamps each write. Ink 4 has no onRender hook, so this is the one
     * place a frame is observable.
     * @param {NodeJS.WriteStream} stream
     * @returns {NodeJS.WriteStream}
     */
    wrapStdout(stream) {
      return new Proxy(stream, {
        get(inner, prop) {
          if (prop === 'write') return (chunk, ...rest) => { frame(chunk); return inner.write(chunk, ...rest) }
          const value = Reflect.get(inner, prop, inner)
          return typeof value === 'function' ? value.bind(inner) : value
        },
      })
    },
  }
}

export const vitals = createRecorder({
  enabled: process.env.LAZYHUB_VITALS === '1',
  file: process.env.LAZYHUB_VITALS_FILE,
})
