/**
 * src/ai/providers/codex.js — Codex CLI provider.
 *
 * Uses the `codex` CLI for executing agent tasks.
 * Prompt is piped via stdin — never argv (diffs exceed ARG_MAX).
 *
 * Isolation (#252): runs in an empty temp cwd with a throwaway HOME/CODEX_HOME.
 * Auth is env-API-key only (CODEX_API_KEY / OPENAI_API_KEY). The user's
 * ~/.codex/auth.json (ChatGPT login) is deliberately NOT copied: Codex rotates
 * single-use refresh tokens, so a refresh inside the sandbox would silently
 * invalidate the user's real login. No key -> provider unavailable.
 *
 * Note: Codex outputs NDJSON event stream (one JSON object per line).
 * We take completed agent messages — `item.completed` with `item.type ===
 * 'agent_message'` (`item.text`), or the legacy top-level `agent_message`
 * (`message`) — and concatenate their text.
 */

import { spawnAndPipe, pickEnv, clampTimeout } from './_base.js'
import { AIError } from '../error.js'
import { mapCliError } from './_errors.js'
import { hasLoginConsent, resolveBin, checkManifest, isLoggedIn } from '../login.js'

// ── Provider metadata ─────────────────────────────────────────────────────────

export const id          = 'codex'
export const displayName = 'Codex CLI'
export const authSource  = 'CODEX_API_KEY or OPENAI_API_KEY'

// ── Capability flags ──────────────────────────────────────────────────────────

export const capabilities = {
  systemPrompt:   true,
  jsonMode:       false,
  promptCaching:  false,
}

// ── Isolation / auth ──────────────────────────────────────────────────────────

const AUTH_HELP = 'unavailable: set CODEX_API_KEY or OPENAI_API_KEY (a `codex login` ChatGPT session is not shared with the isolated run)'

/** Minimum auth material for the isolated run, or null if no API key is set. */
function resolveAuth() {
  const keys = pickEnv(['CODEX_API_KEY', 'OPENAI_API_KEY'])
  if (!Object.keys(keys).length) return null
  return { env: keys, homeEnv: { CODEX_HOME: '.codex' } }
}

// ── Login mode (#364, opt-in) ─────────────────────────────────────────────────
// Capability manifest: login mode needs every flag below to be present in the
// installed CLI's help, otherwise it is unavailable (fail closed). The shell-tool
// switch is NOT verified against a real release; the manifest requires `--disable`
// in `exec --help` and `shell_tool` in `features list` so a CLI without it fails.

