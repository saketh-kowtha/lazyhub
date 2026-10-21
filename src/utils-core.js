/**
 * src/utils-core.js — UI-free helpers (logger, path + text sanitizing).
 *
 * Split out of utils.js so CLI commands (doctor, watch-only, serve, --mcp, ...)
 * can use them without loading ink/react/highlight.js (#302). utils.js
 * re-exports everything here, so existing imports keep working.
 */
import { readFileSync, existsSync } from 'fs'
import { join, isAbsolute, dirname } from 'path'
import { homedir } from 'os'
import { appendPrivateFile, ensurePrivateDir } from './secure-fs.js'

const LOG_FILE = join(homedir(), '.config', 'lazyhub', 'debug.log')

/**
 * Global logger for debugging. Provides methods for different log levels.
 * Writes logs to ~/.config/lazyhub/debug.log in JSON format.
 */
export const logger = {
  /**
   * Logs an informational message.
   * @param {string} msg - The message to log.
   * @param {Object} [meta] - Additional metadata to include.
   */
  info:  (msg, meta) => log('INFO', msg, meta),

  /**
   * Logs a warning message.
   * @param {string} msg - The warning message.
   * @param {Object} [meta] - Additional metadata.
   */
  warn:  (msg, meta) => log('WARN', msg, meta),

  /**
   * Logs an error message with stack trace if available.
   * @param {string} msg - The error description.
   * @param {Error|any} err - The error object.
   * @param {Object} [meta] - Additional metadata.
   */
  error: (msg, err, meta) => log('ERROR', msg, { 
    ...meta, 
    error: err?.message || String(err),
    stack: err?.stack 
  }),

  /**
   * Logs a debug message.
   * @param {string} msg - The debug message.
   * @param {Object} [meta] - Additional metadata.
   */
  debug: (msg, meta) => log('DEBUG', msg, meta),
}

/**
 * Internal logging helper that writes to the log file.
 * @param {string} level - Log level (INFO, WARN, ERROR, DEBUG).
 * @param {string} message - The message body.
 * @param {Object} [meta] - Extra fields to merge into the JSON entry.
 */
function log(level, message, meta = {}) {
  try {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    }
    const line = JSON.stringify(entry) + '\n'
    ensurePrivateDir(dirname(LOG_FILE))
    appendPrivateFile(LOG_FILE, line)
  } catch {
    // ignore logging failures
  }
}

/**
 * Reads and parses logs from the log file. Returns them newest first.
 * @returns {Array<Object>} Array of parsed log objects.
 */
export function getLogs() {
  if (!existsSync(LOG_FILE)) return []
  try {
    const content = readFileSync(LOG_FILE, 'utf8')
    return content.trim().split('\n').map(line => {
      try { return JSON.parse(line) } catch { return null }
    }).filter(Boolean).reverse() // Newest first
  } catch {
    return []
  }
}

/**
 * Resolves paths starting with ~/ or relative paths to absolute paths.
 * @param {string} p - The path to resolve.
 * @returns {string} The absolute resolved path.
 */
export function resolvePath(p) {
  if (!p) return p
  if (typeof p !== 'string') return p
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  if (isAbsolute(p)) return p
  return join(process.cwd(), p)
}

/**
 * Strips ANSI escape codes from a string to prevent Terminal Injection.
 * @param {string} str - The string to clean.
 * @returns {string} The string without ANSI codes.
 */
export function stripAnsi(str) {
  if (typeof str !== 'string') return str
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
}

/**
 * Decode HTML character entities (e.g. &amp; &#39; &lt; &gt; &quot;).
 * Only decode the 5 common XML/HTML entities plus numeric decimal refs that
 * GitHub's API is known to emit.  Do NOT use a full HTML parser here — we only
 * need to undo what GitHub's REST/GraphQL serialiser escapes.
 * @param {string} str - String possibly containing HTML entities.
 * @returns {string} String with entities decoded.
 */
export function decodeHtmlEntities(str) {
  if (typeof str !== 'string') return String(str || '')
  return str
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g,  "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
}

/**
 * Sanitize untrusted text for rendering by stripping ANSI codes and decoding
 * HTML entities that GitHub's API may emit in text fields.
 * @param {string} str - The untrusted string from API.
 * @returns {string} A safe string for Ink rendering.
 */
export function sanitize(str) {
  return stripAnsi(decodeHtmlEntities(String(str || ''))).replace(/[\r\n\t]/g, ' ')
}
