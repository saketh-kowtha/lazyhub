/**
 * Top-level argument handling for the TUI entry (#315): `--help`, unknown flags
 * and a PR/issue reference. Pure and dependency-light so `lazyhub --help` never
 * loads the TUI stack.
 */
import { parseItemReference } from '../input-validation.js'

export const USAGE = `lazyhub - keyboard-driven GitHub TUI

Usage:
  lazyhub                         open the TUI for the current repository
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
  status                          print ambient review/CI/notification counts
  watch-only [--repo owner/name]  read-only coverage report
  serve [--status|--stop]         manage the background daemon

Options:
  --mouse                         enable mouse scrolling
  -v, --version                   print the version
  -h, --help                      print this help
`

/**
 * Classify the TUI-mode arguments (everything after the node + script paths).
 *
 * @param {string[]} args
 * @param {{hosts?: string[]}} [opts]
 * @returns {{help?: boolean, error?: string, ref?: any}}
 */
export function parseCliArgs(args, opts = {}) {
  if (args.includes('--help') || args.includes('-h')) return { help: true }
  const positional = []
  for (const arg of args) {
    if (arg === '--mouse') continue
    if (arg.startsWith('-')) return { error: `unknown option: ${arg}` }
    positional.push(arg)
  }
  if (positional.length === 0) return { ref: null }
  if (positional.length > 1) return { error: 'expected at most one PR or issue reference' }
  const parsed = parseItemReference(positional[0], opts)
  return parsed.ok ? { ref: parsed.ref } : { error: `${parsed.error}: ${JSON.stringify(positional[0]).slice(0, 80)}` }
}
