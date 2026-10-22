/**
 * classify.js — turn a failed `gh` call into a plain-language failure (#313).
 *
 * One classifier, next to runGh(): it reads the GhError that runGh() throws
 * (message, redacted stderr, exit code, args) and returns what happened, what
 * it affects and the exact next step. Pure and offline: it never calls gh, so
 * a rate-limit reset time is only shown when the caller already holds a
 * `gh api rate_limit` result (ctx.rateLimit); otherwise it says it is unknown.
 *
 * Every string returned is passed through sanitize() and scrubbed of tokens and
 * credentialed or one-time URLs, so callers can render it as is.
 */

import { sanitize } from '../utils-core.js'

/**
 * @typedef {'gh_missing'|'gh_too_old'|'not_signed_in'|'wrong_host'|'sso'|'scope'|'rate_limit'|'secondary_limit'|'repo_not_found'|'not_found'|'offline'|'forbidden'|'unknown'} FailureKind
 * @typedef {'blocked'|'degraded'|'waiting'|'offline'} FailureTone
 * @typedef {object} Failure
 * @property {FailureKind} kind
 * @property {FailureTone} tone   - blocked (✗), degraded (⚠), waiting (◷), offline (⊘)
 * @property {string} cause       - one-line plain-language cause
 * @property {string[]} notes     - what is and is not affected
 * @property {string|null} fix    - literal command (copyable), never a URL with a credential
 * @property {string|null} fixHint - plain-language instruction around the command
 * @property {{org?: string, repo?: string, scope?: string, host?: string, limit?: string, resetAt?: number|null}} subject
 */

const GLYPH = { blocked: '✗', degraded: '⚠', waiting: '◷', offline: '⊘' }

/**
 * @param {FailureTone} tone
 * @returns {string}
 */
export const failureGlyph = tone => GLYPH[tone] || GLYPH.blocked

/** Documented per-family limits for an authenticated user (docs.github.com, REST rate limits). */
const FAMILY_LIMIT = { core: '5,000 requests per hour', graphql: '5,000 points per hour', search: '30 requests per minute' }
const FAMILY_LABEL = { core: 'REST API', graphql: 'GraphQL', search: 'search' }

/**
 * Strip anything that must never reach a screen or a log: ANSI and control
 * characters (sanitize), token-shaped runs, bearer/authorization values and
 * URLs that carry credentials or one-time authorization query strings.
 *
 * @param {any} value
 * @returns {string}
 */
export function scrub(value) {
  return sanitize(value)
    .replace(/\b(https?:\/\/)[^\s/@]+@/gi, '$1')
    .replace(/(https?:\/\/[^\s)?]+)\?[^\s)]*/gi, '$1')
    .replace(/\b(authorization|token)\s*[:=]\s*(bearer\s+)?\S+/gi, '$1: [REDACTED]')
    .replace(/\bbearer\s+\S+/gi, 'bearer [REDACTED]')
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{10,}/g, '[REDACTED]')
    .replace(/\bgithub_pat_[A-Za-z0-9_]{10,}/g, '[REDACTED]')
    .replace(/[A-Za-z0-9_-]{40,}/g, '[REDACTED]')
}

const HOST_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/i
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** @param {string|undefined} s */
const safeHost = s => (s && HOST_RE.test(s) ? s : null)
/** @param {string|undefined} s */
const safeName = s => (s && NAME_RE.test(s) ? s : null)

/**
 * The effective host: an explicit context host, then GH_HOST, then github.com.
 *
 * @param {{host?: string}} ctx
 * @returns {string}
 */
function hostOf(ctx) {
  return safeHost(ctx.host) || safeHost(process.env.GH_HOST) || 'github.com'
}

/**
 * Find the owner (and repository when present) a call was about, from the
 * sanitized argv runGh() recorded: `repos/o/r`, `orgs/o`, `-R o/r`,
 * `-f owner=o -f name=r`. GraphQL query bodies are skipped.
 *
 * @param {unknown[]} args
 * @returns {{owner: string|null, repo: string|null}}
 */
