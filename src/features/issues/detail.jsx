/**
 * Issue detail controller: header, cursor-paged timeline, scrolling, replies and dialogs (#565).
 *
 * Mirrors the PR conversation view (#507): the first page comes through the query cache, later
 * pages are fetched by cursor and appended (an earlier page is never fetched again), and a
 * background revalidation of page 1 is folded in by content signature. Items that arrive after
 * everything was loaded are announced with a "N new comments" marker; they are never inserted
 * under the reader.
 */

import React, { useState, useContext, useMemo, useCallback, useRef, useEffect } from 'react'
import { openUrl, editTextInEditor } from '../../services/platform.js'
import { Box, Text, useStdout } from 'ink'
import { useActionResolver, useKeymapInput } from '../../config/keymap.js'
import { firstActionKey } from '../../config/actions.js'
import { useGh } from '../../hooks/useGh.js'
import { getIssueHeader, listIssueTimelinePage, addIssueComment, editIssueComment, deleteIssueComment } from '../../executor.js'
import { usePendingWrite } from '../../hooks/usePendingWrite.js'
import { loadConfig } from '../../config.js'
import { AppContext } from '../../context.js'
import { useKeyScope } from '../../keyscope.js'
import { useTheme } from '../../theme.js'
import { sanitize } from '../../utils.js'
import { IssueDetailSkeleton } from '../../components/Skeleton.jsx'
import { IssueLabelDialog, IssueAssigneeDialog } from './dialogs.jsx'
import { buildTimelineRows } from './timeline-rows.jsx'
import { seedOf, appendPage, reconcileFirst, newItemCount, quoteReply } from './timeline-state.js'
import { IssueDetailView } from './detail-view.jsx'

// Start loading the next page when the cursor is within this many entries of the end.
const LOAD_MORE_MARGIN = 5
const MIN_REFRESH_SECONDS = 15
const DEFAULT_REFRESH_SECONDS = 30
const _issuesConfig = loadConfig().issues

/** Seconds between background revalidations of page 1: [features.issues].refresh_seconds, never below 15. */
export const refreshSeconds = () => Math.max(MIN_REFRESH_SECONDS, Number(_issuesConfig?.refreshSeconds) || DEFAULT_REFRESH_SECONDS)

// The quoted lines in a reply stay short; the link points at the rest.
const QUOTE_MAX_LINES = 6

