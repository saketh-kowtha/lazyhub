/**
 * `lazyhub queue|evidence|why-red|claims|collisions|story ... --json` (#627): the review tools
 * for shell agents and scripts. A thin wrapper over the shared core in src/review-tools/
 * (the same code `lazyhub --mcp` serves), so both surfaces return the same JSON.
 *
 * Headless: never renders the TUI and never prompts. stdout carries exactly one JSON document
 * (the result envelope, or `{schema_version, tool, error}`), and stderr one plain line on
 * failure. Exit codes: 0 success, 1 a GitHub read failed, 2 invalid usage or arguments,
 * 3 setup (gh missing or not signed in).
 */

import { headlessPreflight } from '../bootstrap.js'
import { parseItemReference } from '../input-validation.js'
import { ERROR_CODES, ReviewToolError, errorEnvelope, reviewToolByCommand, runReviewTool, validateInputs } from '../review-tools/index.js'
import { sanitizeRaw } from '../utils-core.js'

export const EXIT = Object.freeze({ OK: 0, GITHUB: 1, USAGE: 2, SETUP: 3 })

/** CLI commands, in help order, and whether the PR reference is required. */
export const REVIEW_COMMANDS = Object.freeze([
  ['queue', null],
  ['evidence', 'required'],
  ['why-red', 'required'],
  ['claims', 'required'],
  ['collisions', 'optional'],
  ['story', 'required'],
])
const PR_ARG = Object.fromEntries(REVIEW_COMMANDS)

/** Flags with a value: CLI spelling -> core input name and type. */
const VALUE_FLAGS = /** @type {Record<string, {input: string, int?: boolean, only?: string[]}>} */ ({
  '--repo': { input: 'repo' },
  '--org': { input: 'org', only: ['queue'] },
  '--limit': { input: 'limit', int: true, only: ['queue'] },
  '--after-review-requested': { input: 'after_review_requested', only: ['queue'] },
  '--after-authored': { input: 'after_authored', only: ['queue'] },
  '--base-runs': { input: 'base_runs', int: true, only: ['why-red'] },
})

export const REVIEW_USAGE = `Usage: lazyhub <command> [<pr>] [--repo owner/name] --json

Read-only review commands for agents and scripts. Output is one JSON document
(schema_version 1, see docs/CONTRACT.md); nothing is ever written to GitHub.

  queue [--repo owner/name | --org login] [--limit 1-50]
        [--after-review-requested C] [--after-authored C]
                          PRs needing your attention, grouped, with reasons
  evidence <pr>           review evidence: reasons, checks, files, head
  why-red <pr> [--base-runs 1-10]
                          why CI is red: step, log excerpt, changed lines
  claims <pr>             description claims checked against the diff
  collisions [<pr>]       open PRs touching the same files, merge order
  story <pr>              the diff as an ordered walkthrough

<pr> is 123, '#123', owner/name#123 or a pull request URL. Without --repo the
repository of the current directory (or the saved default) is used.

Exit codes: 0 ok, 1 GitHub read failed, 2 invalid usage, 3 gh missing or not signed in.
`

/**
 * @param {string} command
 * @param {string[]} argv arguments after the command
 * @param {{hosts?: string[]}} [opts]
 * @returns {{help?: boolean, json: boolean, args?: Record<string, any>, error?: string}}
 */
export function parseReviewArgs(command, argv, { hosts = [] } = {}) {
  /** @type {Record<string, any>} */
  const args = {}
  // Known up front, so an error found before the flag is reached is still reported as JSON.
  const json = argv.includes('--json')
  let ref = null
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    if (a === '--help' || a === '-h') return { help: true, json }
    if (a === '--json') continue
    const eq = a.indexOf('=')
    const name = a.startsWith('--') && eq > 0 ? a.slice(0, eq) : a
    const spec = VALUE_FLAGS[name]
    if (spec) {
      if (spec.only && !spec.only.includes(command)) return { json, error: `${name} does not apply to ${command}` }
      if (args[spec.input] !== undefined) return { json, error: `${name} may be given only once` }
      const value = eq > 0 && name !== a ? a.slice(eq + 1) : argv[++i]
      if (value === undefined || value === '' || (name === a && value.startsWith('-'))) return { json, error: `${name} needs a value` }
      args[spec.input] = spec.int ? (/^\d{1,6}$/.test(value) ? Number(value) : value) : value
      continue
    }
    if (a.startsWith('-')) return { json, error: `unknown option: ${a.slice(0, 60)}` }
    if (ref !== null) return { json, error: 'expected at most one PR reference' }
    ref = a
  }
  const need = PR_ARG[command]
  if (ref !== null) {
    if (!need) return { json, error: `${command} takes no PR reference` }
    const parsed = parseItemReference(ref, { hosts })
    if (!parsed.ok || !parsed.ref) return { json, error: `${parsed.error}: ${JSON.stringify(ref.slice(0, 80))}` }
    if (parsed.ref.kind === 'issue') return { json, error: `${command} needs a pull request, not an issue URL` }
    if (parsed.ref.repo) {
      if (args.repo && args.repo.toLowerCase() !== parsed.ref.repo.toLowerCase()) return { json, error: `--repo ${args.repo} conflicts with the reference's repository ${parsed.ref.repo}` }
      args.repo = args.repo || parsed.ref.repo
    }
    args.number = parsed.ref.number
  } else if (need === 'required') {
    return { json, error: `${command} needs a PR number, e.g. lazyhub ${command} 123 --json` }
  }
  return { json, args }
}

