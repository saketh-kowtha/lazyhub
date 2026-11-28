/**
 * features/queue/rank.js - the "Start here" ranking and the per-row signal badges (#177 phase 2,
 * merged from #363). Pure: no I/O, no React.
 *
 * The ranking is a fixed list of sort keys, compared in order. Every key a row was placed by is
 * returned as words (`rankSteps`), so the strip can show exactly why a row is where it is. There is
 * no score, no weight and no hidden tie-break: the last key is repository and number, and it is
 * named too. Keys, in order:
 *
 *   1. section    Needs you, then Waiting on others, then Stale (no update in `staleDays` days)
 *   2. tier       inside a section: review requested of you, via a team, your PR ready to merge,
 *                 your PR blocked (CI failing, changes requested, merge conflict), your PR waiting,
 *                 facts unavailable
 *   3. clear      CI passing (or none reported) and mergeable and not a draft, before the rest;
 *                 an unavailable fact is "not known clear", never clear
 *   4. age        days since the last update, oldest first (waiting longest first); unknown last
 *   5. size       added plus deleted lines, smallest first; unknown last
 *   6. ref        repository, then number
 *
 * A review request of you is never moved to Stale: someone is waiting on you however old it is.
 *
 * Badges are facts that are already in the evidence record, or results another feature already
 * computed and cached; the queue never fetches for a badge. A badge whose source does not exist or
 * has no data for the row is hidden, never guessed. Review Story (#362) produces no risk rating and
 * Claims check (#361) has no cached result per PR yet, so neither has a badge here.
 */

import { sanitizePath } from '../../utils-core.js'

const UNKNOWN = 'unknown'
const DAY_MS = 86_400_000

/** Default for `[queue].stale_days`. */
export const STALE_DAYS_DEFAULT = 14

/** @param {any} v */
const known = v => v !== undefined && v !== null && v !== UNKNOWN

/** Section order and wording. */
export const SECTIONS = Object.freeze([
  { id: 'needs_you', label: 'Needs you' },
  { id: 'waiting', label: 'Waiting on others' },
  { id: 'stale', label: 'Stale' },
])

/** Tier order inside a section; `words` is what the strip says. */
const TIERS = Object.freeze(/** @type {Record<string, {order: number, section: string, words: string, short: string}>} */ ({
  review_direct: { order: 0, section: 'needs_you', words: 'review requested of you', short: 'review of you' },
  review_team: { order: 1, section: 'needs_you', words: 'review requested via a team', short: 'via team' },
  yours_ready: { order: 2, section: 'needs_you', words: 'your PR is ready to merge', short: 'yours, ready' },
  yours_blocked: { order: 3, section: 'needs_you', words: 'your PR needs a fix', short: 'yours, blocked' },
  yours_waiting: { order: 4, section: 'waiting', words: 'your PR is waiting', short: 'yours, waiting' },
  facts_unknown: { order: 5, section: 'waiting', words: 'facts unavailable', short: 'facts unknown' },
}))

/** @param {any} item */
function codes(item) {
  return new Set((Array.isArray(item?.attention) ? item.attention : []).map((/** @type {any} */ r) => r.code))
}

/**
 * Which tier a row is in, and the fact that put it there.
 * @param {any} item evidence record
 * @returns {{tier: string, detail: string|null}}
 */
export function tierOf(item) {
  const has = codes(item)
  const reasons = Array.isArray(item?.attention) ? item.attention : []
  const request = reasons.find((/** @type {any} */ r) => r.code === 'review_requested')
  if (request) return { tier: request.value?.via === 'team_unverified' ? 'review_team' : 'review_direct', detail: null }
  const group = item?.group?.group
  if (group === 'ready') return { tier: 'yours_ready', detail: null }
  const blockers = [['ci_failing', 'CI failing'], ['changes_requested', 'changes requested'], ['merge_conflict', 'merge conflict']]
    .filter(([code]) => has.has(code)).map(([, words]) => words)
  if (blockers.length > 0) return { tier: 'yours_blocked', detail: blockers.join(', ') }
  if (group === 'unknown') return { tier: 'facts_unknown', detail: null }
  return { tier: 'yours_waiting', detail: has.has('ci_pending') ? 'CI still running' : 'for a review' }
}

/**
 * Clear to act on: CI passing (or none reported), mergeable, not a draft. Each part that is not
 * known is named, so "not clear" says why.
 * @param {any} item evidence record
 * @returns {{clear: boolean, words: string}}
 */
