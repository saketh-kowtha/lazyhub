/**
 * cli/ai-login.js — `lazyhub ai login enable|disable <cli>` and `lazyhub ai status` (#364).
 *
 * Enabling login mode needs an explicit typed "yes" after the consent text.
 * Nothing here reads, prints or copies a credential.
 */

import { createInterface } from 'node:readline'
import { writeConfig } from '../config/writer.js'
import { clearDetectionCache } from '../ai/detect.js'
import { clearLoginCache } from '../ai/login.js'

/** CLI name on the command line -> [ai.login] key. Only implemented providers are listed. */
const SUPPORTED = { codex: 'codex' }

export const AI_USAGE = `Usage: lazyhub ai <command>

Commands:
  status                        show each AI provider, its auth mode and why it is unavailable
  login enable <cli>            use <cli>'s own subscription login in place (asks first)
  login disable <cli>           revoke; takes effect immediately

Supported <cli>: ${Object.keys(SUPPORTED).join(', ')}
Claude Code needs no login mode: run \`claude setup-token\` and export CLAUDE_CODE_OAUTH_TOKEN.
`

/**
 * The one-screen consent shown before login mode is enabled.
 * @param {string} cli
 * @returns {string}
 */
export const CONSENT_TEXT = (cli) => `Login mode for ${cli}

  - lazyhub will run ${cli} with your REAL home directory so it can use your existing
    subscription login. lazyhub never reads, copies or changes the credential files.
  - ${cli} is started with its tools off (shell, edits, MCP, extensions), an empty temporary
    working directory, and a minimal environment (no GitHub token, no API keys).
  - PR text is sent to ${cli}'s provider as untrusted data. Output is shown labelled as AI
    and is never posted to GitHub automatically.
  - What remains possible: lazyhub cannot sandbox the network or the filesystem. If a ${cli}
    release ignored its own no-tools flags, it could read files your user can read. Login mode
    stays unavailable unless the installed ${cli} proves those flags exist.
  - Revoke any time: lazyhub ai login disable ${cli}
`

function ask(question, input = process.stdin, output = process.stdout) {
  return new Promise(resolve => {
    const rl = createInterface({ input, output })
    rl.question(question, answer => { rl.close(); resolve(answer.trim().toLowerCase()) })
    rl.on('close', () => resolve(''))
  })
}

/**
 * @param {string[]} argv args after `ai`
 * @param {{out?:NodeJS.WritableStream, err?:NodeJS.WritableStream, answer?:(q:string)=>Promise<string>, configPath?:string}} [io]
 * @returns {Promise<number>} exit code
 */
export async function runAi(argv, io = {}) {
  const out = io.out || process.stdout
  const err = io.err || process.stderr
  const answer = io.answer || ((q) => ask(q))
  const writeOpts = io.configPath ? { configPath: io.configPath } : {}
  const [cmd, sub, cli] = argv

  if (!cmd || cmd === '-h' || cmd === '--help') { out.write(AI_USAGE); return cmd ? 0 : 2 }

  if (cmd === 'status') {
    const { formatAiReport } = await import('./doctor/ai.js')
    out.write(await formatAiReport())
    return 0
  }

  if (cmd === 'login' && (sub === 'enable' || sub === 'disable')) {
    const key = SUPPORTED[cli]
    if (!key) {
      err.write(`lazyhub ai login ${sub}: "${cli ?? ''}" is not supported (supported: ${Object.keys(SUPPORTED).join(', ')})\n`)
      return 2
    }
    if (sub === 'enable') {
      out.write(CONSENT_TEXT(cli))
      if ((await answer('Type "yes" to enable: ')) !== 'yes') { out.write('Not enabled.\n'); return 1 }
    }
    writeConfig({ ai: { login: { [key]: sub === 'enable' } } }, writeOpts)
    clearLoginCache()
    clearDetectionCache()
    out.write(sub === 'enable' ? `Login mode enabled for ${cli}.\n` : `Login mode disabled for ${cli}.\n`)
    return 0
  }

  err.write(AI_USAGE)
  return 2
}
