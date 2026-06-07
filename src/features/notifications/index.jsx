/**
 * src/features/notifications/index.jsx — Notifications pane
 */

import React, { useState, useCallback, useEffect, useContext, useRef } from 'react'
import { Box, Text, useStdout } from 'ink'
import { format } from 'timeago.js'
import { useKeymapInput } from '../../config/keymap.js'
import { useGh } from '../../hooks/useGh.js'
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../../executor.js'
import { sanitize } from '../../utils.js'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { AppContext } from '../../context.js'
import { useKeyScope } from '../../keyscope.js'
import { useTheme } from '../../theme.js'
import { NotificationListSkeleton } from '../../components/Skeleton.jsx'
import { firstActionKey, matchesAction } from '../../config/actions.js'

export function NotificationList({ repo, listHeight = 10, onNavigateTo, onPaneState }) {
  useKeyScope('pane')
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)

  function notifTypeIcon(type) {
    switch (type) {
      case 'PullRequest': return { icon: '⎇', color: t.pr.open }
      case 'Issue': return { icon: '○', color: t.issue.open }
      case 'Release': return { icon: '▸', color: t.ui.selected }
      case 'Discussion': return { icon: '💬', color: t.ui.muted }
      default: return { icon: '●', color: t.ui.muted }
    }
  }

  const { stdout } = useStdout()
  const visibleHeight = listHeight || Math.max(5, (stdout?.rows || 24) - 8)

  const { data: notifications, loading, error, refetch } = useGh(listNotifications, [])
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [statusMsg, setStatusMsg] = useState(null)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const items = notifications || []

  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length })
  }, [loading, error, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    notifyDialog(!!dialog)
    if (onPaneState) onPaneState({ dialogHint: dialog || null })
    return () => { notifyDialog(false); if (onPaneState) onPaneState({ dialogHint: null }) }
  }, [dialog, notifyDialog]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { clearTimeout(lastKeyTimer.current) }, [])

  const showStatus = (msg, isError = false) => {
    setStatusMsg({ msg, isError, persist: isError })
    if (!isError) setTimeout(() => setStatusMsg(null), 3000)
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
        markNotificationRead(notif.id).catch(() => {})
        onNavigateTo(notif)
      }
      return
    }

    if (matchesAction('notification.mark-read', input, key)) {
      const notif = items[cursor]
      if (notif) {
        markNotificationRead(notif.id)
          .then(() => { showStatus('Marked as read'); refetch() })
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
              await markAllNotificationsRead()
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
          return (
            <Box key={notif.id} paddingX={1} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
              <Text color={typeInfo.color}>{typeInfo.icon} </Text>
              <Text color={t.ui.dim}>{notif.repository?.name} </Text>
              <Text
                color={notif.unread ? (isSelected ? t.ui.selected : undefined) : t.ui.muted}
                wrap="truncate"
                flexGrow={1}
                bold={notif.unread}
              >
                {sanitize(notif.subject?.title || '')}
              </Text>
              <Text color={t.ui.dim}> {notif.reason}</Text>
              <Text color={t.ui.dim}> {format(notif.updatedAt)}</Text>
            </Box>
          )
        })}
        {!loading && items.length === 0 && (
          <Box paddingX={2} paddingY={1}>
            <Text color={t.ui.muted}>No notifications. [r] refresh</Text>
          </Box>
        )}
      </Box>
    </Box>
  )
}
