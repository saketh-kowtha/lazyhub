/**
 * src/features/notifications/index.jsx — Notifications pane
 */

import React, { useState, useCallback, useEffect, useContext, useRef } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import { listNotifications, markNotificationRead, markAllNotificationsRead } from '../../executor.js'
import { sanitize } from '../../utils.js'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { AppContext } from '../../context.js'
import { useTheme } from '../../theme.js'
import { NotificationListSkeleton } from '../../components/Skeleton.jsx'

export function NotificationList({ repo, listHeight = 10, onNavigateTo, onPaneState }) {
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
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

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

  useInput((input, key) => {
    if (statusMsg?.persist) { setStatusMsg(null) }
    if (dialog) return
    if (input === 'j' || key.downArrow) { moveCursor(1); return }
    if (input === 'k' || key.upArrow)  { moveCursor(-1); return }
    if (input === 'r') { refetch(); return }
    if (input === '/') { setDialog('fuzzy'); return }

    // gg → top
    if (input === 'g') {
      if (lastKeyRef.current === 'g') {
        clearTimeout(lastKeyTimer.current)
        lastKeyRef.current = null
        setCursor(0); setScrollOffset(0)
        return
      }
      lastKeyRef.current = 'g'
      lastKeyTimer.current = setTimeout(() => { lastKeyRef.current = null }, 400)
      return
    }
    lastKeyRef.current = null

    // G → bottom
    if (input === 'G') {
      if (items.length > 0) {
        const last = items.length - 1
        setCursor(last); setScrollOffset(Math.max(0, last - visibleHeight + 1))
      }
      return
    }

    if (loading || items.length === 0) return

    if (key.return) {
      const notif = items[cursor]
      if (notif && onNavigateTo) {
        // Mark as read and navigate
        markNotificationRead(notif.id).catch(() => {})
        onNavigateTo(notif)
      }
      return
    }

    if (input === 'm') {
      const notif = items[cursor]
      if (notif) {
        markNotificationRead(notif.id)
          .then(() => { showStatus('Marked as read'); refetch() })
          .catch(err => showStatus(`Failed: ${err.message}`, true))
      }
      return
    }

    if (input === 'M') {
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
