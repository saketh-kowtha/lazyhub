import { runGh } from './core.js'

/**
 * List notifications.
 * @param filter
 */
export async function listNotifications(filter = {}) {
  // The API returns 50 per page; follow every page so older notifications are never hidden.
  const args = [
    'api', `notifications?per_page=50${filter.all ? '&all=true' : ''}`,
    '--paginate', '--slurp',
  ]
  const pages = await runGh(args)
  return (Array.isArray(pages) ? pages : []).flat().filter(Boolean).map(n => ({
    id: n.id,
    unread: n.unread,
    reason: n.reason,
    subject: { title: n.subject?.title, type: n.subject?.type, url: n.subject?.url },
    repository: { fullName: n.repository?.full_name, name: n.repository?.name },
    updatedAt: n.updated_at,
  }))
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
export async function markNotificationRead(notificationId) {
  const args = [
    'api', `notifications/threads/${encodeURIComponent(notificationId)}`,
    '--method', 'PATCH',
  ]
  return runGh(args)
}

// ─── PR diff and comment functions ───────────────────────────────────────────
