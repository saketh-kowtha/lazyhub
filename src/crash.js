/**
 * crash.js — terminal restoration and fatal-crash reporting.
 */

const REPORT_LINE = 'This is a bug. Run: lazyhub --debug-state and report at https://github.com/saketh-kowtha/lazyhub/issues'

let installed = false
let restored = false

/**
 * Restore terminal modes that Ink/lazyhub may have changed.
 */
export function restoreTerminal() {
  if (restored) return
  restored = true
  try { if (process.stdin.isTTY && process.stdin.setRawMode) process.stdin.setRawMode(false) } catch { /* the terminal may already be gone while crashing */ }
  // Nothing to restore when stdout is a pipe or file; escapes there would corrupt machine output.
  if (!process.stdout.isTTY) return
  try { process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?25h\x1b[?1049l') } catch { /* closed stdout: nothing left to restore */ }
}

function formatError(err) {
  if (!err) return 'Unknown fatal error'
  if (err instanceof Error) return err.stack || err.message
  return String(err)
}

/**
 * Restore the terminal and print a concise bug-report pointer.
 * @param {unknown} err
 */
function reportFatalCrash(err) {
  restoreTerminal()
  process.stderr.write(`${formatError(err)}\n${REPORT_LINE}\n`)
}

/**
 * Install idempotent fatal-error and signal handlers.
 */
export function installCrashHandlers() {
  if (installed) return
  installed = true
  process.on('exit', restoreTerminal)
  process.on('uncaughtException', err => {
    reportFatalCrash(err)
    process.exit(1)
  })
  process.on('unhandledRejection', err => {
    reportFatalCrash(err)
    process.exit(1)
  })
  process.on('SIGINT', () => {
    restoreTerminal()
    process.exit(0)
  })
  process.on('SIGTERM', () => {
    restoreTerminal()
    process.exit(0)
  })
}
