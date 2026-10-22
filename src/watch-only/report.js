/**
 * watch-only/report.js — per-operation coverage report (JSON schema v1).
 *
 * COVERAGE HONESTY (ARCHITECT_DECISIONS D1/D5/D7, THREAT_MODEL T1/T7):
 * In watch-only Alpha lazyhub installs nothing and blocks nothing, so:
 *   - `github_enforced` is NEVER assigned. It requires the pinned-source
 *     `lazyhub/approval` required check plus ruleset verification (D1); watch-only
 *     neither installs nor verifies either ("no required check is installed or
 *     auto-passed").
 *   - `managed_gateway` is NEVER assigned. It requires the local gateway/helper
 *     (Slice 2); none exists or is consulted here.
 *   - `advisory` is assigned to an operation lazyhub completely observed on
 *     GitHub: it can be reported after the fact, not prevented.
 *   - `ungoverned` is assigned when lazyhub has no reliable observation
 *     (THREAT_MODEL "Coverage vocabulary": stale observation and partial API
 *     results downgrade the state): observation was truncated / rate limited /
 *     failed for that operation, the data is stale, or the path is outside what
 *     GitHub-side watching can see.
 * Coverage state is kept separate from the observation facts that justify it:
 * every operation carries `observation` {complete, stale, gap_codes} and
 * `downgrade_reasons` so consumers never infer a gap from the state alone.
 * Coverage depends ONLY on observation quality, never on actor classification
 * (D1/D3: classification is metadata, never authority).
 *
 * Stable output shape for consumers (#133 doctor, #70 onboarding): see
 * buildReport()'s JSDoc. Additive changes bump the minor via `schema_version`
 * policy in docs/CONTRACT.md.
 */

/** The four coverage states (THREAT_MODEL "Coverage vocabulary"); consumers must not invent others. */
export const COVERAGE_STATES = Object.freeze(['github_enforced', 'managed_gateway', 'advisory', 'ungoverned'])

const REPORT_SCHEMA_VERSION = 1
const STALE_AFTER_SECONDS = 10 * 60

/**
 * `would_have_governed`: operations the Alpha design (D1) would put behind
 * `lazyhub/approval`. Only the merge is gated by design; the others are
 * observed for audit context and have no Alpha policy yet.
 */
const OBSERVED_OPERATIONS = [
  { operation: 'pr_merge', event: 'pr_merge', would_have_governed: true },
  { operation: 'pr_review', event: 'pr_review', would_have_governed: false },
  { operation: 'commit_push', event: 'commit_push', would_have_governed: false },
  { operation: 'force_push', event: 'force_push', would_have_governed: false },
  { operation: 'check_run', event: 'check_run', would_have_governed: false },
]

/** Paths watch-only cannot see at all (T7). Always `ungoverned`. */
const UNOBSERVABLE_PATHS = [
  { operation: 'push_without_pull_request', reason: 'Only pull-request activity is read; direct branch pushes with no PR are not observed.' },
  { operation: 'non_github_paths', reason: 'Local work that never reached GitHub, alternate credentials, SSH, direct clients and other MCP servers are not observable from GitHub.' },
]

const GITHUB_ENFORCED_MISSING = 'lazyhub/approval required check with pinned App source and ruleset verification not installed or verified in watch-only'
const MANAGED_GATEWAY_MISSING = 'no lazyhub gateway/helper in the path in watch-only'

/**
 * Shared user-facing vocabulary (CLI, doctor, onboarding) so the three surfaces
 * cannot drift. Four distinct facts per operation: the operation itself,
 * observation quality (complete / fresh), enforcement (always none in
 * watch-only) and attribution (who GitHub says acted; metadata only, never
 * evidence of a verified human and never an input to coverage).
 */
export const ATTRIBUTION_LABELS = Object.freeze({
  agent: 'known agent',
  automation: 'known automation',
  human: 'GitHub user (not proof of a human)',
  shared: 'user + known agent',
  unknown: 'unattributed',
})

export const ENFORCEMENT_NOTE = 'Enforcement: none. Watch-only blocks nothing and installs no required check, so no operation is github_enforced or managed_gateway.'

