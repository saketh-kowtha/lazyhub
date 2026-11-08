/**
 * cli/doctor/ai.js — AI provider/auth report (lazyhub doctor --ai, lazyhub ai status).
 *
 * Reports modes and reasons only. Never prints a token, a credential path's contents,
 * an account e-mail or the output of a CLI status command.
 */

import { listProviderStatus } from '../../ai/detect.js'
import { hasLoginConsent } from '../../ai/login.js'
import { sanitize } from '../../utils-core.js'

/** @returns {Promise<string>} */
export async function formatAiReport() {
  const rows = await listProviderStatus()
  const lines = ['AI providers']
  for (const r of rows) {
    let detail
    if (r.available) {
      detail = r.authMode === 'login' ? 'login mode (consented)' : r.id === 'claude-code' && process.env.CLAUDE_CODE_OAUTH_TOKEN ? 'CLAUDE_CODE_OAUTH_TOKEN set' : 'ready'
    } else {
      detail = sanitize(r.reason || 'unavailable')
    }
    const consent = hasLoginConsent(r.id) && !(r.available && r.authMode === 'login') ? ' [login consented]' : ''
    lines.push(`  ${r.id}: ${detail}${consent}`)
  }
  lines.push('', 'Claude subscription: run `claude setup-token`, then export CLAUDE_CODE_OAUTH_TOKEN (revoke it on claude.ai).')
  lines.push('Other CLIs: `lazyhub ai login enable codex` uses its own login in place with tools off.')
  return lines.join('\n') + '\n'
}