/** @typedef {{write: (s: string, cb?: () => void) => any}} Out */

/**
 * Write and wait until it is flushed: stdout to a pipe is asynchronous on macOS, and the
 * caller exits right after, which would cut a large document short.
 * @param {Out} stream
 * @param {string} text
 * @returns {Promise<void>}
 */
const emit = (stream, text) => new Promise(resolve => { stream.write(text, () => resolve()) })

/**
 * @param {{stdout: Out, stderr: Out}} io
 * @param {string|null} tool
 * @param {ReviewToolError} err
 * @param {boolean} json
 */
async function report(io, tool, err, json) {
  if (json) await emit(io.stdout, `${JSON.stringify(errorEnvelope(tool, err))}\n`)
  await emit(io.stderr, `lazyhub: ${sanitizeRaw(err.message)}${err.extra?.fix ? ` (try: ${sanitizeRaw(err.extra.fix)})` : ''}\n`)
}

/**
 * Run one review command.
 *
 * @param {string} command e.g. 'evidence'
 * @param {string[]} argv arguments after the command
 * @param {object} [opts]
 * @param {string[]} [opts.hosts] configured GitHub Enterprise hosts accepted in PR URLs
 * @param {() => Promise<{ok: boolean, message?: string}>} [opts.preflight]
 * @param {(name: string, args: any, o: any) => Promise<any>} [opts.run]
 * @param {{stdout: Out, stderr: Out}} [opts.io]
 * @returns {Promise<number>} exit code
 */
export async function runReviewCli(command, argv, { hosts = [], preflight = headlessPreflight, run = runReviewTool, io = process } = {}) {
  const tool = reviewToolByCommand(command)
  if (!tool) {
    await emit(io.stderr, `lazyhub: unknown review command ${JSON.stringify(String(command).slice(0, 40))}\n\n${REVIEW_USAGE}`)
    return EXIT.USAGE
  }
  const parsed = parseReviewArgs(command, argv, { hosts: [...hosts, process.env.GH_HOST].filter(Boolean) })
  if (parsed.help) { await emit(io.stdout, REVIEW_USAGE); return EXIT.OK }
  if (parsed.error) {
    await report(io, tool.name, new ReviewToolError(ERROR_CODES.INVALID_ARGUMENTS, parsed.error), parsed.json)
    return EXIT.USAGE
  }
  if (!parsed.json) {
    await emit(io.stderr, `lazyhub ${command}: only JSON output is available; add --json (see lazyhub ${command} --help)\n`)
    return EXIT.USAGE
  }
  try {
    validateInputs(tool, parsed.args)
  } catch (err) {
    await report(io, tool.name, /** @type {ReviewToolError} */ (err), true)
    return EXIT.USAGE
  }
  const pre = await preflight()
  if (!pre.ok) {
    const message = String(pre.message || 'gh is not ready').replace(/^lazyhub --mcp: /, '')
    await report(io, tool.name, new ReviewToolError(ERROR_CODES.SETUP, message), true)
    return EXIT.SETUP
  }
  try {
    const out = await run(tool.name, parsed.args, { defaultRepo: process.env.GHUI_REPO || null })
    await emit(io.stdout, `${JSON.stringify(out)}\n`)
    return EXIT.OK
  } catch (err) {
    const e = err instanceof ReviewToolError ? err : new ReviewToolError(ERROR_CODES.GITHUB_ERROR, sanitizeRaw(/** @type {any} */ (err)?.message || 'failed'))
    await report(io, tool.name, e, true)
    return e.code === ERROR_CODES.GITHUB_ERROR ? EXIT.GITHUB : EXIT.USAGE
  }
}
