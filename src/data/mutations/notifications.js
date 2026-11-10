/**
 * Declared writes for the Notifications view (V2a, #597).
 * Both patch the cached list (the list is unread-only, so a read thread leaves it) and refetch nothing:
 * a notification write touches no PR, issue, run or branch read.
 */

import { defineMutation, runMutation } from './core.js'
import { ghQueryKey } from '../ghKeys.js'
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../../executor.js'

/** The cache key `useGh(listNotifications, [])` reads under. */
const listKey = () => ghQueryKey(listNotifications, [])

/**
 * Keep the list's `truncated` / `partialError` notices when rows are removed.
 * @param {any[]} rows
 * @param {any} prev
 */
const withNotices = (rows, prev) =>
  Object.assign(rows, { truncated: prev?.truncated, partialError: prev?.partialError })

export const markNotificationReadMutation = defineMutation({
  name: 'notifications.markRead',
  run: (/** @type {string} */ id) => markNotificationRead(id),
  label: 'Marking as read',
  success: 'Marked as read',
  optimistic: (id) => [{
    key: listKey(),
    update: (/** @type {any} */ prev) => (Array.isArray(prev) ? withNotices(prev.filter(n => n.id !== id), prev) : prev),
  }],
  invalidates: () => [],
})

export const markAllNotificationsReadMutation = defineMutation({
  name: 'notifications.markAllRead',
  run: () => markAllNotificationsRead(),
  label: 'Marking all as read',
  success: 'All marked as read',
  optimistic: () => [{
    key: listKey(),
    update: (/** @type {any} */ prev) => (Array.isArray(prev) ? withNotices([], prev) : prev),
  }],
  invalidates: () => [],
})

/**
 * Mark a thread read without a status line (opening a notification navigates away). Same
 * declaration, so it is patched, rolled back on failure and never invalidates repo-wide.
 * @param {string} id
 */
export function markNotificationReadQuietly(id) {
  return runMutation(markNotificationReadMutation, [id])
}