export function IssueDetail({ issueNumber, repo, onBack }) {
  useKeyScope('view')
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const termRows = stdout?.rows || 24
  const termCols = stdout?.columns || 80

  const { data: issue, loading, error, refetch: refetchHeader } = useGh(getIssueHeader, [repo, issueNumber])
  const { data: firstPage, loading: pageLoading, error: pageError, refetch: refetchFirst } = useGh(listIssueTimelinePage, [repo, issueNumber])

  // Every loaded page lives in `loaded`; a write patches it in place and only an explicit refresh starts over.
  const [loaded, setLoaded] = useState(() => (firstPage ? seedOf(firstPage) : null))
  const bridge = useMemo(() => (firstPage ? seedOf(firstPage) : null), [firstPage])
  const data = loaded ?? bridge
  const dataRef = useRef(data)
  dataRef.current = data
  const loadedRef = useRef(loaded)
  loadedRef.current = loaded
  const viewer = firstPage?.viewer || ''
  const refreshing = useRef(false)
  const seenFirst = useRef(firstPage ? JSON.stringify(firstPage) : null)
  useEffect(() => {
    if (!firstPage) return
    if (refreshing.current) {
      // An explicit refresh starts over from the fresh first page, not from the cached one.
      if (pageLoading) return
      refreshing.current = false
      seenFirst.current = JSON.stringify(firstPage)
      setLoaded(seedOf(firstPage))
      return
    }
    if (!loadedRef.current) { setLoaded(seedOf(firstPage)); seenFirst.current = JSON.stringify(firstPage); return }
    // A newer first page (background revalidation) is compared by content: an unchanged page changes nothing.
    const sig = JSON.stringify(firstPage)
    if (seenFirst.current === sig) return
    seenFirst.current = sig
    setLoaded(cur => (cur ? reconcileFirst(cur, firstPage) : cur))
  }, [firstPage, pageLoading])

  const [busy, setBusy] = useState(0)
  const [moreFailed, setMoreFailed] = useState(false)
  const loadingPage = useRef(false)
  const generation = useRef(0)

  const [cursor, setCursor] = useState(0)
  const [scrollY, setScrollY] = useState(0)
  // compose: null | { type: 'reply' | 'edit', comment? }; confirmDelete: null | comment
  const [compose, setCompose] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [statusMsg, setStatusMsg] = useState(null)
  const [statusIsError, setStatusIsError] = useState(false)
  const [dialog, setDialog] = useState(null)
  // Typing a reply must never trigger actions.
  useKeyScope('input', !!compose)
  const resolveAction = useActionResolver(['global', 'issue-detail'])
  const resolveConfirm = useActionResolver(['dialog'])

  // Notify App when dialog opens/closes
  React.useEffect(() => {
    notifyDialog(!!dialog)
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

  const items = data?.items
  const built = useMemo(
    () => buildTimelineRows({ issue, items: items || [], width: termCols - 4, t, repo }),
    [issue, items, termCols, t, repo],
  )
  const rows = built.rows
  const lastEntry = (items?.length || 0)
  const endOf = (entry) => (entry >= lastEntry ? rows.length : built.starts[entry + 1]) - 1

  const visibleHeight = Math.max(3, termRows - 10)
  const maxScroll = Math.max(0, rows.length - visibleHeight)
  const visibleRows = rows.slice(scrollY, scrollY + visibleHeight)
  const selected = cursor === 0 ? null : items?.[cursor - 1]

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

  // ── Paging ────────────────────────────────────────────────────────────────

  // Load the page after the last one we hold. Also the path for the "new comments" marker: after the
  // final page, GitHub answers the same cursor with whatever arrived since.
  const loadNext = useCallback(async ({ quiet = false } = {}) => {
    if (loadingPage.current) return
    const d = dataRef.current
    if (!d) return
    loadingPage.current = true
    setBusy(n => n + 1)
    const gen = generation.current
    try {
      const page = await listIssueTimelinePage(repo, issueNumber, { after: d.page.endCursor })
      if (gen !== generation.current) return
      if (!page || !Array.isArray(page.items) || !page.page) throw new Error('unexpected timeline response')
      setLoaded(cur => {
        const base = cur ?? dataRef.current
        if (!base) return cur
        const next = appendPage(base, page)
        // An empty answer after the last page means the extra items are gone: do not keep a stale marker.
        return page.items.length === 0 ? { ...next, liveTotal: next.items.length } : next
      })
      setMoreFailed(false)
    } catch (err) {
      setMoreFailed(true)
      // A catch-up after our own write must not replace "Reply sent"; the counts line shows the failure.
      if (!quiet) setStatus(`Failed to load more: ${sanitize(err.message)}`, 4000, true)
    } finally {
      loadingPage.current = false
      setBusy(n => n - 1)
    }
  }, [repo, issueNumber, setStatus])

  const pending = data ? newItemCount(data) : 0
  const hasNext = !!data?.page.hasNextPage
  const wantsMore = hasNext && !moreFailed && busy === 0
  useEffect(() => {
    if (!data || !wantsMore) return
    const short = rows.length < visibleHeight
    if (short || cursor >= lastEntry - LOAD_MORE_MARGIN) loadNext()
  }, [data, wantsMore, cursor, lastEntry, rows.length, visibleHeight, loadNext])

  const refresh = useCallback(() => {
    generation.current += 1
    refreshing.current = true
    setMoreFailed(false)
    setLoaded(null)
    setCursor(0)
    setScrollY(0)
    refetchHeader()
    refetchFirst()
  }, [refetchHeader, refetchFirst])

  // ── Live updates ──────────────────────────────────────────────────────────

  // Revalidate page 1 (and the header) on a bounded interval while this view is the one on screen.
  // Paused while a dialog, a compose box, a delete confirm or a write is open, and while a load runs.
  const pausedRef = useRef(false)
  pausedRef.current = !!dialog || !!compose || !!confirmDelete || busy > 0 || pageLoading
  const everyMs = refreshSeconds() * 1000
  useEffect(() => {
    const id = setInterval(() => {
      if (pausedRef.current || refreshing.current) return
      refetchHeader()
      refetchFirst()
    }, everyMs)
    return () => clearInterval(id)
  }, [everyMs, refetchHeader, refetchFirst])

  // ── Writes ────────────────────────────────────────────────────────────────

  // After a write, pull what GitHub now has after the last cursor when everything is loaded.
  const catchUp = useCallback(() => {
    if (dataRef.current && !dataRef.current.page.hasNextPage) loadNext({ quiet: true })
  }, [loadNext])

  const editorOpen = useCallback((initial) => {
    const result = editTextInEditor(initial, { filename: 'comment.md' })
    return result.ok === false ? initial : result.text
  }, [])

  const submitCompose = useCallback(() => {
    const text = replyText.trim()
    if (!compose) return
    if (!text) {
      setStatus(compose.type === 'edit' ? 'Comment cannot be empty' : 'Reply cannot be empty', 3000)
      return
    }
    if (compose.type === 'edit') {
      const target = compose.comment
      let ran = false
      runWrite('Updating comment', () => {
        ran = true
        setCompose(null)
        setReplyText('')
        return editIssueComment(repo, target.id, text)
      })
        .then(() => {
          if (!ran) return
          setStatus('Comment updated', 3000)
          setLoaded(cur => cur && ({ ...cur, items: cur.items.map(i => (i.key === target.key ? { ...i, body: text, lastEditedAt: new Date().toISOString() } : i)) }))
        })
        .catch(err => setStatus(`Failed: ${sanitize(err.message)}`, 5000, true))
      return
    }
    let ran = false
    // The typed text is cleared only once the write really starts; an ignored
    // second submit keeps what the user typed.
    runWrite('Sending reply', () => {
      ran = true
      setCompose(null)
      setReplyText('')
      return addIssueComment(repo, issueNumber, text)
    })
      .then(() => { if (!ran) return; setStatus('Reply sent', 3000); refetchHeader(); catchUp() })
      .catch(err => setStatus(`Failed: ${sanitize(err.message)}`, 5000, true))
  }, [compose, replyText, repo, issueNumber, refetchHeader, runWrite, setStatus, catchUp])

  const confirmDeletion = useCallback(() => {
    const target = confirmDelete
    setConfirmDelete(null)
    if (!target) return
    let ran = false
    runWrite('Deleting comment', () => { ran = true; return deleteIssueComment(repo, target.id) })
      .then(() => {
        if (!ran) return
        setStatus('Comment deleted', 3000)
        setLoaded(cur => {
          if (!cur) return cur
          const items = cur.items.filter(i => i.key !== target.key)
          return { ...cur, items, page: { ...cur.page, total: Math.max(0, cur.page.total - 1) }, liveTotal: Math.max(items.length, cur.liveTotal - 1) }
        })
        setCursor(c => Math.max(0, Math.min(c, (dataRef.current?.items.length || 1) - 1)))
      })
      .catch(err => setStatus(`Failed: ${sanitize(err.message)}`, 5000, true))
  }, [confirmDelete, repo, runWrite, setStatus])

  // ── Keyboard ──────────────────────────────────────────────────────────────

  const startOf = (entry) => built.starts[entry] ?? 0
  const moveDown = () => {
    // A comment taller than the screen is read first, line by line; then the cursor moves on.
    if (endOf(cursor) >= scrollY + visibleHeight) { setScrollY(s => Math.min(maxScroll, s + 1)); return }
    if (cursor >= lastEntry) return
    const next = cursor + 1
    setCursor(next)
    setScrollY(s => Math.min(maxScroll, Math.max(s, Math.min(startOf(next), endOf(next) - visibleHeight + 1))))
  }
  const moveUp = () => {
    if (startOf(cursor) < scrollY) { setScrollY(s => Math.max(0, s - 1)); return }
    if (cursor <= 0) return
    const next = cursor - 1
    setCursor(next)
    setScrollY(s => Math.min(s, startOf(next)))
  }

  const owns = (c) => c && c.kind === 'comment' && viewer && c.author === viewer

  useKeymapInput((input, key) => {
    if (dialog) return

    if (confirmDelete) {
      const answer = resolveConfirm(input, key)
      if (answer === 'dialog.yes') { confirmDeletion(); return }
      // Default is No: Enter and everything else leaves the comment alone.
      if (answer === 'dialog.no' || key.return) setConfirmDelete(null)
      return
    }

    if (compose) {
      if (key.escape) { setCompose(null); setReplyText(''); return }
      if (resolveConfirm(input, key) === 'dialog.editor') { setReplyText(editorOpen(replyText)); return }
      return
    }

    const id = resolveAction(input, key)
    if (id === 'issue.reply') { setCompose({ type: 'reply' }); return }
    if (id === 'list.refresh') { refresh(); return }
    if (id === 'issue.labels') { setDialog('labels'); return }
    if (id === 'issue.assignees') { setDialog('assignees'); return }
    if (id === 'issue.open-browser' && issue?.url) {
      openUrl(selected?.kind === 'comment' && selected.url ? selected.url : issue.url)
      return
    }
    if (id === 'app.back') { onBack(); return }

    if (id === 'issue.show-new') {
      if (pending > 0) loadNext()
      else setStatus('No new comments', 2000)
      return
    }
    if (id === 'issue.quote') {
      if (selected?.kind !== 'comment') { setStatus('Select a comment to quote', 3000); return }
      const lines = String(selected.body || '').split('\n')
      const body = lines.length > QUOTE_MAX_LINES ? [...lines.slice(0, QUOTE_MAX_LINES), '…'].join('\n') : selected.body
      setCompose({ type: 'reply', quote: selected.key })
      setReplyText(quoteReply({ author: selected.author, body, url: selected.url }))
      return
    }
    if (id === 'issue.comment-edit') {
      if (!owns(selected)) { setStatus(selected?.kind === 'comment' ? 'You can only edit your own comments' : 'Select one of your comments to edit', 3000); return }
      if (!selected.viewerCanUpdate) { setStatus('GitHub does not allow you to edit this comment', 3000); return }
      setCompose({ type: 'edit', comment: selected })
      setReplyText(selected.body || '')
      return
    }
    if (id === 'issue.comment-delete') {
      if (!owns(selected)) { setStatus(selected?.kind === 'comment' ? 'You can only delete your own comments' : 'Select one of your comments to delete', 3000); return }
      if (!selected.viewerCanDelete) { setStatus('GitHub does not allow you to delete this comment', 3000); return }
      setConfirmDelete(selected)
      return
    }

    if (id === 'cursor.top') { setCursor(0); setScrollY(0); return }
    if (id === 'cursor.bottom') { setCursor(lastEntry); setScrollY(maxScroll); return }
    if (id === 'cursor.down') { moveDown(); return }
    if (id === 'cursor.up') { moveUp(); return }
  })

  if (loading && !issue) return <IssueDetailSkeleton />
  if (error && !issue) return <Box paddingX={1}><Text color={t.ci.fail}>⚠ Failed — {firstActionKey('list.refresh', 'r')} to retry</Text></Box>
  if (!issue) return null

  // ── Dialogs ────────────────────────────────────────────────────────────────

  if (dialog === 'labels') {
    return <IssueLabelDialog repo={repo} issue={issue} loadingPadding={1} onError={err => reportDialogError('labels', err)} onClose={() => { setDialog(null); refetchHeader() }} />
  }

  if (dialog === 'assignees') {
    return <IssueAssigneeDialog repo={repo} issue={issue} loadingPadding={1} onError={err => reportDialogError('assignees', err)} onClose={() => { setDialog(null); refetchHeader() }} />
  }

  // ── Detail view ────────────────────────────────────────────────────────────

  const total = Math.max(data?.liveTotal ?? 0, items?.length ?? 0)
  return (
    <IssueDetailView
      issue={issue}
      t={t}
      visibleRows={visibleRows}
      cursorEntry={compose || confirmDelete ? -1 : cursor}
      maxScroll={maxScroll}
      scrollY={scrollY}
      visibleHeight={visibleHeight}
      rowCount={rows.length}
      loadedCount={items?.length ?? 0}
      totalCount={total}
      conversationLoading={!data && pageLoading}
      conversationError={!data && pageError ? sanitize(String(pageError.message || 'failed')) : null}
      loadingMore={hasNext && !moreFailed}
      moreFailed={moreFailed}
      incomplete={!!data?.page.stalled}
      newCount={pending}
      showNewKey={firstActionKey('issue.show-new', 'n')}
      compose={compose}
      replyText={replyText}
      setReplyText={setReplyText}
      submitCompose={submitCompose}
      confirmDelete={confirmDelete}
      statusMsg={statusMsg}
      statusIsError={statusIsError}
    />
  )
}
