/**
 * cli/feedback.js — lazyhub feedback (#316).
 *
 * Builds a redacted diagnostics report from the doctor config check plus
 * version/platform info, prints exactly what would be sent, and (only on an
 * interactive confirmation) opens the browser at a pre-filled new-issue URL.
 * lazyhub itself never sends anything: no fetch, no gh call, no background work.
 * Redaction builds on the #253 debug-state scrubber (cleanString).
 */

import { readFileSync } from 'fs'
import { homedir, userInfo, platform, arch, release } from 'os'
import { createInterface } from 'readline'
import { checkConfig } from './doctor/config.js'
import { cleanString } from '../debug-state.js'
import { sanitize } from '../utils-core.js'

export const FEEDBACK_REPO = 'saketh-kowtha/lazyhub'
// GitHub rejects very long request lines; stay well under the ~8 KB limit.
export const MAX_URL_LENGTH = 6000

export const FEEDBACK_USAGE = `Usage: lazyhub feedback [options]

Prepare a redacted diagnostics report and open a pre-filled GitHub issue.
Nothing is sent by lazyhub: you review the text, then submit it in your browser.

Options:
  --print          print the report only (also the behaviour when not a terminal)
  --include-host   keep your GitHub Enterprise hostname in the report
  -h, --help       print this help
`

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Redact one line of free text. Layers path, user, host and repo-slug
 * scrubbing over the #253 token/header/URL scrubber.
 * @param {string} text
 * @param {{hosts?: string[], includeHost?: boolean, users?: string[], home?: string}} [opts]
 * @returns {string}
 */