export const ATTRIBUTION_NOTE = 'Attribution is who GitHub says acted. A GitHub user account does not prove a human wrote the change, and unattributed activity neither grants authority nor changes coverage.'

/**
 * Non-zero attribution counts as plain text, e.g. "known agent 2, unattributed 1".
 * @param {Record<string, number>} counts
 * @returns {string}
 */
export function describeAttribution(counts) {
  const parts = Object.keys(ATTRIBUTION_LABELS).filter(k => counts[k] > 0).map(k => `${ATTRIBUTION_LABELS[k]} ${counts[k]}`)
  return parts.length ? parts.join(', ') : 'none seen'
}

/** gap/downgrade code -> [what happened, safe next step]. Codes stay inspectable alongside. */
const REASON_COPY = {
  permission_missing: ['your gh token cannot read this repository\'s pull requests', 'check `gh auth status` and the token\'s repo read access'],
  rate_limited: ['GitHub rate limit reached; observation stopped early', 'wait for the limit to reset, then re-run'],
  rate_limit_low: ['GitHub rate limit nearly used up; observation stopped early', 'wait for the limit to reset, then re-run'],
  fetch_failed: ['activity could not be read', 'check your network and `gh auth status`, then re-run'],
  observation_unavailable: ['activity could not be read', 'check your network and `gh auth status`, then re-run'],
  pr_page_limit: ['older pull requests were not observed', 're-run with a larger --max-pages'],
  stale_observation: ['the data is older than 10 minutes', 're-run to refresh it'],
  not_observable: ['this path cannot be seen from GitHub', 'nothing to do in watch-only; treat it as unwatched'],
}

/**
 * Plain-language [what, next] for a gap code or downgrade reason, or null.
 * @param {string} code  e.g. `pr_page_limit`, `observation_gap:reviews_truncated`, `stale_observation`
 * @returns {[string, string]|null}
 */
export function explainReason(code) {
  const c = String(code).replace(/^observation_gap:/, '')
  if (REASON_COPY[c]) return REASON_COPY[c]
  if (/_truncated$/.test(c)) return ['activity beyond the read window was not observed', 're-run with a larger --limit or --max-pages']
  if (c.startsWith('repo_identity_unverified')) return ['the repository identity could not be verified', 'check `gh auth status` and the repository name']
  if (c.startsWith('ruleset_')) return ['rulesets could not be read, so approval rules are unknown', 'needs admin read access to rulesets; optional in watch-only']
  if (c.startsWith('alternate_path_detected')) return ['a path that bypasses GitHub-side watching was detected', 'review it with `lazyhub doctor --coverage`']
  return null
}

/**
 * Word-wrap to `width` columns; continuation lines keep `indent`. Over-long words are hard-broken, never dropped.
 * @param {string} text
 * @param {number} width
 * @param {string} indent
 * @returns {string[]}
 */
export function wrapText(text, width, indent) {
  const cont = `${indent}  `
  const out = []
  let line = indent
  const flush = () => { out.push(line); line = cont }
  for (let word of text.split(' ')) {
    if (line.trim() && line.length + 1 + word.length > width) flush()
    while (indent.length + word.length > width) {
      if (line.trim()) flush()
      const room = width - line.length
      line += word.slice(0, room)
      word = word.slice(room)
      flush()
    }
    line += (line.trim() ? ' ' : '') + word
  }
  out.push(line)
  return out
}

const emptyCounts = () => ({ agent: 0, automation: 0, human: 0, shared: 0, unknown: 0 })

function actorSummary(events) {
  const byKey = new Map()
  const add = a => {
    const key = `${a.source}:${a.login ?? a.registry_id ?? '?'}:${a.class}`
    const row = byKey.get(key) || { login: a.login, type: a.type, source: a.source, class: a.class, registry_id: a.registry_id, label: a.label, evidence: a.evidence, event_count: 0 }
    row.event_count += 1
    byKey.set(key, row)
  }
  events.forEach(e => e.actors.forEach(add))
  return [...byKey.values()].sort((a, b) => b.event_count - a.event_count)
}

