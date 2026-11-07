/**
 * src/features/notifications/index.jsx — Notifications pane
 */

import { logSwallowed } from '../../contain.js'
import React, { useState, useCallback, useEffect, useContext, useRef } from 'react'
import { Box, Text, useStdout } from 'ink'
import { format } from 'timeago.js'
import { useKeymapInput } from '../../config/keymap.js'
import { useGh } from '../../hooks/useGh.js'
import { usePendingWrite } from '../../hooks/usePendingWrite.js'
import { classifyGhFailure, listNotifications, markNotificationRead, markAllNotificationsRead } from '../../executor.js'
import { sanitize } from '../../utils.js'
import { fitCell, paneWidth, planRow } from '../../ui/row-layout.js'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { AppContext } from '../../context.js'
import { useKeyScope } from '../../keyscope.js'
import { useTheme } from '../../theme.js'
import { NotificationListSkeleton } from '../../components/Skeleton.jsx'
import { FailureNotice } from '../../components/FailureNotice.jsx'
import { firstActionKey, matchesAction } from '../../config/actions.js'

const REPO_COLS = 12
const REASON_COLS = 16
const AGE_COLS = 13

export function NotificationList({ repo, listHeight = 10, innerWidth, onNavigateTo, onPaneState }) {
  useKeyScope('pane')
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)

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

  const { data: notifications, loading, error, refetch, isStale } = useGh(listNotifications, [])
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [statusMsg, setStatusMsg] = useState(null)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const items = notifications || []

  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length, isStale })
  }, [loading, error, items.length, isStale]) // eslint-disable-line react-hooks/exhaustive-deps

  // A refetch can shrink the list (cancelled run, read notification); keep the cursor on a real row.
  useEffect(() => {
    if (items.length > 0 && cursor > items.length - 1) {
      const last = items.length - 1
      setCursor(last)
      setScrollOffset(Math.max(0, last - visibleHeight + 1))
    }
  }, [items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    notifyDialog(!!dialog)
    if (onPaneState) onPaneState({ dialogHint: dialog || null })
    return () => { notifyDialog(false); if (onPaneState) onPaneState({ dialogHint: null }) }
  }, [dialog, notifyDialog]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { clearTimeout(lastKeyTimer.current) }, [])

  const statusTimer = useRef(null)
  useEffect(() => () => { clearTimeout(statusTimer.current) }, [])
  const showStatus = (msg, isError = false, sticky = false) => {
    clearTimeout(statusTimer.current)
    setStatusMsg({ msg, isError, persist: isError })
    if (!isError && !sticky) statusTimer.current = setTimeout(() => setStatusMsg(null), 3000)
  }
  // Pending/double-submit guard for mark-read and mark-all (#453).
  const { run: pendingRun } = usePendingWrite((msg) => showStatus(msg, false, true))
  // Resolves true only when fn ran (false when ignored as a double submit).
  const runWrite = async (label, fn) => {
    let ran = false
    await pendingRun(label, async () => { ran = true; return fn() })
    return ran
  }

  const moveCursor = useCallback((delta) => {
    setCursor(prev => {
      const next = Math.max(0, Math.min(items.length - 1, prev + delta))
      if (next < scrollOffset) setScrollOffset(next)
      if (next >= scrollOffset + visibleHeight) setScrollOffset(next - visibleHeight + 1)
      return next
    })
  }, [items.length, scrollOffset, visibleHeight])

  useKeymapInput((input, key) => {
    if (statusMsg?.persist) { setStatusMsg(null) }
    if (dialog) return
    if (matchesAction('cursor.down', input, key)) { moveCursor(1); return }
    if (matchesAction('cursor.up', input, key))  { moveCursor(-1); return }
    if (matchesAction('list.refresh', input, key)) { refetch(); return }
    if (matchesAction('list.search', input, key)) { setDialog('fuzzy'); return }

    // gg → top
    const topSequenceKey = firstActionKey('cursor.top', 'gg')[0]
    if (input === topSequenceKey) {
      if (lastKeyRef.current === topSequenceKey) {
        clearTimeout(lastKeyTimer.current)
        lastKeyRef.current = null
        setCursor(0); setScrollOffset(0)
        return
      }
      lastKeyRef.current = topSequenceKey
      lastKeyTimer.current = setTimeout(() => { lastKeyRef.current = null }, 400)
      return
    }
    lastKeyRef.current = null

    // G → bottom
    if (matchesAction('cursor.bottom', input, key)) {
      if (items.length > 0) {
        const last = items.length - 1
        setCursor(last); setScrollOffset(Math.max(0, last - visibleHeight + 1))
      }
      return
    }

    if (loading || items.length === 0) return

    if (matchesAction('notification.open', input, key)) {
      const notif = items[cursor]
      if (notif && onNavigateTo) {
        // Mark as read and navigate
        markNotificationRead(notif.id).catch(err => logSwallowed('notifications.mark-read', err))
        onNavigateTo(notif)
      }
      return
    }

    if (matchesAction('notification.mark-read', input, key)) {
      const notif = items[cursor]
      if (notif) {
        runWrite('Marking as read', () => markNotificationRead(notif.id))
          .then(ran => { if (ran) { showStatus('Marked as read'); refetch() } })
          .catch(err => showStatus(`Failed: ${err.message}`, true))
      }
      return
    }

    if (matchesAction('notification.mark-all', input, key)) {
      setDialog('markAll')
      return
    }
  })

  const visibleNotifs = items.slice(scrollOffset, scrollOffset + visibleHeight)

  if (dialog === 'fuzzy') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <FuzzySearch
          items={items.map(n => ({ ...n, title: n.subject?.title, name: n.repository?.name }))}
          searchFields={['title', 'name']}
          onSubmit={(item) => {
            const idx = items.findIndex(n => n.id === item.id)
            if (idx !== -1) { setCursor(idx); setScrollOffset(Math.max(0, idx - 2)) }
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
            try {
              if (!await runWrite('Marking all as read', () => markAllNotificationsRead())) return
              showStatus('All marked as read')
              refetch()
            } catch (err) {
              showStatus(`Failed: ${err.message}`, true)
            }
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      {statusMsg && (
        <Box paddingX={1}>
          <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}>{statusMsg.msg}{statusMsg.persist ? ' [any key]' : ''}</Text>
        </Box>
      )}
      <Box flexDirection="column" flexGrow={1}>
        {loading && items.length === 0 && (
          <NotificationListSkeleton count={visibleHeight} />
        )}
        {visibleNotifs.map((notif, i) => {
          const idx = scrollOffset + i
          const isSelected = idx === cursor
          const typeInfo = notifTypeIcon(notif.subject?.type)
          // One line, never wider than the pane (#428): fixed cells keep their width, the
          // title takes the rest, and the reason (then the age) is dropped when it is tight.
          const { titleWidth, show } = planRow(rowWidth, { fixed: 2 + 1 + 3 + REPO_COLS + 1, optional: [{ key: 'reason', width: REASON_COLS + 1 }, { key: 'age', width: AGE_COLS + 1 }] })
          return (
            <Box key={notif.id} paddingX={1} height={1} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
              <Text color={isSelected ? t.ui.selected : undefined}>{isSelected ? '▎' : ' '}</Text>
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
            </Box>
          )
        })}
        {!error && items.length > 0 && (notifications?.truncated || notifications?.partialError) && (
          <Box paddingX={1}>
            <Text color={t.ci.pending}>
              {notifications.partialError
                ? `Showing ${items.length}; a later page failed (${sanitize(notifications.partialError).slice(0, 60)}) [${firstActionKey('list.refresh', 'r')}] retry`
                : `Showing the newest ${items.length}; older notifications are not loaded`}
            </Text>
          </Box>
        )}
        {error && (
          <Box paddingX={2} paddingY={1} flexDirection="column">
            <FailureNotice failure={classifyGhFailure(error)} />
            <Text color={t.ui.dim}>[{firstActionKey('list.refresh', 'r')}] retry</Text>
          </Box>
        )}
        {!loading && !error && items.length === 0 && (
          <Box paddingX={2} paddingY={1}>
            <Text color={t.ui.muted}>No notifications. [{firstActionKey('list.refresh', 'r')}] refresh</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