export function redactText(text, opts = {}) {
  const { hosts = [], includeHost = false, users = [], home = homedir() } = opts
  let out = sanitize(text)
  if (home && home !== '/') out = out.split(home).join('~')
  out = out.replace(/(?:[A-Za-z]:\\|~?\/)[^\s"'`,;)]*/g, m => (m === '/' || m === '~/' ? m : '[path]'))
  out = cleanString(out)
  for (const u of users) if (u && u.length > 1) out = out.replace(new RegExp(`\\b${escapeRe(u)}\\b`, 'gi'), '[user]')
  if (!includeHost) {
    for (const h of hosts) if (h && h.toLowerCase() !== 'github.com') out = out.replace(new RegExp(escapeRe(h), 'gi'), '[host]')
  }
  return out.replace(/\b[\w.-]+\/[\w.-]+(?:#\d+)?(?=$|[\s,.;:)])/g, m => (m.includes('[') ? m : '[repo]'))
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

/**
 * Build the report text. Only the doctor config check is used (local, read-only).
 * @param {{includeHost?: boolean, hosts?: string[], configPath?: string, env?: NodeJS.ProcessEnv, stdout?: {columns?: number, rows?: number}}} [opts]
 * @returns {string}
 */
export function buildReport(opts = {}) {
  const { includeHost = false, env = process.env, stdout = process.stdout } = opts
  const hosts = [...(opts.hosts || []), env.GH_HOST].filter(Boolean)
  const users = [env.USER, env.USERNAME, env.LOGNAME, (() => { try { return userInfo().username } catch { return '' } })()]
  const r = text => redactText(text, { hosts, includeHost, users })
  const doctor = checkConfig(opts.configPath ? { configPath: opts.configPath } : {})
  const host = hosts.find(h => h.toLowerCase() !== 'github.com')
  const lines = [
    '### Environment',
    `- lazyhub: ${packageVersion()}`,
    `- OS: ${platform()} ${release()} (${arch()})`,
    `- Node: ${process.version}`,
    `- Terminal: ${r(env.TERM_PROGRAM || '') || 'unknown'} ${r(env.TERM || '')} ${stdout.columns || '?'}x${stdout.rows || '?'}`.replace(/ +/g, ' '),
    `- GitHub host: ${host ? (includeHost ? r(host) : '[host] (private; use --include-host to share)') : 'github.com'}`,
    '',
    '### Doctor (config)',
    `- Overall: ${doctor.ok ? 'ok' : 'problems found'}`,
    ...doctor.checks.map(c => `- ${c.ok ? 'pass' : 'FAIL'}: ${r(c.label)}`),
    `- Theme: ${r(doctor.summary.theme || 'default')}`,
    `- Actions: ${doctor.summary.actions || 0}, key bindings: ${doctor.summary.keyBindings || 0}, custom tabs: ${doctor.summary.tabs || 0}`,
    ...doctor.warnings.map(w => `- Warning: ${r(w)}`),
    '',
    '### What happened',
    '<!-- Describe where you started and where you got stuck. -->',
  ]
  return `${lines.join('\n')}\n`
}

/**
 * Build the new-issue URL, truncating the body so the URL fits `maxLength`.
 * @param {string} body
 * @param {{maxLength?: number, title?: string}} [opts]
 * @returns {{url: string, truncated: boolean}}
 */
export function buildIssueUrl(body, opts = {}) {
  const { maxLength = MAX_URL_LENGTH, title = 'Feedback from lazyhub feedback' } = opts
  const base = `https://github.com/${FEEDBACK_REPO}/issues/new?title=${encodeURIComponent(title)}&body=`
  const note = '\n\n[report truncated to fit the URL length limit]'
  const full = base + encodeURIComponent(body)
  if (full.length <= maxLength) return { url: full, truncated: false }
  const chars = [...body]
  let lo = 0
  let hi = chars.length
  while (lo < hi) { // largest prefix whose encoded form (plus the note) fits
    const mid = Math.ceil((lo + hi) / 2)
    if ((base + encodeURIComponent(chars.slice(0, mid).join('') + note)).length <= maxLength) lo = mid
    else hi = mid - 1
  }
  return { url: base + encodeURIComponent(chars.slice(0, lo).join('') + note), truncated: true }
}

async function confirm(question, input, output) {
  const rl = createInterface({ input, output })
  try {
    const answer = await new Promise(resolve => rl.question(question, resolve))
    return /^y(es)?$/i.test(String(answer).trim())
  } finally {
    rl.close()
  }
}

async function openBrowser(url) {
  const { execa } = await import('execa')
  await execa(process.platform === 'darwin' ? 'open' : 'xdg-open', [url])
}

/**
 * @param {string[]} argv
 * @param {object} [io]
 * @returns {Promise<number>} exit code
 */
export async function runFeedback(argv = [], io = {}) {
  const { out = process.stdout, err = process.stderr, input = process.stdin, open = openBrowser, ask = confirm, hosts = [], buildOpts = {} } = io
  if (argv.includes('--help') || argv.includes('-h')) { out.write(FEEDBACK_USAGE); return 0 }
  const unknown = argv.find(a => !['--print', '--include-host'].includes(a))
  if (unknown) { err.write(`lazyhub feedback: unknown option: ${sanitize(unknown).slice(0, 40)}\n\n${FEEDBACK_USAGE}`); return 2 }

  const report = buildReport({ includeHost: argv.includes('--include-host'), hosts, ...buildOpts })
  const interactive = !argv.includes('--print') && Boolean(input.isTTY && out.isTTY)
  out.write(report)
  if (!interactive) return 0

  const { url, truncated } = buildIssueUrl(report)
  out.write(`\nThis exact text will be pre-filled in a new issue at github.com/${FEEDBACK_REPO}. lazyhub sends nothing itself.\n`)
  if (truncated) out.write('Note: the report is too long for a URL and will be truncated; use --print to copy the full text.\n')
  if (!await ask('Open your browser to review and submit it? [y/N] ', input, out)) { out.write('Nothing opened.\n'); return 0 }
  try {
    await open(url)
  } catch {
    err.write('lazyhub feedback: could not open a browser; use --print and paste the text into a new issue.\n')
    return 1
  }
  return 0
}
