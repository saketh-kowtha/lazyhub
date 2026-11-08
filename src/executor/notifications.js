import { runGh } from './core.js'

const NOTIFICATION_PAGE_SIZE = 50
// 1,000 notifications; bounds the walk for `all` (read + unread history can be huge).
const NOTIFICATION_MAX_PAGES = 20
const NOTIFICATION_PAGE_TIMEOUT = 60_000

/**
 * List notifications, paging by hand (50 per page) up to a ceiling. The returned array
 * carries `truncated` (ceiling hit) and `partialError` (a later page failed; the pages
 * already fetched are kept) so the pane can say so instead of silently stopping.
 * @param filter
 */
export async function listNotifications(/** @type {Record<string, any>} */ filter = {}) {
  const out = []
  let truncated = false
  let partialError = null
  for (let page = 1; ; page++) {
    let rows
    try {
      // `all` walks read history too: give each call longer than the 30s default.
      rows = await runGh(
        ['api', `notifications?per_page=${NOTIFICATION_PAGE_SIZE}&page=${page}${filter.all ? '&all=true' : ''}`],
        filter.all ? { timeout: NOTIFICATION_PAGE_TIMEOUT } : undefined,
      )
    } catch (err) {
      if (page === 1) throw err
      partialError = String(err.message || err).split('\n')[0]
      break
    }
    const list = Array.isArray(rows) ? rows : []
    out.push(...list.filter(Boolean).map(n => ({
      id: n.id,
      unread: n.unread,
      reason: n.reason,
      subject: { title: n.subject?.title, type: n.subject?.type, url: n.subject?.url },
      repository: { fullName: n.repository?.full_name, name: n.repository?.name },
      updatedAt: n.updated_at,
    })))
    if (list.length < NOTIFICATION_PAGE_SIZE) break
    if (page >= NOTIFICATION_MAX_PAGES) { truncated = true; break }
  }
  return Object.assign(out, { truncated, partialError })
}

/**
 * Mark all notifications as read in a single API call.
 */
export async function markAllNotificationsRead() {
  return runGh(['api', 'notifications', '--method', 'PUT', '--field', 'read=true'])
}

/**
 * Mark a notification as read.
 * @param notificationId
 */
export async function markNotificationRead(/** @type {any} */ notificationId) {
  const args = [
    'api', `notifications/threads/${encodeURIComponent(notificationId)}`,
    '--method', 'PATCH',
  ]
  return runGh(args)
}

// ─── PR diff and comment functions ───────────────────────────────────────────