export const loginCapability = {
  helpChecks: [{
    args: ['exec', '--help'],
    flags: ['--json', '--skip-git-repo-check', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--sandbox', '--disable'],
  }],
  textChecks: [{ args: ['features', 'list'], includes: ['shell_tool'] }],
}

const LOGIN_ARGS = ['--disable', 'shell_tool']

/** Env for login mode: CODEX_HOME only when the user set it. API keys are withheld. */
function loginEnv() {
  return pickEnv(['CODEX_HOME'])
}

/**
 * Resolve how codex will run: consented + capable + logged-in login mode, else the
 * API-key sandbox, else unavailable with a reason.
 * @returns {Promise<{mode:string, cmd?:string, reason?:string}>}
 */
async function resolveMode() {
  const keyAuth = resolveAuth()
  if (!hasLoginConsent(id)) return keyAuth ? { mode: 'sandbox' } : { mode: 'none', reason: AUTH_HELP }
  const fallback = keyAuth ? { mode: 'sandbox' } : null
  const cmd = resolveBin('codex')
  if (!cmd) return { mode: 'none', reason: 'codex CLI not found on PATH' }
  const cap = await checkManifest(cmd, loginCapability)
  if (!cap.ok) return fallback || { mode: 'none', reason: `unavailable: codex login mode ${cap.reason}` }
  if (!(await isLoggedIn(cmd, ['login', 'status'], loginEnv()))) {
    return fallback || { mode: 'none', reason: 'unavailable: not logged in (run `codex login`)' }
  }
  return { mode: 'login', cmd }
}

// ── Detection ─────────────────────────────────────────────────────────────────

/**
 * Detect whether the Codex CLI is available on PATH.
 * @returns {Promise<{available: boolean, version?: string, reason?: string, authMode?: string}>}
 */
export async function detect() {
  try {
    const stdout = await spawnAndPipe({
      cmd:       'codex',
      args:      ['--version'],
      stdin:     '',
      timeoutMs: 5_000,
    })
    const version = stdout.trim().split('\n')[0] || 'unknown'
    const m = await resolveMode()
    if (m.mode === 'none') return { available: false, version, reason: m.reason }
    return { available: true, version, authMode: m.mode }
  } catch (err) {
    if (err.isNotFound) {
      return { available: false, reason: 'codex CLI not found on PATH' }
    }
    return { available: false, reason: err.message }
  }
}

// ── Inference ─────────────────────────────────────────────────────────────────

/**
 * Run the prompt through the Codex CLI.
 *
 * The combined system+user prompt is piped via stdin in the format:
 *   <system>\n\n<user>
 *
 * Codex outputs NDJSON event stream. See the file header for the accepted
 * agent_message shapes.
 *
 * @param {object} opts
 * @param {string}  opts.system      - System prompt text
 * @param {string}  opts.user        - User message text
 * @param {number}  [opts.maxTokens] - Ignored (CLI controls max tokens)
 * @param {string}  [opts._model]    - Model override (not applicable to Codex)
 * @param {number}  [opts.timeoutMs] - Timeout override
 * @returns {Promise<{text: string, modelUsed: string, tokensIn: null, tokensOut: null}>}
 */
export async function complete({ system, user, _model, timeoutMs }) {
  const m = await resolveMode()
  if (m.mode === 'none') throw new AIError(m.reason, { code: 'auth-required', provider: id })
  const login = m.mode === 'login'
  const auth = login ? { env: loginEnv() } : resolveAuth()

  // Combine system + user into a single stdin payload
  const stdinPayload = system
    ? `${system}\n\n${user}`
    : user

  const argv = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ignore-user-config',     // never load $CODEX_HOME/config.toml (auth still uses CODEX_HOME)
    '--ignore-rules',           // no execpolicy .rules files
    '--ephemeral',              // no session files
    '--sandbox', 'read-only',
    ...(login ? LOGIN_ARGS : []),
  ]

  let rawOutput
  try {
    rawOutput = await spawnAndPipe({
      cmd:       login ? m.cmd : 'codex',
      args:      argv,
      stdin:     stdinPayload,
      timeoutMs: clampTimeout(timeoutMs),
      profile:   login ? 'login' : 'sandbox',
      auth,
    })
  } catch (err) {
    throw mapCliError(err, { id, name: 'Codex CLI', bin: 'codex', authHelp: AUTH_HELP })
  }

  // Parse NDJSON output: each line is a JSON event object
  const lines = rawOutput.trim().split('\n').filter(line => line.length > 0)
  const messages = []

  for (const line of lines) {
    try {
      const event = JSON.parse(line)
      if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
        // Current shape (codex exec --json 0.163): {type:'item.completed', item:{type:'agent_message', text}}
        if (typeof event.item.text === 'string') messages.push(event.item.text)
      } else if (event.type === 'agent_message' && typeof event.message === 'string') {
        // Legacy top-level shape, kept as a fallback
        messages.push(event.message)
      }
    } catch {
      // Silently skip unparseable lines (could be logging or other noise)
      continue
    }
  }

  if (messages.length === 0) {
    throw new AIError('No assistant message in Codex output', { code: 'malformed-response', provider: id })
  }

  const text = messages.join('')

  return {
    text,
    modelUsed: 'codex',  // Codex doesn't expose model name
    tokensIn:  null,     // CLI doesn't expose token counts
    tokensOut: null,
  }
}