/**
 * Build the report from a classified observation.
 *
 * @param {object} classified  classifyObservation(observeRepo(...))
 * @param {{now?: () => number}} [opts]
 * @returns {{
 *   schema_version: 1, mode: 'watch_only', repo: string, generated_at: string, observed_at: string,
 *   staleness: {stale: boolean, age_seconds: number, stale_after_seconds: number, newest_activity_at: string|null},
 *   observation: {complete: boolean, truncated: boolean, pages_fetched: number, pull_requests_examined: number, rate_limit: object|null, gaps: object[]},
 *   operations: {operation: string, coverage: string, reason: string, evidence: object,
 *                observation: {complete: boolean, stale: boolean, gap_codes: string[]}, downgrade_reasons: string[],
 *                would_have_governed: boolean, observed: {total: number, by_attribution: object}}[],
 *   pull_requests: object[], actors: object[], events: object[], notes: string[]
 * }}
 */
export function buildReport(classified, { now = Date.now } = {}) {
  const { events, gaps } = classified
  const generated = now()
  const age = Math.max(0, Math.floor((generated - Date.parse(classified.observed_at)) / 1000))
  const stale = age > STALE_AFTER_SECONDS
  const newest = events.map(e => e.at).filter(Boolean).sort().at(-1) || null

  const operations = OBSERVED_OPERATIONS.map(({ operation, event, would_have_governed }) => {
    const mine = events.filter(e => e.type === event)
    const gap_codes = gaps.filter(g => g.operations.includes(operation)).map(g => g.code)
    const by_attribution = emptyCounts()
    mine.forEach(e => { by_attribution[e.attribution] += 1 })
    const complete = gap_codes.length === 0
    const downgrade_reasons = [...gap_codes.map(code => `observation_gap:${code}`), ...(stale ? ['stale_observation'] : [])]
    const reliable = downgrade_reasons.length === 0
    return {
      operation,
      coverage: reliable ? 'advisory' : 'ungoverned',
      reason: reliable
        ? 'Observed on GitHub after the fact; watch-only reports it but enforces nothing (no lazyhub/approval check, no gateway).'
        : 'Observation is incomplete or stale for this operation; no reliable visibility is claimed.',
      evidence: {
        source: 'github_graphql_readonly',
        enforcement: 'none',
        github_enforced_missing: GITHUB_ENFORCED_MISSING,
        managed_gateway_missing: MANAGED_GATEWAY_MISSING,
      },
      observation: { complete, stale, gap_codes },
      downgrade_reasons,
      would_have_governed,
      observed: { total: mine.length, by_attribution },
    }
  })

  for (const p of UNOBSERVABLE_PATHS) {
    operations.push({
      operation: p.operation,
      coverage: 'ungoverned',
      reason: p.reason,
      evidence: { source: 'none', enforcement: 'none', github_enforced_missing: GITHUB_ENFORCED_MISSING, managed_gateway_missing: MANAGED_GATEWAY_MISSING },
      observation: { complete: false, stale, gap_codes: ['not_observable'] },
      downgrade_reasons: ['not_observable'],
      would_have_governed: false,
      observed: { total: 0, by_attribution: emptyCounts() },
    })
  }

  return {
    schema_version: REPORT_SCHEMA_VERSION,
    mode: 'watch_only',
    repo: classified.repo,
    generated_at: new Date(generated).toISOString(),
    observed_at: classified.observed_at,
    staleness: { stale, age_seconds: age, stale_after_seconds: STALE_AFTER_SECONDS, newest_activity_at: newest },
    observation: {
      complete: gaps.length === 0,
      truncated: gaps.length > 0,
      pages_fetched: classified.pages_fetched,
      pull_requests_examined: classified.pull_requests.length,
      rate_limit: classified.rate_limit,
      gaps,
    },
    operations,
    pull_requests: classified.pull_requests,
    actors: actorSummary(events),
    events,
    notes: [
      'Report is local; nothing was sent anywhere and nothing was written to GitHub.',
      'Actor classes are audit metadata only and never grant or bypass authority.',
      '"human" means a GitHub User account with no known-agent evidence, not a verified person.',
      ATTRIBUTION_NOTE,
      'Local work that never reached GitHub is not observed.',
    ],
  }
}