function targetOf(args) {
  const list = Array.isArray(args) ? args.filter(a => typeof a === 'string') : []
  let owner = null
  let repo = null
  const kv = {}
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i]
    if (/^query=/.test(a)) continue
    if ((a === '-R' || a === '--repo') && list[i + 1]) {
      const [o, r] = list[i + 1].split('/')
      owner = safeName(o); repo = safeName(r) ? `${o}/${r}` : null
    }
    const path = a.match(/(?:^|\/)repos\/([^/\s]+)\/([^/\s?]+)/)
    if (path && safeName(path[1]) && safeName(path[2])) { owner = path[1]; repo = `${path[1]}/${path[2]}` }
    const org = a.match(/(?:^|\/)orgs\/([^/\s?]+)/)
    if (org && safeName(org[1])) owner = org[1]
    const pair = a.match(/^(owner|org|repo|name)=(.+)$/)
    if (pair) kv[pair[1]] = pair[2]
  }
  if (!owner && safeName(kv.owner || kv.org)) owner = kv.owner || kv.org
  if (owner && !repo && safeName(kv.repo || kv.name)) repo = `${owner}/${kv.repo || kv.name}`
  return { owner, repo }
}

/**
 * Which rate-limit family a call counts against.
 *
 * @param {unknown[]} args
 * @returns {'core'|'graphql'|'search'}
 */
