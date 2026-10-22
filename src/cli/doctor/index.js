/**
 * cli/doctor/index.js — lazyhub doctor command.
 */

import { checkConfig, formatConfigReport } from './config.js'
import { checkCoverage, formatCoverageReport } from './coverage.js'
import { resolveCurrentRepo } from '../../executor/activity.js'
import { sanitize } from '../../utils-core.js'

export const DOCTOR_USAGE = `Usage: lazyhub doctor [options]

Check setup and review-coverage evidence. Read-only; nothing is changed.

Options:
  --config         check the config file (default when no report is chosen)
  --coverage       report enforcement coverage and alternate paths (queries GitHub via gh)
  --repo owner/name  repository for --coverage (default: current directory's)
  --json           machine-readable output; accepts exactly one report
                   (use --config or --coverage, not both)
  -h, --help       print this help

Exit codes:
  0  checks passed
  1  a check failed or the report could not be produced
  2  invalid arguments
`

/**
 * @param argv
 * @param out
 * @param err
 */
export async function runDoctor(argv = process.argv.slice(2), out = process.stdout, err = process.stderr) {
  if (argv.includes('--help') || argv.includes('-h')) { out.write(DOCTOR_USAGE); return 0 }
  const json = argv.includes('--json')
  const coverage = argv.includes('--coverage')
  const configOnly = argv.includes('--config') || (!argv.includes('--ai') && !coverage)
  if (json && configOnly && coverage) {
    err.write('lazyhub doctor: --json accepts one report; use --config or --coverage, not both\n')
    return 2
  }
  let ok = true
  if (configOnly) {
    const report = checkConfig()
    ok = ok && report.ok
    out.write(formatConfigReport(report, { json }))
    if (!json && !coverage) out.write('\nTip: run `lazyhub doctor --coverage` to check enforcement coverage and alternate paths.\n')
  }
  if (coverage) {
    const i = argv.indexOf('--repo')
    const repoArg = i >= 0 ? argv[i + 1] : argv.find(a => a.startsWith('--repo='))?.slice(7)
    if (repoArg !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(repoArg)) {
      err.write('lazyhub doctor: --repo must be owner/name\n')
      return 2
    }
    try {
      const repo = repoArg || await resolveCurrentRepo()
      out.write(formatCoverageReport(await checkCoverage({ repo }), { json }))
    } catch (e) {
      err.write(`lazyhub doctor: ${sanitize(e.message)}\n`)
      return 1
    }
  }
  return ok ? 0 : 1
}
