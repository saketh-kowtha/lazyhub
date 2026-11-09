/**
 * src/ai/login.js — opt-in "login mode" for CLI providers (#364).
 *
 * Login mode lets a CLI use the user's own subscription login in place (real HOME)
 * instead of the throwaway-HOME sandbox of #252. It is available only when:
 *   1. the user consented ([ai.login].<key> = true) — never implied by auto-detect or
 *      LAZYHUB_AI_PROVIDER;
 *   2. the installed CLI's `--help` proves every hardening flag in the provider's
 *      capability manifest exists (fail closed: a missing flag means unavailable);
 *   3. the CLI reports being logged in (exit code only).
 *
 * Lazyhub never reads, copies or writes a credential file. Detection output
 * (stdout/stderr of status commands) is discarded; only exit codes are used.
 */

import { accessSync, constants, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import { runAiCli } from '../services/ai-cli.js'
import { loadConfig } from '../config/loader.js'

/** Consent keys under [ai.login], by provider id. */
export const LOGIN_CONSENT_KEY = { codex: 'codex', 'gemini-cli': 'gemini_cli', agy: 'agy' }

/** @param {string} providerId */
export function hasLoginConsent(providerId) {
  const key = LOGIN_CONSENT_KEY[providerId]
  if (!key) return false
  try {
    return loadConfig().ai?.login?.[key] === true
  } catch {
    return false
  }
}

const _cache = new Map()

/** Reset probe caches (consent revoke, tests). */
export function clearLoginCache() {
  _cache.clear()
}

/**
 * Find an executable on PATH once and pin its absolute path for the session.
 * @param {string} name
 * @returns {string|null}
 */
export function resolveBin(name) {
  const key = `bin:${name}:${process.env.PATH}`
  if (_cache.has(key)) return _cache.get(key)
  let found = null
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, name)
    try {
      if (statSync(p).isFile()) { accessSync(p, constants.X_OK); found = p; break }
    } catch { /* not here */ }
  }
  _cache.set(key, found)
  return found
}

/**
 * Manifest check: every required flag must appear in the matching `--help` output.
 *
 * @param {string} cmd absolute path to the CLI
 * @param {{ helpChecks: Array<{args: string[], flags: string[]}>, textChecks?: Array<{args: string[], includes: string[]}> }} manifest
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function checkManifest(cmd, manifest) {
  const key = `manifest:${cmd}:${JSON.stringify(manifest)}`
  if (_cache.has(key)) return _cache.get(key)
  const run = (args) => runAiCli({ cmd, args, stdin: '', timeoutMs: 5_000 })
  let result = { ok: true }
  try {
    for (const { args, flags } of manifest.helpChecks) {
      const help = await run(args)
      const missing = flags.find(f => !new RegExp(`(^|[\\s,\\[<|])${f.replace(/[\\^$.*+?()[\]{}|-]/g, '\\$&')}($|[\\s,=\\]>|])`, 'm').test(help))
      if (missing) { result = { ok: false, reason: `lacks ${missing}` }; break }
    }
    if (result.ok) {
      for (const { args, includes } of manifest.textChecks || []) {
        const out = await run(args)
        const missing = includes.find(s => !out.includes(s))
        if (missing) { result = { ok: false, reason: `lacks ${missing}` }; break }
      }
    }
  } catch {
    result = { ok: false, reason: 'capability check failed (--help did not run)' }
  }
  _cache.set(key, result)
  return result
}

/**
 * Ask the CLI itself whether it is logged in. Output is discarded; only the exit
 * code counts. Uses the login profile so the CLI sees its real credential store.
 *
 * @param {string} cmd
 * @param {string[]} args e.g. ['login', 'status']
 * @param {Record<string,string>} [env]
 * @returns {Promise<boolean>}
 */
export async function isLoggedIn(cmd, args, env = {}) {
  try {
    await runAiCli({ cmd, args, stdin: '', timeoutMs: 5_000, profile: 'login', auth: { env } })
    return true
  } catch {
    return false
  }
}
