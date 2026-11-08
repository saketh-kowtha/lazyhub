/**
 * src/ai/providers/_errors.js — map a runAiCli() rejection to an AIError.
 *
 * Messages are fixed strings: CLI stderr is never copied into them (it can echo
 * auth URLs or tokens). Classification flags come from src/services/ai-cli.js.
 */
import { AIError } from '../error.js'

/**
 * @param {Error & {isIsolationFailure?:boolean,isTimeout?:boolean,isNotFound?:boolean,isOutputCap?:boolean,isAuth?:boolean}} err
 * @param {{id:string, name:string, bin:string, authHelp:string}} p
 * @returns {AIError}
 */
export function mapCliError(err, { id, name, bin, authHelp }) {
  if (err.isIsolationFailure) return new AIError(`${name} unavailable: ${err.message}`, { code: 'provider-unavailable', provider: id })
  if (err.isTimeout) return new AIError(`${name} timed out`, { code: 'timeout', provider: id })
  if (err.isNotFound) return new AIError(`${bin} CLI not found on PATH`, { code: 'spawn-failed', provider: id })
  if (err.isOutputCap) return new AIError(`${name} output exceeded size cap`, { code: 'malformed-response', provider: id })
  if (err.isAuth) return new AIError(authHelp, { code: 'auth-required', provider: id })
  return new AIError(`${name} error: ${err.message || 'failed'}`, { code: 'provider-unavailable', provider: id })
}
