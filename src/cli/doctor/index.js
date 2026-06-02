/**
 * cli/doctor/index.js — lazyhub doctor command.
 */

import { checkConfig, formatConfigReport } from './config.js'

/**
 *
 * @param argv
 * @param out
 */
export async function runDoctor(argv = process.argv.slice(2), out = process.stdout) {
  const json = argv.includes('--json')
  const configOnly = argv.includes('--config') || !argv.includes('--ai')
  let ok = true
  if (configOnly) {
    const report = checkConfig()
    ok = ok && report.ok
    out.write(formatConfigReport(report, { json }))
  }
  return ok ? 0 : 1
}
