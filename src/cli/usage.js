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
  feedback [--print]              open a pre-filled issue with redacted diagnostics
  status                          print ambient review/CI/notification counts
  watch-only [--repo owner/name]  read-only coverage report
  serve [--status|--stop]         manage the background daemon

Options:
  --repo owner/name               open this repository for this launch (not saved)
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
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    // Both are read later at startup: --mouse by the renderer, --onboarding by shouldOnboard().
    if (arg === '--mouse' || arg === '--onboarding') continue
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
  const withRepo = out => (repo ? { ...out, repo } : out)
  if (positional.length === 0) return withRepo({ ref: null })
  if (positional.length > 1) return { error: 'expected at most one PR or issue reference' }
  const parsed = parseItemReference(positional[0], opts)
  return parsed.ok ? withRepo({ ref: parsed.ref }) : { error: `${parsed.error}: ${JSON.stringify(positional[0]).slice(0, 80)}` }
}