export function clearOf(item) {
  const checks = item?.facts?.checks?.value
  const merge = item?.facts?.mergeable?.value
  const draft = item?.facts?.is_draft?.value
  /** @type {string[]} */
  const missing = []
  const ciState = checks?.state
  if (!known(ciState)) missing.push('CI unknown')
  else if (!(ciState === 'SUCCESS' || ciState === 'none_reported') || checks.failed > 0) missing.push(ciState === 'PENDING' || ciState === 'EXPECTED' ? 'CI running' : 'CI not passing')
  if (!known(merge)) missing.push('mergeability unknown')
  else if (merge !== 'MERGEABLE') missing.push(merge === 'CONFLICTING' ? 'merge conflict' : 'not mergeable yet')
  if (draft === true) missing.push('draft')
  if (missing.length === 0) return { clear: true, words: `clear (${ciState === 'none_reported' ? 'no CI' : 'CI passing'}, mergeable)` }
  return { clear: false, words: `not clear (${missing.join(', ')})` }
}

/**
 * Whole days since the last update, or null when GitHub did not return the time.
 * @param {any} item
 * @param {number} now epoch ms
 * @returns {number|null}
 */
export function ageDays(item, now) {
  const v = item?.facts?.updated_at?.value
  const ms = known(v) ? Date.parse(v) : NaN
  if (!Number.isFinite(ms)) return null
  return Math.max(0, Math.floor((now - ms) / DAY_MS))
}

/** Size buckets by added plus deleted lines; the bounds are shown in the strip. */
export const SIZE_BUCKETS = Object.freeze([
  { label: 'XS', max: 10 },
  { label: 'S', max: 100 },
  { label: 'M', max: 400 },
  { label: 'L', max: 1000 },
  { label: 'XL', max: Infinity },
])

/**
 * Estimated review size from GitHub's added and deleted line counts.
 * @param {any} item evidence record
 * @returns {{label: string, lines: number|null, words: string}}
 */
export function sizeOf(item) {
  const d = item?.facts?.diff?.value
  const add = known(d?.additions) ? Number(d.additions) : NaN
  const del = known(d?.deletions) ? Number(d.deletions) : NaN
  if (!Number.isFinite(add) || !Number.isFinite(del)) return { label: '?', lines: null, words: 'size unknown' }
  const lines = add + del
  const bucket = SIZE_BUCKETS.find(b => lines <= b.max) || SIZE_BUCKETS[SIZE_BUCKETS.length - 1]
  const files = known(d?.changed_files) ? ` in ${d.changed_files} file${d.changed_files === 1 ? '' : 's'}` : ''
  return { label: bucket.label, lines, words: `size ${bucket.label} (+${add}/-${del}${files})` }
}

/** @param {number|null} days */
function ageText(days) {
  if (days === null) return 'last update unknown'
  return days === 0 ? 'updated within a day' : `no update for ${days}d`
}

/** @param {number|null} days */
function ageShort(days) {
  if (days === null) return 'age ?'
  return days === 0 ? '<1d old' : `${days}d old`
}

/**
 * One ranked row: its position, section and every key that placed it, in full (`steps`) and in
 * the short words a narrow strip uses (`short`, same keys in the same order).
 * @typedef {{item: any, rank: number, section: string, tier: string, steps: string[], short: string[]}} RankedRow
 */

/**
 * Rank the loaded rows. Deterministic: the same items and `now` give the same order.
 * @param {any[]} items evidence records
 * @param {{now?: number, staleDays?: number}} [opts]
 * @returns {RankedRow[]}
 */
export function rankQueue(items, { now = Date.now(), staleDays = STALE_DAYS_DEFAULT } = {}) {
  const rows = items.map(item => {
    const { tier, detail } = tierOf(item)
    const days = ageDays(item, now)
    const stale = days !== null && days > staleDays && tier !== 'review_direct' && tier !== 'review_team'
    const section = stale ? 'stale' : TIERS[tier].section
    const clear = clearOf(item)
    const size = sizeOf(item)
    return { item, tier, detail, days, section, clear, size }
  })
  const sectionOrder = (/** @type {string} */ id) => SECTIONS.findIndex(s => s.id === id)
  rows.sort((a, b) =>
    sectionOrder(a.section) - sectionOrder(b.section)
    || TIERS[a.tier].order - TIERS[b.tier].order
    || Number(b.clear.clear) - Number(a.clear.clear)
    || (b.days ?? -1) - (a.days ?? -1)
    || (a.size.lines ?? Infinity) - (b.size.lines ?? Infinity)
    || String(a.item.identity.repo).localeCompare(String(b.item.identity.repo))
    || a.item.identity.number - b.item.identity.number)
  return rows.map((r, i) => {
    const sectionLabel = SECTIONS.find(s => s.id === r.section)?.label || r.section
    const tierWords = r.detail ? `${TIERS[r.tier].words}: ${r.detail}` : TIERS[r.tier].words
    const author = r.tier === 'review_direct' || r.tier === 'review_team' ? authorOf(r.item) : null
    const steps = [
      r.section === 'stale' ? `${sectionLabel} (no update in more than ${staleDays}d)` : sectionLabel,
      author ? `${tierWords} (@${author} is waiting)` : tierWords,
      r.clear.words,
      ageText(r.days),
      r.size.words,
    ]
    const short = [
      r.section === 'stale' ? `${sectionLabel} (>${staleDays}d)` : sectionLabel,
      r.tier === 'yours_blocked' && r.detail ? `yours, ${r.detail}` : TIERS[r.tier].short,
      r.clear.clear ? 'clear' : 'not clear',
      ageShort(r.days),
      r.size.lines === null ? 'size ?' : r.size.label,
    ]
    return { item: r.item, rank: i + 1, section: r.section, tier: r.tier, steps, short }
  })
}

