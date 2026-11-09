/**
 * features/queue/model.js - pure view model of the review queue (#177). No I/O, no React.
 *
 * The queue shows evidence records from `fetchReviewQueueEvidence` (src/executor/evidence.js,
 * #175). Every row says WHY it is in the queue by naming the attention reason that placed it
 * there; the "why" strip lists every reason with the fact it cites. Nothing here scores,
 * ranks by a hidden number or says a PR is "safe": a reason is a pointer to evidence a human
 * should look at. Missing facts are worded as unavailable, never as fine.
 *
 * GitHub-sourced strings (team slugs) are cleaned here with the shared helpers; the evidence
 * record keeps them raw for non-display use.
 */

import { sanitize, sanitizePath } from '../../utils-core.js'

const UNKNOWN = 'unknown'

/**
 * Sidebar / chip order and wording. A status is a glyph plus a word, never colour alone.
 * `tone` names a theme token family; the view resolves it through useTheme() (no colours here).
 */
export const GROUPS = Object.freeze([
  { id: 'needs_my_review', glyph: '◔', label: 'Needs my review', chip: 'Review', tone: 'warning' },
  { id: 'ci_failing', glyph: '✗', label: 'CI failing', chip: 'CI', tone: 'fail' },
  { id: 'changes_requested', glyph: '▲', label: 'Changes requested', chip: 'Changes', tone: 'error' },
  { id: 'waiting', glyph: '…', label: 'Waiting on others', chip: 'Waiting', tone: 'muted' },
  { id: 'ready', glyph: '✓', label: 'Ready to merge', chip: 'Ready', tone: 'pass' },
  { id: 'unknown', glyph: '?', label: 'Unavailable data', chip: 'Unknown', tone: 'muted' },
])

/** @param {any} v */
const known = v => v !== undefined && v !== null && v !== UNKNOWN

/**
 * @param {any} item evidence record
 * @returns {number} epoch ms of the last update, or 0 when GitHub did not return one
 */
function updatedMs(item) {
  const v = item?.facts?.updated_at?.value
  const ms = known(v) ? Date.parse(v) : NaN
  return Number.isFinite(ms) ? ms : 0
}

/** @param {any} teams slugs from a review-requests fact */
function teamList(teams) {
  const list = (Array.isArray(teams) ? teams : []).map(s => `@${sanitizePath(String(s))}`)
  return list.length > 0 ? list.join(', ') : 'a team'
}

/**
 * Human wording of one attention reason, citing the fact it came from.
 * @param {{code: string, value?: any, detail?: string}} reason an entry of `item.attention`
 * @returns {string}
 */
export function reasonText(reason) {
  const v = reason.value
  switch (reason.code) {
    case 'review_requested': {
      if (v?.via === 'direct') return 'review requested of you'
      if (v?.via === 'team_unverified') return `review requested from ${teamList(v.teams)} (GitHub does not say if it is you)`
      return 'review requested (found by the review-requested search)'
    }
    case 'ci_failing': {
      if (known(v?.failed) && known(v?.total) && v.failed > 0) return `${v.failed}${v.truncated ? '+' : ''} of ${v.total} checks failing`
      return `CI ${String(v?.state || 'failing').toLowerCase()}`
    }
    case 'ci_pending': return 'CI still running'
    case 'checks_unavailable': return 'CI status unavailable'
    case 'changes_requested': return 'changes requested'
    case 'stale_approval': return `${v?.staleApprovals} approval${v?.staleApprovals === 1 ? '' : 's'} on an older commit`
    case 'unresolved_threads': return `${v?.unresolved}${v?.truncated ? '+' : ''} unresolved thread${v?.unresolved === 1 ? '' : 's'}`
    case 'merge_conflict': return 'merge conflict'
    case 'mergeability_unknown': return 'mergeability not computed yet'
    case 'draft': return 'draft'
    default: return sanitize(String(reason.code))
  }
}

/** Why a PR is in a group that is not named by one reason code. */
const BECAUSE_TEXT = Object.freeze(/** @type {Record<string, string>} */ ({
  approved_checks_passing_mergeable: 'approved, CI passing, mergeable',
  awaiting_review: 'waiting for a review',
  review_decision_unknown: 'review decision unavailable',
}))

/**
 * The short "why it is here" for a row: the reason that decided the group, plus how many
 * other reasons the strip below lists.
 * @param {any} item evidence record
 * @returns {string}
 */
export function rowWhy(item) {
  const because = item?.group?.because
  const reasons = Array.isArray(item?.attention) ? item.attention : []
  const primary = reasons.find((/** @type {any} */ r) => r.code === because)
  let text
  if (primary) {
    // A row is narrow: the team caveat is shortened here and kept in full on the strip.
    text = primary.code === 'review_requested' && primary.value?.via === 'team_unverified'
      ? `via team ${teamList(primary.value.teams)}`
      : reasonText(primary)
  } else {
    text = BECAUSE_TEXT[String(because)] || sanitize(String(because || 'no reason recorded'))
  }
  const more = reasons.filter((/** @type {any} */ r) => r !== primary).length
  return more > 0 ? `${text} +${more}` : text
}

