/**
 * Issue detail controller: query, scrolling, reply and dialog lifecycle.
 */

import React, { useState, useContext, useMemo, useCallback, useRef, useEffect } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useActionResolver, useKeymapInput } from '../../config/keymap.js'
import { firstActionKey } from '../../config/actions.js'
import { useGh } from '../../hooks/useGh.js'
import { getIssue, addIssueComment } from '../../executor.js'
import { usePendingWrite } from '../../hooks/usePendingWrite.js'
import { AppContext } from '../../context.js'
import { useKeyScope } from '../../keyscope.js'
import { useTheme } from '../../theme.js'
import { sanitize } from '../../utils.js'
import { IssueDetailSkeleton } from '../../components/Skeleton.jsx'
import { IssueLabelDialog, IssueAssigneeDialog } from './dialogs.jsx'
import { buildIssueContentRows } from './detail-content.jsx'
import { IssueDetailView } from './detail-view.jsx'

export function IssueDetail({ issueNumber, repo, onBack }) {
  useKeyScope('view')
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const termRows = stdout?.rows || 24
  const termCols = stdout?.columns || 80

  const { data: issue, loading, error, refetch } = useGh(getIssue, [repo, issueNumber])
  const [scrollY, setScrollY] = useState(0)
  const [replyMode, setReplyMode] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [statusMsg, setStatusMsg] = useState(null)
  const [statusIsError, setStatusIsError] = useState(false)
  const [dialog, setDialog] = useState(null)
  // Typing a reply must never trigger actions.
  useKeyScope('input', replyMode)
  const resolveAction = useActionResolver(['global', 'issue-detail'])

  // Notify App when dialog opens/closes
  React.useEffect(() => {
    notifyDialog(!!dialog)
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

  const contentRows = useMemo(
    () => buildIssueContentRows(issue, termCols, t),
    [issue, termCols, t],
  )

  const visibleHeight = Math.max(3, termRows - 10)
  const maxScroll = Math.max(0, contentRows.length - visibleHeight)
  const visibleRows = contentRows.slice(scrollY, scrollY + visibleHeight)

  // One status timer: a new message cancels the previous timer, so a stale timeout
  // can never clear a later (or sticky pending) message.
  const statusTimer = useRef(null)
  useEffect(() => () => { clearTimeout(statusTimer.current) }, [])
  const setStatus = useCallback((msg, ms = 0, isError = false) => {
    clearTimeout(statusTimer.current)
    setStatusIsError(isError)
    setStatusMsg(msg)
    if (ms) statusTimer.current = setTimeout(() => { setStatusMsg(null); setStatusIsError(false) }, ms)
  }, [])

  const reportDialogError = (what, err) => {
    setStatus(`✗ Updating ${what} failed: ${sanitize(err.message)}`, 5000, true)
  }

  // Pending messages are sticky: no timer until the write settles.
  const { run: runWrite } = usePendingWrite((msg) => setStatus(msg))

  const doReply = useCallback(() => {
    const text = replyText.trim()
    if (!text) {
      setStatus('Reply cannot be empty', 3000)
      return
    }
    let ran = false
    // The typed text is cleared only once the write really starts; an ignored
    // second submit keeps what the user typed.
    runWrite('Sending reply', () => {
      ran = true
      setReplyMode(false)
      setReplyText('')
      return addIssueComment(repo, issueNumber, text)
    })
      .then(() => { if (!ran) return; setStatus('Reply sent', 3000); refetch() })
      .catch(err => setStatus(`Failed: ${err.message}`, 5000))
  }, [repo, issueNumber, replyText, refetch, runWrite, setStatus])

  useKeymapInput((input, key) => {
    if (dialog) return

    if (replyMode) {
      if (key.escape) { setReplyMode(false); setReplyText(''); return }
      return
    }

    const id = resolveAction(input, key)
    if (id === 'issue.reply') { setReplyMode(true); return }
    if (id === 'list.refresh') { refetch(); return }
    if (id === 'issue.labels') { setDialog('labels'); return }
    if (id === 'issue.assignees') { setDialog('assignees'); return }
    if (id === 'issue.open-browser' && issue?.url) {
      import('execa').then(({ execa }) => {
        const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
        execa(cmd, [issue.url]).catch(() => {})
      })
      return
    }
    if (id === 'app.back') { onBack(); return }

    if (id === 'cursor.top') { setScrollY(0); return }
    if (id === 'cursor.bottom') { setScrollY(maxScroll); return }
    if (id === 'cursor.down') { setScrollY(s => Math.min(maxScroll, s + 1)); return }
    if (id === 'cursor.up')   { setScrollY(s => Math.max(0, s - 1)); return }
  })

  if (loading) return <IssueDetailSkeleton />
  if (error) return <Box paddingX={1}><Text color={t.ci.fail}>⚠ Failed — {firstActionKey('list.refresh', 'r')} to retry</Text></Box>
  if (!issue) return null

  // ── Dialogs ────────────────────────────────────────────────────────────────

  if (dialog === 'labels') {
    return <IssueLabelDialog repo={repo} issue={issue} loadingPadding={1} onError={err => reportDialogError('labels', err)} onClose={() => { setDialog(null); refetch() }} />
  }

  if (dialog === 'assignees') {
    return <IssueAssigneeDialog repo={repo} issue={issue} loadingPadding={1} onError={err => reportDialogError('assignees', err)} onClose={() => { setDialog(null); refetch() }} />
  }

  // ── Detail view ────────────────────────────────────────────────────────────

  return (
    <IssueDetailView
      issue={issue}
      t={t}
      visibleRows={visibleRows}
      maxScroll={maxScroll}
      scrollY={scrollY}
      visibleHeight={visibleHeight}
      contentRows={contentRows}
      replyMode={replyMode}
      replyText={replyText}
      setReplyText={setReplyText}
      doReply={doReply}
      statusMsg={statusMsg}
      statusIsError={statusIsError}
    />
  )
}
