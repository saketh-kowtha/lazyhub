/**
 * Top-level argument handling for the TUI entry (#315): `--help`, unknown flags
 * and a PR/issue reference. Pure and dependency-light so `lazyhub --help` never
 * loads the TUI stack.
 */
import { parseItemReference } from '../input-validation.js'
import { isOwnerName } from '../config/schema.js'

export const USAGE = `lazyhub - keyboard-driven GitHub TUI

Usage:
  lazyhub                         open the TUI for the current repository
  lazyhub --repo owner/name       open that repository instead of the detected one
  lazyhub <reference>             open a PR or issue directly (read-only)
  lazyhub <command> [options]

Reference forms:
  owner/repo#123                  a PR or issue in that repository
  '#123' or 123                   a PR or issue in the repository of the current directory
  https://github.com/owner/repo/pull/123
  https://github.com/owner/repo/issues/123
                                  (also your configured GitHub Enterprise host)

Commands:
  doctor [--json]                 check setup, auth and review-coverage evidence
  ai status | login enable|disable <cli>
                                  AI providers; opt in to a CLI's own subscription login
  feedback [--print]              open a pre-filled issue with redacted diagnostics
  status                          print ambient review/CI/notification counts
  watch-only [--repo owner/name]  read-only coverage report
  serve [--status|--stop]         manage the background daemon

For agents and scripts (non-interactive, read-only, never prompts):
  --mcp                           MCP server on stdio (JSON-RPC); same as \`lazyhub mcp-server\`.
                                  Client config: {"command": "lazyhub", "args": ["--mcp"]}
  queue --json                    PRs needing your attention, grouped, with reasons
  evidence <pr> --json            review evidence: reasons, checks, files, head
  why-red <pr> --json             why CI is red: step, log excerpt, changed lines
  claims <pr> --json              description claims checked against the diff
  collisions [<pr>] --json        open PRs touching the same files, merge order
  story <pr> --json               the diff as an ordered walkthrough
                                  (all take --repo owner/name; details: lazyhub queue --help)
  doctor --json                   setup and coverage report as JSON
  status --format json            cached review/CI/notification counts as JSON

Options:
  --repo owner/name               open this repository for this launch (not saved);
                                  on GitHub Enterprise Server: GH_HOST=host lazyhub --repo owner/name
  --mouse                         enable mouse scrolling
  --onboarding                    rerun first-run setup
  -v, --version                   print the version
  -h, --help                      print this help
`

/**
 * Classify the TUI-mode arguments (everything after the node + script paths).
 *
 * @param {string[]} args
 * @param {{hosts?: string[]}} [opts]
 * @returns {{help?: boolean, error?: string, ref?: any, repo?: string}}
 */
export function parseCliArgs(args, opts = {}) {
  if (args.includes('--help') || args.includes('-h')) return { help: true }
  const positional = []
  let repo
  let onboarding = false
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    // Both are read later at startup: --mouse by the renderer, --onboarding by shouldOnboard().
    if (arg === '--mouse') continue
    if (arg === '--onboarding') { onboarding = true; continue }
    if (arg === '--repo' || arg.startsWith('--repo=')) {
      if (repo !== undefined) return { error: '--repo may be given only once' }
      const value = arg === '--repo' ? args[i + 1] : arg.slice('--repo='.length)
      if (arg === '--repo') i += 1
      if (!value || value.startsWith('-')) return { error: '--repo needs owner/name' }
      // Same check onboarding applies to a typed repository (isOwnerName).
      if (!isOwnerName(value)) return { error: `invalid repository ${JSON.stringify(value.slice(0, 80))}: expected owner/name` }
      repo = value
      continue
    }
    if (arg.startsWith('-')) return { error: `unknown option: ${arg}` }
    positional.push(arg)
  }
  if (onboarding && repo) return { error: '--onboarding and --repo cannot be combined: --repo already names the repository' }
  const withRepo = out => (repo ? { ...out, repo } : out)
  if (positional.length === 0) return withRepo({ ref: null })
  if (positional.length > 1) return { error: 'expected at most one PR or issue reference' }
  const parsed = parseItemReference(positional[0], opts)
  if (parsed.ok && repo && parsed.ref?.repo && parsed.ref.repo.toLowerCase() !== repo.toLowerCase()) {
    return { error: `--repo ${repo} conflicts with the reference's repository ${parsed.ref.repo}` }
  }
  return parsed.ok ? withRepo({ ref: parsed.ref }) : { error: `${parsed.error}: ${JSON.stringify(positional[0]).slice(0, 80)}` }
}

/**
 * Why the TUI cannot start here, or null when it can. The TUI needs a terminal on both
 * ends: raw-mode keys in, a screen out. Piped, redirected or CI runs get this message on
 * stderr and exit 1 instead of a screen of escape codes on stdout (E3).
 *
 * @param {{stdin?: {isTTY?: boolean}, stdout?: {isTTY?: boolean}}} [streams]
 * @returns {string|null}
 */
export function nonInteractiveMessage({ stdin = process.stdin, stdout = process.stdout } = {}) {
  const inOk = !!stdin?.isTTY
  const outOk = !!stdout?.isTTY
  if (inOk && outOk) return null
  const what = !inOk && !outOk ? 'standard input and standard output are not terminals'
    : !inOk ? 'standard input is not a terminal' : 'standard output is not a terminal'
  return `lazyhub: the interactive UI needs a terminal, but ${what}.\n`
    + 'Run lazyhub directly in a terminal. For scripts use `lazyhub status`, `lazyhub doctor --json` or `lazyhub --mcp`; see `lazyhub --help`.\n'
}