/**
 * @param {number} ms elapsed milliseconds
 * @returns {string|null} "just now", "2m ago", ... or null for an unusable value
 */
export function ageWords(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null
  const s = Math.floor(ms / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

/**
 * Every reason a PR is in the queue, then the facts the human is looking at: the inspected
 * head, CI counts, mergeability. Unavailable facts are said to be unavailable.
 * @param {any} item evidence record
 * @param {number} [now] epoch ms, for the "seen" age
 * @returns {string}
 */
export function whyLine(item, now = Date.now()) {
  const reasons = Array.isArray(item?.attention) ? item.attention : []
  const parts = reasons.length > 0
    ? reasons.map((/** @type {any} */ r) => reasonText(r))
    : [BECAUSE_TEXT[String(item?.group?.because)] || 'no attention reason recorded']
  const head = item?.context?.head?.value
  parts.push(known(head) ? `head ${String(head).slice(0, 7)}` : 'head unavailable')
  const checks = item?.facts?.checks?.value
  if (checks?.state === 'none_reported') parts.push('no CI reported')
  else if (known(checks?.total) && known(checks?.passed)) parts.push(`CI ${checks.passed}/${checks.total} passed${checks.truncated ? ' (first checks only)' : ''}`)
  else parts.push('CI unavailable')
  const merge = item?.facts?.mergeable?.value
  parts.push(known(merge) ? String(merge).toLowerCase() : 'mergeability unavailable')
  const seen = item?.fetched_at ? ageWords(now - Date.parse(item.fetched_at)) : null
  if (seen) parts.push(`seen ${seen}`)
  return parts.join(' · ')
}

/**
 * Short CI cell for a row, always a glyph plus text.
 * @param {any} item evidence record
 * @returns {{text: string, tone: 'pass'|'fail'|'pending'|'muted'}}
 */
export function ciCell(item) {
  const c = item?.facts?.checks?.value
  if (!c || c.state === UNKNOWN) return { text: '? n/a', tone: 'muted' }
  if (c.state === 'none_reported') return { text: '- none', tone: 'muted' }
  const frac = known(c.total) ? `${known(c.passed) ? c.passed : '?'}/${c.total}` : ''
  if ((known(c.failed) && c.failed > 0) || ['FAILURE', 'ERROR'].includes(c.state)) return { text: `✗ ${frac}`.trim(), tone: 'fail' }
  if (c.state === 'PENDING' || c.state === 'EXPECTED') return { text: `… ${frac}`.trim(), tone: 'pending' }
  if (c.state === 'SUCCESS') return { text: `✓ ${frac}`.trim(), tone: 'pass' }
  return { text: '? n/a', tone: 'muted' }
}

/**
 * Add a freshly fetched page to what is already loaded. A PR seen in both searches keeps both
 * memberships; when the later page adds the review request, that record (computed with the
 * request known) replaces the earlier one so the PR lands in the right group.
 * @param {any[]} current items already loaded
 * @param {any[]} page items of the new page
 * @returns {any[]}
 */
export function mergeItems(current, page) {
  const keyOf = (/** @type {any} */ i) => `${i.identity.repo}#${i.identity.number}`
  const byKey = new Map(current.map(i => [keyOf(i), i]))
  for (const next of page) {
    const prev = byKey.get(keyOf(next))
    if (!prev) { byKey.set(keyOf(next), next); continue }
    const prevReq = (prev.membership || []).includes('review_requested')
    const nextReq = (next.membership || []).includes('review_requested')
    const membership = [...new Set([...(prev.membership || []), ...(next.membership || [])])]
    byKey.set(keyOf(next), { ...(nextReq && !prevReq ? next : prev), membership })
  }
  return [...byKey.values()]
}

/**
 * Split items into the groups, most recently updated first inside each; counts equal rows.
 * @param {any[]} items evidence records
 * @returns {{id: string, glyph: string, label: string, chip: string, tone: string, items: any[]}[]}
 */
export function groupQueue(items) {
  const sorted = [...items].sort((a, b) =>
    updatedMs(b) - updatedMs(a)
    || String(a.identity.repo).localeCompare(String(b.identity.repo))
    || a.identity.number - b.identity.number)
  return GROUPS.map(g => ({ ...g, items: sorted.filter(i => i.group?.group === g.id) }))
}

/**
 * Plain-language statement of what the loaded queue does not cover (D16: never silent).
 * Short enough to stay whole on an 80-column line.
 * @param {{review_requested?: any, authored?: any}|undefined} truncation per-search totals and `has_more`
 * @returns {string|null} null when everything GitHub reported is loaded
 */
export function truncationSummary(truncation) {
  /** @type {string[]} */
  const parts = []
  /** @type {[string, any][]} */
  const searches = [['review requests', truncation?.review_requested], ['your PRs', truncation?.authored]]
  for (const [name, t] of searches) {
    if (t?.has_more) parts.push(known(t.total) ? `${name} (${t.total} in all)` : name)
  }
  return parts.length > 0 ? `not all loaded: ${parts.join(', ')}` : null
}
