import { listCacheEntries } from '../cache.js'

const STALE_AFTER_SECONDS = 10 * 60

function newest(entries, op) {
  return entries
    .filter(entry => entry?.meta?.op === op)
    .sort((a, b) => b.ts - a.ts)[0] || null
}

function hasFailingCheck(pr) {
  return (pr?.statusCheckRollup || []).some(check => {
    const conclusion = String(check?.conclusion || '').toUpperCase()
    const state = String(check?.state || check?.status || '').toUpperCase()
    return ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED'].includes(conclusion) ||
      ['FAILURE', 'ERROR'].includes(state)
  })
}

function wantsMyReview(pr) {
  const decision = String(pr?.reviewDecision || '').toUpperCase()
  if (['REVIEW_REQUIRED', 'CHANGES_REQUESTED'].includes(decision)) return true
  return (pr?.reviewRequests || []).some(request => {
    const login = String(request?.login || request?.name || '')
    return login === '@me' || login.toLowerCase() === String(process.env.GITHUB_USER || process.env.USER || '').toLowerCase()
  })
}

/**
 * Compute ambient-status counts from disk cache entries.
 *
 * @param {Array} entries
 * @param {number} now
 * @returns {object|null}
 */
export function summarizeStatus(entries = listCacheEntries(), now = Date.now()) {
  const prs = newest(entries, 'listPRs')
  const notifications = newest(entries, 'listNotifications')
  if (!prs && !notifications) return null

  const prList = Array.isArray(prs?.payload) ? prs.payload : []
  const notificationList = Array.isArray(notifications?.payload) ? notifications.payload : []
  const newestTs = Math.max(prs?.ts || 0, notifications?.ts || 0)
  const cacheAgeSeconds = newestTs ? Math.max(0, Math.floor((now - newestTs) / 1000)) : null

  return {
    schema_version: 1,
    counts: {
      review_requested: prList.filter(wantsMyReview).length,
      failing_ci: prList.filter(hasFailingCheck).length,
      unread_notifications: notificationList.filter(item => item?.unread !== false).length,
    },
    cache_age_seconds: cacheAgeSeconds,
  }
}

function color(text, code) {
  if (process.env.NO_COLOR) return text
  return `\u001b[${code}m${text}\u001b[0m`
}

/**
 * Format status counts for tmux, starship, or JSON consumers.
 *
 * @param {object|null} summary
 * @param {string} format
 * @returns {string}
 */
export function formatStatus(summary, format = 'tmux') {
  if (!summary) return 'lazyhub: no data - open the app once'
  if (format === 'json') return JSON.stringify(summary)
  const parts = [
    color(`REV:${summary.counts.review_requested}`, '36'),
    color(`CI:${summary.counts.failing_ci}`, summary.counts.failing_ci > 0 ? '31' : '32'),
    color(`NOT:${summary.counts.unread_notifications}`, '35'),
  ]
  const age = summary.cache_age_seconds
  if (Number.isFinite(age) && age > STALE_AFTER_SECONDS) parts.push(`(${Math.floor(age / 60)}m)`)
  return parts.join(' ')
}

function parseArgs(args) {
  let format = 'tmux'
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--format') {
      format = args[i + 1]
      i += 1
    } else if (args[i].startsWith('--format=')) {
      format = args[i].slice('--format='.length)
    } else {
      return { error: `unknown argument: ${args[i]}` }
    }
  }
  if (!['tmux', 'starship', 'json'].includes(format)) return { error: `unsupported status format: ${format}` }
  return { format }
}

/**
 * Run `lazyhub status`.
 *
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export async function runStatus(args = []) {
  const parsed = parseArgs(args)
  if (parsed.error) {
    process.stderr.write(`lazyhub status: ${parsed.error}\n`)
    return 2
  }
  process.stdout.write(`${formatStatus(summarizeStatus(), parsed.format)}\n`)
  return 0
}
