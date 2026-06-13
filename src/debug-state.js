import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { getGhCallHistory } from './executor.js'

const CACHE_DIR = join(homedir(), '.cache', 'lazyhub')
const FILE_PREFIX = 'debug-state-'
const FILE_SUFFIX = '.json'

function packageInfo() {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return { name: pkg.name, version: pkg.version }
  } catch {
    return { name: 'lazyhub', version: 'unknown' }
  }
}

function safeNumber(value) {
  return Number.isFinite(value) ? value : null
}

function cleanString(value) {
  return String(value)
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[redacted]')
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]')
    .slice(0, 500)
}

function cleanValue(value, depth = 0) {
  if (depth > 4) return '[depth-limit]'
  if (value == null) return value
  if (typeof value === 'string') return cleanString(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.slice(0, 50).map(item => cleanValue(item, depth + 1))
  if (typeof value !== 'object') return String(value)

  const out = {}
  for (const [key, child] of Object.entries(value)) {
    if (/secret|password|auth|credential/i.test(key)) continue
    const safeKey = key.replace(/token/ig, 'redacted').replace(/api[_-]?key/ig, 'redacted')
    out[safeKey] = cleanValue(child, depth + 1)
  }
  return out
}

/**
 * Build the redacted debug-state object.
 * @param {object} appState optional app-level state snapshot
 * @returns {object} serializable debug-state payload
 */
export function collectDebugState(appState = {}) {
  const pkg = packageInfo()
  const state = cleanValue(appState)
  return {
    generatedAt: new Date().toISOString(),
    version: pkg.version,
    node: process.version,
    platform: {
      name: process.platform,
      arch: process.arch,
    },
    terminal: {
      columns: safeNumber(process.stdout.columns),
      rows: safeNumber(process.stdout.rows),
      term: cleanString(process.env.TERM || ''),
    },
    app: {
      activePane: state.activePane ?? null,
      view: state.view ?? null,
      itemNumber: state.itemNumber ?? null,
      filters: state.filters ?? {},
      cursors: state.cursors ?? {},
      dialog: state.dialog ?? null,
      mode: state.mode ?? null,
    },
    ghCalls: getGhCallHistory(),
    recentStatus: Array.isArray(state.recentStatus) ? state.recentStatus.slice(-5) : [],
  }
}

function ensureCacheDir() {
  mkdirSync(CACHE_DIR, { recursive: true })
}

/**
 * Find the newest debug-state file in the lazyhub cache directory.
 * @returns {string|null} absolute path, or null when none exists
 */
export function getMostRecentDebugStatePath() {
  if (!existsSync(CACHE_DIR)) return null
  const files = readdirSync(CACHE_DIR)
    .filter(file => file.startsWith(FILE_PREFIX) && file.endsWith(FILE_SUFFIX))
    .sort()
  const latest = files.at(-1)
  return latest ? join(CACHE_DIR, latest) : null
}

/**
 * Write a redacted debug-state snapshot to the lazyhub cache directory.
 * @param {object} appState optional app-level state snapshot
 * @returns {{path:string,state:object}} written path and payload
 */
export function writeDebugState(appState = {}) {
  ensureCacheDir()
  const state = collectDebugState(appState)
  const stamp = state.generatedAt.replace(/[:.]/g, '-')
  const path = join(CACHE_DIR, `${FILE_PREFIX}${stamp}${FILE_SUFFIX}`)
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  return { path, state }
}

/**
 * Return the latest debug-state payload, creating an environment-only dump if needed.
 * @returns {{path:string,state:object}} debug-state path and payload
 */
export function printDebugState() {
  const latest = getMostRecentDebugStatePath()
  if (latest) {
    return { path: latest, state: JSON.parse(readFileSync(latest, 'utf8')) }
  }
  return writeDebugState()
}
