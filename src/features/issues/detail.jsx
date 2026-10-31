/**
 * Issue detail controller: query, scrolling, reply and dialog lifecycle.
 */

import React, { useState, useContext, useMemo, useCallback } from 'react'
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

  const reportDialogError = (what, err) => {
    setStatusIsError(true)
    setStatusMsg(`✗ Updating ${what} failed: ${sanitize(err.message)}`)
    setTimeout(() => { setStatusMsg(null); setStatusIsError(false) }, 5000)
  }

  const { run: runWrite } = usePendingWrite(setStatusMsg)

  const doReply = useCallback(() => {
    const text = replyText.trim()
    if (!text) {
      setStatusMsg('Reply cannot be empty')
      setTimeout(() => setStatusMsg(null), 3000)
      return
    }
    setReplyMode(false)
    setReplyText('')
    let ran = false
    runWrite('Sending reply', () => { ran = true; return addIssueComment(repo, issueNumber, text) })
      .then(() => { if (!ran) return; setStatusMsg('Reply sent'); refetch(); setTimeout(() => setStatusMsg(null), 3000) })
      .catch(err => { setStatusMsg(`Failed: ${err.message}`); setTimeout(() => setStatusMsg(null), 5000) })
  }, [repo, issueNumber, replyText, refetch, runWrite])

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
