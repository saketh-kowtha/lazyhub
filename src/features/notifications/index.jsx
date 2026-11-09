/**
 * src/features/notifications/index.jsx — Notifications pane
 */

import { logSwallowed } from '../../contain.js'
import React, { useState, useEffect, useContext } from 'react'
import { Box, Text, useStdout } from 'ink'
import { format } from 'timeago.js'
import { useKeymapInput } from '../../config/keymap.js'
import { useGh } from '../../hooks/useGh.js'
import { useListController } from '../../hooks/useListController.js'
import { useMutation } from '../../hooks/useMutation.js'
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../../executor.js'
import { sanitize } from '../../utils.js'
import { fitCell, paneWidth, planRow } from '../../ui/row-layout.js'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { useKeyScope } from '../../keyscope.js'
import { useTheme } from '../../theme.js'
import { NotificationListSkeleton } from '../../components/Skeleton.jsx'
import { QueryBoundary } from '../../components/QueryBoundary.jsx'
import { MutationStatus } from '../../components/MutationStatus.jsx'
import { ListRow } from '../../ui/ListRow.jsx'
import { firstActionKey, matchesAction } from '../../config/actions.js'

const REPO_COLS = 12
const REASON_COLS = 16
const AGE_COLS = 13

export function NotificationList({ repo, listHeight = 10, innerWidth, onNavigateTo, onPaneState }) {
  useKeyScope('pane')
  const { t } = useTheme()

  function notifTypeIcon(type) {
    switch (type) {
      case 'PullRequest': return { icon: '⎇' }
      case 'Issue': return { icon: '○' }
      case 'Release': return { icon: '▸' }
      case 'Discussion': return { icon: '💬' }
      default: return { icon: '●' }
    }
  }

  const { stdout } = useStdout()
  const rowWidth = paneWidth(innerWidth, stdout)
  const visibleHeight = listHeight || Math.max(5, (stdout?.rows || 24) - 8)

  const query = useGh(listNotifications, [])
  const { data: notifications, loading, error, refetch, isStale } = query
  const [dialog, setDialog] = useState(null)

  const items = notifications || []
  const list = useListController({ items, height: visibleHeight, getId: n => n.id })

  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length, isStale })
  }, [loading, error, items.length, isStale]) // eslint-disable-line react-hooks/exhaustive-deps

  useKeyScope('dialog', !!dialog)
  useEffect(() => {
    if (onPaneState) onPaneState({ dialogHint: dialog || null })
    return () => { if (onPaneState) onPaneState({ dialogHint: null }) }
  }, [dialog]) // eslint-disable-line react-hooks/exhaustive-deps

  // Pending guard, status line and refetch-after-write live in useMutation (#453).
  const markRead = useMutation(id => markNotificationRead(id), { label: 'Marking as read', success: 'Marked as read', invalidates: [() => refetch()] })
  const markAll = useMutation(() => markAllNotificationsRead(), { label: 'Marking all as read', success: 'All marked as read', invalidates: [() => refetch()] })
  // One status line: whichever write spoke last.
  const status = markAll.status || markRead.status

  useKeymapInput((input, key) => {
    if (status?.persist) { markRead.dismiss(); markAll.dismiss() }
    if (dialog) return
    if (list.handleKey(input, key)) return
    if (matchesAction('list.refresh', input, key)) { refetch(); return }
    if (matchesAction('list.search', input, key)) { setDialog('fuzzy'); return }

    if (loading || items.length === 0) return

    if (matchesAction('notification.open', input, key)) {
      const notif = list.selected
      if (notif && onNavigateTo) {
        // Mark as read and navigate
        markNotificationRead(notif.id).catch(err => logSwallowed('notifications.mark-read', err))
        onNavigateTo(notif)
      }
      return
    }

    if (matchesAction('notification.mark-read', input, key)) {
      if (list.selected) markRead.mutate(list.selected.id)
      return
    }

    if (matchesAction('notification.mark-all', input, key)) {
      setDialog('markAll')
      return
    }
  })

  if (dialog === 'fuzzy') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <FuzzySearch
          items={items.map(n => ({ ...n, title: n.subject?.title, name: n.repository?.name }))}
          searchFields={['title', 'name']}
          onSubmit={(item) => {
            const idx = items.findIndex(n => n.id === item.id)
            if (idx !== -1) list.moveTo(idx)
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  if (dialog === 'markAll') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <ConfirmDialog
          message="Mark all notifications as read?"
          destructive={false}
          onConfirm={async () => {
            setDialog(null)
            markAll.mutate()
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  const { titleWidth, show } = planRow(rowWidth, { fixed: 2 + 1 + 3 + REPO_COLS + 1, optional: [{ key: 'reason', width: REASON_COLS + 1 }, { key: 'age', width: AGE_COLS + 1 }] })
  const truncated = notifications?.truncated || notifications?.partialError
  const footer = truncated && (
    <Box paddingX={1}>
      <Text color={t.ci.pending}>
        {notifications.partialError
          ? `Showing ${items.length}; a later page failed (${sanitize(notifications.partialError).slice(0, 60)}) [${firstActionKey('list.refresh', 'r')}] retry`
          : `Showing the newest ${items.length}; older notifications are not loaded`}
      </Text>
    </Box>
  )

  return (
    <Box flexDirection="column" flexGrow={1}>
      <MutationStatus status={status} />
      <Box flexDirection="column" flexGrow={1}>
        <QueryBoundary
          query={query}
          skeleton={<NotificationListSkeleton count={visibleHeight} />}
          empty="No notifications."
          footer={footer}
        >
          {() => list.visibleItems.map((notif, i) => {
            const isSelected = list.scrollOffset + i === list.cursor
            const typeInfo = notifTypeIcon(notif.subject?.type)
            // One line, never wider than the pane (#428): fixed cells keep their width, the
            // title takes the rest, and the reason (then the age) is dropped when it is tight.
            return (
              <ListRow key={notif.id} selected={isSelected}>
                <Box width={3} flexShrink={0}><Text color={isSelected ? t.ui.selected : t.ui.muted}>{typeInfo.icon}</Text></Box>
                <Text color={isSelected ? t.ui.selected : t.ui.muted}>{fitCell(sanitize(notif.repository?.name || ''), REPO_COLS)} </Text>
                <Text
                  color={isSelected ? t.ui.selected : (notif.unread ? undefined : t.ui.muted)}
                  bold={notif.unread || isSelected}
                >
                  {fitCell(sanitize(notif.subject?.title || ''), titleWidth)}
                </Text>
                {show.reason && <Text color={isSelected ? t.ui.selected : t.ui.muted}> {fitCell(sanitize(notif.reason || ''), REASON_COLS)}</Text>}
                {show.age && <Text color={isSelected ? t.ui.selected : t.ui.muted}> {fitCell(format(notif.updatedAt), AGE_COLS)}</Text>}
              </ListRow>
            )
          })}
        </QueryBoundary>
      </Box>
    </Box>
  )
}