/** @param {any} item */
function authorOf(item) {
  const login = item?.actor?.login
  return known(login) ? sanitizePath(String(login)) : null
}

/**
 * The rank line for the strip: position, then every key in order. Every key is always named; when
 * the full words do not fit `maxWidth`, the short words are used (each key's own words first, the
 * leading keys keeping their full words longest), and only then is the line cut.
 * @param {RankedRow} row
 * @param {number} total rows ranked
 * @param {number} [maxWidth] columns
 * @param {(s: string) => number} [measure] display width
 * @returns {string}
 */
export function rankLine(row, total, maxWidth = Infinity, measure = s => s.length) {
  const build = (/** @type {string[]} */ parts) => `${row.rank} of ${total}: ${parts.join(' > ')}`
  // Shorten from the last key backwards: the section and tier are what a reader looks for first.
  for (let keep = row.steps.length; keep >= 0; keep -= 1) {
    const line = build([...row.steps.slice(0, keep), ...row.short.slice(keep)])
    if (measure(line) <= maxWidth) return line
  }
  const line = build(row.short)
  let out = ''
  for (const ch of line) { if (measure(`${out}${ch}`) > maxWidth - 1) break; out += ch }
  return `${out}…`
}

/**
 * The sort keys in words, for the help line under an empty strip and the docs.
 * @param {number} [staleDays]
 */
export function rankOrderText(staleDays = STALE_DAYS_DEFAULT) {
  return `order: needs you, waiting, stale (>${staleDays}d) > review of you, via team, yours ready, yours blocked, yours waiting > clear first > oldest first > smallest first`
}

/**
 * Signal badges for one row, most important first. Each has a short `text` for the row and
 * `words` for the strip; `tone` names a theme token family (the view resolves it).
 * @param {any} item evidence record
 * @param {{collisions?: number[]|null}} [extra] results other features already cached for this PR
 * @returns {{id: string, text: string, words: string, tone: string}[]}
 */
export function badgesFor(item, { collisions = null } = {}) {
  /** @type {{id: string, text: string, words: string, tone: string}[]} */
  const out = []
  const has = codes(item)
  const checks = item?.facts?.checks?.value
  if (has.has('ci_failing')) {
    const failed = known(checks?.failed) && checks.failed > 0 ? `${checks.failed}${checks.truncated ? '+' : ''} failing` : 'failing'
    out.push({ id: 'ci', text: '✗CI', words: `CI red (${failed})`, tone: 'fail' })
  }
  if (has.has('merge_conflict')) out.push({ id: 'conflict', text: '⚠conf', words: 'merge conflict (GitHub)', tone: 'error' })
  if (Array.isArray(collisions) && collisions.length > 0) {
    const first = collisions[0]
    out.push({ id: 'collision', text: `⑂#${first}`, words: `collides with ${collisions.map(n => `#${n}`).join(', ')} (collision radar)`, tone: 'warning' })
  }
  if (item?.actor?.github_type === 'Bot') out.push({ id: 'bot', text: 'bot', words: 'author is a GitHub bot account', tone: 'muted' })
  if (has.has('draft')) out.push({ id: 'draft', text: 'draft', words: 'draft', tone: 'muted' })
  return out
}

/**
 * Fit the size label and badges into `width` columns, dropping the least important badges first;
 * a dropped badge is counted as "+N" so nothing disappears silently (the strip lists them all).
 * @param {string} sizeLabel
 * @param {{text: string}[]} badges
 * @param {number} width
 * @param {(s: string) => number} measure display width
 * @returns {{shown: any[], dropped: number}}
 */
export function fitBadges(sizeLabel, badges, width, measure) {
  for (let n = badges.length; n >= 0; n -= 1) {
    const shown = badges.slice(0, n)
    const dropped = badges.length - n
    const text = [sizeLabel, ...shown.map(b => b.text), ...(dropped ? [`+${dropped}`] : [])].join(' ')
    if (measure(text) <= width) return { shown, dropped }
  }
  return { shown: [], dropped: badges.length }
}