function familyOf(args) {
  const list = Array.isArray(args) ? args.filter(a => typeof a === 'string') : []
  if (list[0] === 'search') return 'search'
  if (list[0] === 'api') {
    const path = list.find((a, i) => i > 0 && !a.startsWith('-')) || ''
    if (path === 'graphql') return 'graphql'
    if (/^\/?search\//.test(path)) return 'search'
    return 'core'
  }
  // pr, issue, repo, project, run … read through GraphQL except run/workflow/release.
  return ['run', 'workflow', 'release', 'gist', 'cache'].includes(list[0]) ? 'core' : 'graphql'
}

/**
 * Local clock time, "14:32".
 *
 * @param {number} epochSeconds
 * @returns {string}
 */
export function localTime(epochSeconds) {
  const d = new Date(epochSeconds * 1000)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * @param {FailureKind} kind
 * @param {FailureTone} tone
 * @param {string} cause
 * @param {Partial<Failure>} [rest]
 * @returns {Failure}
 */
function failure(kind, tone, cause, rest = {}) {
  const out = { kind, tone, cause: scrub(cause), notes: [], fix: null, fixHint: null, subject: {}, ...rest }
  out.notes = out.notes.map(scrub)
  if (out.fixHint) out.fixHint = scrub(out.fixHint)
  return out
}

/**
 * Classify a failed gh call.
 *
 * @param {any} err   - GhError (or any Error)
 * @param {{host?: string, now?: number, rateLimit?: Record<string, {limit?: number, remaining?: number, reset?: number}>}} [ctx]
 *   rateLimit is the `resources` object of a `gh api rate_limit` result the
 *   caller already has; it is never fetched here.
 * @returns {Failure}
 */
export function classifyGhFailure(err, ctx = {}) {
  const text = `${err?.message || ''}\n${err?.stderr || ''}`
  const host = hostOf(ctx)
  const { owner, repo } = targetOf(err?.args)

  if (err?.code === 'ENOENT' || /\bENOENT\b/.test(text)) {
    return failure('gh_missing', 'blocked', 'The GitHub CLI (gh) is not installed, so lazyhub cannot read GitHub.', {
      fixHint: 'Install gh from https://cli.github.com (macOS: brew install gh), then run gh auth login and restart lazyhub.',
      notes: ['lazyhub only reads through your own gh login. Nothing was changed.'],
    })
  }

  if (/unknown (flag|command|shorthand flag)\b|Unknown JSON field/i.test(text)) {
    return failure('gh_too_old', 'blocked', 'Your GitHub CLI is too old for this lazyhub feature.', {
      fixHint: 'Update gh from https://cli.github.com (macOS: brew upgrade gh), then restart lazyhub.',
    })
  }

  if (/SAML (enforcement|SSO)|Authorize in your web browser|sso.{0,40}authoriz/i.test(text)) {
    const fromUrl = text.match(/\/orgs\/([A-Za-z0-9][A-Za-z0-9._-]*)\/sso/)?.[1]
    const org = safeName(fromUrl) || owner
    return failure('sso', 'degraded',
      org ? `The organization ${org} has not authorized your gh token (SAML SSO).` : 'An organization has not authorized your gh token (SAML SSO).', {
        fix: `gh auth refresh -h ${host}`,
        fixHint: org ? `then choose "Authorize" for ${org} in the browser page that opens.` : 'then choose "Authorize" for the organization in the browser page that opens.',
        notes: [repo ? `${repo} is hidden until then.` : 'Its repositories are hidden until then.', 'Other organizations are unaffected.'],
        subject: { org: org || undefined, repo: repo || undefined, host },
      })
  }

  if (/secondary rate limit|abuse detection/i.test(text)) {
    const wait = Number(text.match(/retry[- ]after:?\s*(\d+)/i)?.[1])
    const resetAt = Number.isFinite(wait) && wait > 0 ? Math.floor((ctx.now ?? Date.now()) / 1000) + wait : null
    return failure('secondary_limit', 'waiting', 'GitHub asked lazyhub to slow down (secondary rate limit).', {
      notes: [resetAt ? `Retry in ${wait}s, at ${localTime(resetAt)}.` : 'GitHub did not say how long; wait a minute, then retry.', 'Cause is usually many requests in a short burst; no other action needed.'],
      subject: { limit: 'secondary', resetAt },
    })
  }

  if (/rate limit/i.test(text)) {
    const family = familyOf(err?.args)
    const known = ctx.rateLimit?.[family]
    const resetAt = Number.isFinite(known?.reset) ? known.reset : null
    const nowSec = Math.floor((ctx.now ?? Date.now()) / 1000)
    const mins = resetAt ? Math.max(1, Math.ceil((resetAt - nowSec) / 60)) : null
    const per = known?.limit ? `${known.limit.toLocaleString('en-US')} requests` : FAMILY_LIMIT[family]
    return failure('rate_limit', 'waiting', `GitHub API rate limit reached: ${FAMILY_LABEL[family]}, ${per}.`, {
      notes: [
        resetAt ? `Resets at ${localTime(resetAt)} your time (in ${mins}m).` : 'GitHub did not report a reset time; try again in a few minutes.',
        'Nothing is lost: anything shown is the last good result.',
      ],
      subject: { limit: family, resetAt },
    })
  }

  const scope = missingScope(text)
  if (scope.missing) {
    const named = scope.name
    return failure('scope', 'degraded',
      named ? `Your gh token lacks the ${named} scope.` : 'Your gh token lacks a scope this needs.', {
        fix: named ? `gh auth refresh -h ${host} -s ${named}` : `gh auth status`,
        fixHint: named ? null : 'to see the scopes your token has, then add the missing one with gh auth refresh -s <scope>.',
        notes: ['Everything your token can already read is still listed.'],
        subject: { scope: named || undefined, host },
      })
  }

  if (/gh auth login|authentication required|not logged in|not logged into|no oauth token|HTTP 401|bad credentials|requires authentication/i.test(text)) {
    const named = safeHost(text.match(/(?:no oauth token found for|not logged in to)\s+(\S+?)[.,\s]*$/im)?.[1])
    const h = named || host
    return failure('not_signed_in', 'blocked', 'You are not signed in to GitHub.', {
      fix: h === 'github.com' ? 'gh auth login' : `gh auth login --hostname ${h}`,
      fixHint: 'In another terminal run the command, then come back and press {refresh-key}; no restart needed.',
      notes: ['lazyhub uses your existing gh login and never asks for a token itself.'],
      subject: { host: h },
    })
  }

  if (/none of the git remotes .* known GitHub host/i.test(text)) {
    return failure('wrong_host', 'blocked', `This repository's remote is not on ${host}.`, {
      fix: `gh auth login --hostname ${host}`,
      fixHint: 'If your remote is on another GitHub host, sign in to that host:',
      subject: { host },
    })
  }

  if (/error connecting to|dial tcp|no such host|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|i\/o timeout|network is unreachable|TLS handshake timeout|Client\.Timeout|timed out after/i.test(text)) {
    return failure('offline', 'offline', `Cannot reach ${host === 'github.com' ? 'api.github.com' : host}. Check your network or githubstatus.com.`, {
      notes: ['Reading works from the cache. Anything that needs GitHub waits until you are back online.'],
      subject: { host },
    })
  }

  const notFoundRepo = text.match(/Could not resolve to a Repository with the name '([^']+)'/)?.[1]
  if (notFoundRepo || /HTTP\s*404|\bnot found\b/i.test(text)) {
    const name = safeRepo(notFoundRepo) || repo
    if (name || /Could not resolve to a Repository/.test(text)) {
      const label = name || 'The repository'
      return failure('repo_not_found', 'blocked', name ? `${label} was not found, or your account cannot see it.` : 'The repository was not found, or your account cannot see it.', {
        notes: ['GitHub returns the same answer for both on purpose. Check the spelling, then ask an owner for access.'],
        fix: `gh auth refresh -h ${host}`,
        fixHint: 'If the organization enforces SAML SSO, run:',
        subject: { repo: name || undefined, org: owner || undefined, host },
      })
    }
    return failure('not_found', 'blocked', 'GitHub could not find what was asked for (404).', {
      notes: ['It may have been deleted, renamed, or be private to an account you are not signed in as.'],
    })
  }

  if (/HTTP 403|forbidden/i.test(text)) {
    return failure('forbidden', 'blocked', 'Your gh login cannot read this.', {
      fix: 'gh auth status',
      fixHint: 'to check the account and token scopes, then retry:',
    })
  }

  const line = scrub(String(err?.message || 'unknown error').split('\n')[0]).slice(0, 160)
  return failure('unknown', 'blocked', `GitHub returned an error: ${line}`, { fix: 'gh auth status', fixHint: 'If it persists, check your login with:' })
}

/** @param {string|undefined} s */
function safeRepo(s) {
  const [o, r, extra] = String(s || '').split('/')
  return !extra && safeName(o) && safeName(r) ? `${o}/${r}` : null
}

/**
 * Detect a missing-scope failure and name the scope when gh or GitHub does.
 *
 * @param {string} text
 * @returns {{missing: boolean, name: string|null}}
 */
function missingScope(text) {
  const patterns = [
    /requires one of the following scopes:\s*\[([^\]]*)\]/i,
    /missing required scopes?\s*\[([^\]]*)\]/i,
    /needs the "([^"]+)" scope/i,
  ]
  for (const re of patterns) {
    const m = text.match(re)
    if (m) {
      const name = m[1].split(/[,\s]+/).map(s => s.replace(/['"]/g, '')).find(s => /^[a-z]+(:[a-z_]+)?$/i.test(s))
      return { missing: true, name: name || null }
    }
  }
  if (/not been granted the required scopes|insufficient_scopes|Resource not accessible by (personal access token|integration)/i.test(text)) {
    return { missing: true, name: null }
  }
  return { missing: false, name: null }
}

/**
 * Classify the "signed in to a different host" mismatch that bootstrap's
 * selectGhHost() detects before any gh call fails: the remote names a host
 * that gh has no login for. selectGhHost() prints this same wording.
 *
 * @param {{needed: string, signedIn: string[]}} mismatch
 * @returns {Failure}
 */
export function classifyHostMismatch({ needed, signedIn }) {
  return failure('wrong_host', 'blocked', `The git remote points at ${needed}, but gh is not logged in to it.`, {
    notes: [
      `gh is logged in to: ${signedIn.length ? signedIn.join(', ') : '(nothing)'}`,
      `If ${needed} is your GitHub Enterprise host, run: gh auth login --hostname ${needed}`,
      'If it is an SSH alias or a different SSH hostname, set the API host: export GH_HOST=<host>',
    ],
    fix: `gh auth login --hostname ${needed}`,
    subject: { host: needed },
  })
}

/**
 * Partial data: some repositories loaded and others failed.
 *
 * @param {{repo: string, error: any}[]} failures
 * @param {number} total   - repositories attempted
 * @param {{host?: string}} [ctx]
 * @returns {{loaded: number, total: number, failed: {repo: string, kind: FailureKind, reason: string, fix: string|null}[], cause: string}}
 */
export function classifyPartial(failures, total, ctx = {}) {
  const failed = failures.map(({ repo, error }) => {
    const f = classifyGhFailure(error, { ...ctx })
    const reason = { sso: `SAML SSO not authorized${f.subject.org ? ` for ${f.subject.org}` : ''}`, repo_not_found: 'not found, or you have no access', scope: `missing ${f.subject.scope || 'a token scope'}`, rate_limit: 'rate limited', secondary_limit: 'rate limited', offline: 'network unreachable' }[f.kind] || f.cause
    return { repo: scrub(repo), kind: f.kind, reason: scrub(reason), fix: f.fix }
  })
  const loaded = Math.max(0, total - failed.length)
  return {
    loaded,
    total,
    failed,
    cause: `${failed.length} ${failed.length === 1 ? 'repository' : 'repositories'} did not load; the rest are complete and usable.`,
  }
}
