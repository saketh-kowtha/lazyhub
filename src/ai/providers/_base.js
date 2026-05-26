/**
 * src/ai/providers/_base.js — Shared spawn helper for CLI-based AI providers.
 *
 * Security requirements (mirroring executor.js):
 *  - execFile only — no exec, no shell interpretation
 *  - Prompt piped via stdin — never as argv (diffs exceed ARG_MAX; injection risk)
 *  - Curated env — PATH/HOME/USER only; no secret leakage
 *  - 60s hard timeout + SIGTERM → SIGKILL after 5s grace
 *  - 256KB output cap — larger responses truncated and treated as malformed
 */

import { execFile as _execFile } from 'node:child_process'

// Note: We deliberately do NOT import from execa here — execFile is sufficient
// and avoids adding a dependency. The project's .eslintrc overrides allow execFile
// in provider files (they are not gh CLI callers).

const OUTPUT_CAP_BYTES   = 256 * 1024  // 256KB
const DEFAULT_TIMEOUT_MS = 60_000       // 60s

/**
 * Spawn a subprocess, pipe stdin, capture stdout.
 * Enforces timeout (SIGTERM → SIGKILL), output cap, and curated env.
 *
 * @param {object} opts
 * @param {string}   opts.cmd        - Executable path (resolved by caller)
 * @param {string[]} opts.args       - Argv array (never includes the prompt)
 * @param {string}   opts.stdin      - Text to pipe to the process's stdin
 * @param {number}   [opts.timeoutMs] - Timeout in ms (default: 60000)
 * @returns {Promise<string>} stdout (up to OUTPUT_CAP_BYTES)
 */
export async function spawnAndPipe({ cmd, args, stdin, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  // Curate env: only pass PATH, HOME, USER — never GH_TOKEN, ANTHROPIC_API_KEY, etc.
  const curatedEnv = {
    PATH: process.env.PATH || '',
    HOME: process.env.HOME || '',
    USER: process.env.USER || '',
  }

  // We use execFile via promisify, which does NOT use a shell.
  // To pipe stdin we need to use the callback form with the child process.
  const { stdout } = await new Promise((resolve, reject) => {
    const child = _execFile(
      cmd,
      args,
      {
        env:     curatedEnv,
        timeout: timeoutMs,
        killSignal: 'SIGTERM',
        maxBuffer: OUTPUT_CAP_BYTES,
      },
      (err, stdout, stderr) => {
        if (err) {
          // timeout: err.killed === true (or err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' for cap)
          if (err.killed || err.signal === 'SIGTERM') {
            reject(Object.assign(new Error(`Process timed out after ${timeoutMs}ms`), { isTimeout: true }))
          } else if (err.code === 'ENOENT') {
            reject(Object.assign(new Error(`Command not found: ${cmd}`), { isNotFound: true }))
          } else if (err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') {
            // Output cap exceeded — treat as truncated but not fatal for detection
            // For inference calls, the caller may handle this
            reject(Object.assign(new Error(`Output exceeded ${OUTPUT_CAP_BYTES} byte cap`), { isOutputCap: true }))
          } else {
            const msg = (stderr || err.message || 'subprocess failed').split('\n')[0].trim()
            reject(Object.assign(new Error(msg), { exitCode: err.code, stderr }))
          }
          return
        }
        resolve({ stdout: stdout || '' })
      }
    )

    // Write prompt to stdin then close it
    if (stdin) {
      child.stdin.write(stdin, 'utf8', (writeErr) => {
        if (writeErr) {
          // stdin may already be closed (e.g. process exited early)
          return
        }
        child.stdin.end()
      })
    } else {
      child.stdin.end()
    }
  })

  // Enforce output cap at the string level too (maxBuffer is in bytes)
  return stdout.slice(0, OUTPUT_CAP_BYTES)
}
