/**
 * src/features/prs/comments.jsx — PR comments/threads view
 * Supports: reply, edit, delete per comment
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import { Box, Text, useStdout } from 'ink'
import { spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { useActionResolver, useKeymapInput } from '../../config/keymap.js'
import { firstActionKey } from '../../config/actions.js'
import { contextFooterHints } from '../../ui/actions.js'
import { useGh } from '../../hooks/useGh.js'
import { usePendingWrite } from '../../hooks/usePendingWrite.js'
import {
  listPRTimelinePage, listPRThreadReplies, resolveThread, addPRComment,
  replyToComment, editPRComment, deletePRComment,
} from '../../executor.js'
import { useVirtualList } from '../../hooks/useVirtualList.js'
import { useKeyScope } from '../../keyscope.js'
import { FooterKeys } from '../../components/FooterKeys.jsx'
import { useTheme } from '../../theme.js'
import { TextInput, sanitize, shortAge } from '../../utils.js'


const FILTER_MODES = ['all', 'open', 'resolved', 'conversation']
// Start loading the next page when the cursor is within this many rows of the end of its block.
const LOAD_MORE_MARGIN = 5
const stripAnsi = s => (s || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
// Row identity that survives rows being inserted above it (conversation ids and review ids can collide).
const rowKey = c => (c._more ? `more-${c.threadId}` : `${c._conversation ? 'c' : 'r'}${c.id}`)
const seedOf = (fp) => ({
  comments: fp.comments || [],
  conversation: fp.conversation || [],
  threads: fp.threads || null,
  conv: fp.conversationPage || null,
  partial: Object.fromEntries((fp.partialThreads || []).map(p => [p.threadId, p])),
})

export function PRComments({ prNumber, repo, onBack, onJumpToDiff }) {
  useKeyScope('view')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const visibleHeight = Math.max(5, (stdout?.rows || 24) - 8)

  // First page of review threads + conversation comments; later pages load on demand (#507).
  const { data: firstPage, loading, error, refetch: refetchFirst } = useGh(listPRTimelinePage, [repo, prNumber])
  // Every loaded page lives in `loaded`. A write patches it in place, so a reply, edit, delete or
  // resolve never throws the loaded pages away; only an explicit refresh (r) starts over.
  const [loaded, setLoaded] = useState(null)
  const firstRef = useRef(firstPage)
  firstRef.current = firstPage
  const seeded = useMemo(() => (firstPage ? seedOf(firstPage) : null), [firstPage])
  const data = loaded ?? seeded
  const dataRef = useRef(data)
  dataRef.current = data
  const update = useCallback((fn) => setLoaded(prev => {
    const base = prev ?? (firstRef.current ? seedOf(firstRef.current) : null)
    return base ? fn(base) : prev
  }), [])
  const [busy, setBusy] = useState(0)             // in-flight page/reply loads, so the load effect re-evaluates
  const [moreFailed, setMoreFailed] = useState(false)
  const loadingPage = useRef(false)
  const loadingReplies = useRef(new Set())
  const failedReplies = useRef(new Set())
  const generation = useRef(0)                    // bumped by an explicit refresh; stale loads are dropped
  const threadsPage = data?.threads ?? null
  const convPage = data?.conv ?? null
  const refetch = useCallback(() => {
    generation.current += 1
    failedReplies.current = new Set()
    setMoreFailed(false)
    setLoaded(null)
    refetchFirst()
  }, [refetchFirst])
  const [filterMode, setFilterMode] = useState('all')
  const [statusMsg, setStatusMsg]   = useState(null)

  // action: null | { type: 'reply'|'edit'|'delete', comment }
  const [action, setAction]     = useState(null)
  const [actionText, setActionText] = useState('')
  // Typing a reply/edit must never trigger actions.
  useKeyScope('input', !!action && action.type !== 'delete')
  const resolveAction = useActionResolver(['global', 'pr-comments'])
  const resolveConfirm = useActionResolver(['dialog'])
  const footerKeys = useMemo(() => contextFooterHints('prs', 'comments'), [])

  // ── Build flat list: each comment is individually navigable ────────────────

  const flatComments = useMemo(() => {
    if (!data) return []
    const rawComments = [...data.conversation, ...data.comments]
    // Group by thread (root = no inReplyToId)
    const roots = rawComments.filter(c => Object.hasOwn(c, 'inReplyToId') ? !c.inReplyToId : true)
    const repliesByRoot = new Map()
    for (const c of rawComments) {
      if (Object.hasOwn(c, 'inReplyToId') && c.inReplyToId) {
        if (!repliesByRoot.has(c.inReplyToId)) repliesByRoot.set(c.inReplyToId, [])
        repliesByRoot.get(c.inReplyToId).push(c)
      }
    }
    const pickComment = (c, extra) => ({
      id: c.id,
      body: typeof c.body === 'string' ? c.body : '',
      path: typeof c.path === 'string' ? c.path : '',
      line: c.line ?? null,
      originalLine: c.originalLine ?? null,
      side: c.side ?? null,
      user: { login: typeof c.user?.login === 'string' ? c.user.login : '' },
      createdAt: c.createdAt ?? null,
      inReplyToId: c.inReplyToId ?? null,
      pullRequestReviewId: c.pullRequestReviewId ?? null,
      threadId: typeof c.threadId === 'string' ? c.threadId : null,
      threadResolved: !!c.threadResolved,
      _conversation: c.kind === 'conversation',
      ...extra,
    })
    const all = []
    for (const root of roots) {
      all.push(pickComment(root, { _isRoot: true }))
      const replies = repliesByRoot.get(root.id) || []
      for (const reply of replies) all.push(pickComment(reply, { _isRoot: false, _rootId: root.id }))
      // A thread with more than 50 comments: say how many are left and load them when the cursor gets there.
      const part = root.threadId ? data.partial[root.threadId] : null
      const remaining = part ? part.total - 1 - replies.length : 0
      if (part && remaining > 0) {
        all.push({
          id: `more-${root.threadId}`, _more: true, _isRoot: false, _rootId: root.id, threadId: root.threadId,
          remaining, stalled: !!part.stalled, threadResolved: !!root.threadResolved, _conversation: false,
          body: '', user: { login: '' },
        })
      }
    }
    if (filterMode === 'conversation') return all.filter(c => c._conversation)
    if (filterMode === 'resolved')  return all.filter(c => !c._conversation && c.threadResolved)
    if (filterMode === 'open')      return all.filter(c => !c._conversation && !c.threadResolved)
    return all
  }, [data, filterMode])

  const visibleCount = flatComments.length
  // The list clamps the cursor itself when the filter shrinks it.
  const { cursor, scrollOffset, visibleItems, moveCursor } =
    useVirtualList({ items: flatComments, height: visibleHeight })

  // Keep the selection on the same comment when rows are inserted above it (a page loads, a reply is
  // added), so `d`/`R`/`z` never act on a different comment than the one highlighted.
  const anchorRef = useRef(null)
  const goTo = useCallback((index) => {
    const next = Math.max(0, Math.min(visibleCount - 1, index))
    anchorRef.current = flatComments[next] ? rowKey(flatComments[next]) : null
    moveCursor(next)
  }, [flatComments, visibleCount, moveCursor])
  useEffect(() => {
    const want = anchorRef.current
    const cur = flatComments[cursor]
    if (want && (!cur || rowKey(cur) !== want)) {
      const idx = flatComments.findIndex(c => rowKey(c) === want)
      if (idx >= 0) { moveCursor(idx); return }
    }
    anchorRef.current = cur ? rowKey(cur) : null
  }, [flatComments]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Status helper ──────────────────────────────────────────────────────────
  // One timer: a newer message is never cleared by an older message's timeout. A sticky
  // message (a write in flight) stays until the next message replaces it.
  const flashTimer = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null))
  const flash = useCallback((msg, { sticky = false } = {}) => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = null
    setStatusMsg(msg)
    if (!sticky) flashTimer.current = setTimeout(() => setStatusMsg(null), 3000)
  }, [])
  useEffect(() => () => { if (flashTimer.current) clearTimeout(flashTimer.current) }, [])
  const { run: runWrite } = usePendingWrite(useCallback((msg) => flash(msg, { sticky: true }), [flash]))

  // Load the next page of threads and/or conversation comments.
  const loadPage = useCallback(async ({ threads, conversation }) => {
    if (loadingPage.current) return
    const d = dataRef.current
    loadingPage.current = true
    setBusy(n => n + 1)
    const gen = generation.current
    try {
      const page = await listPRTimelinePage(repo, prNumber, {
        threads, conversation,
        threadsAfter: threads ? d.threads?.endCursor : null,
        conversationAfter: conversation ? d.conv?.endCursor : null,
      })
      if (gen !== generation.current) return
      update(cur => ({
        comments: [...cur.comments, ...page.comments],
        conversation: [...cur.conversation, ...page.conversation],
        threads: threads ? page.threads : cur.threads,
        conv: conversation ? page.conversationPage : cur.conv,
        partial: { ...cur.partial, ...Object.fromEntries((page.partialThreads || []).map(p => [p.threadId, p])) },
      }))
    } catch (err) {
      setMoreFailed(true)
      flash(`Failed to load more: ${err.message}`)
    } finally {
      loadingPage.current = false
      setBusy(n => n - 1)
    }
  }, [repo, prNumber, update, flash])

  // Load the rest of one long thread (its "N more replies" row is under the cursor).
  const loadReplies = useCallback(async (threadId) => {
    const info = dataRef.current?.partial[threadId]
    if (!info || info.stalled || !info.endCursor) return
    if (loadingReplies.current.has(threadId) || failedReplies.current.has(threadId)) return
    loadingReplies.current.add(threadId)
    setBusy(n => n + 1)
    const gen = generation.current
    try {
      const res = await listPRThreadReplies(threadId, info.endCursor)
      if (gen !== generation.current) return
      update(cur => {
        const partial = { ...cur.partial }
        if (res.page.hasNextPage) partial[threadId] = { threadId, total: res.page.total, endCursor: res.page.endCursor, stalled: false }
        else if (res.page.stalled) partial[threadId] = { ...partial[threadId], stalled: true, endCursor: null }
        else delete partial[threadId]
        return { ...cur, comments: [...cur.comments, ...res.comments], partial }
      })
    } catch (err) {
      failedReplies.current.add(threadId)
      flash(`Failed to load replies: ${err.message}`)
    } finally {
      loadingReplies.current.delete(threadId)
      setBusy(n => n - 1)
    }
  }, [update, flash])

  // Section paging: conversation pages load near the end of the conversation block, thread pages near
  // the end of the threads. A list too short to scroll loads whatever is missing for the current filter.
  useEffect(() => {
    if (!data || moreFailed || busy > 0) return
    const wantsConv = filterMode === 'all' || filterMode === 'conversation'
    const wantsThreads = filterMode !== 'conversation'
    const short = visibleCount < visibleHeight
    let lastConv = -1
    for (let i = visibleCount - 1; i >= 0; i--) if (flatComments[i]._conversation) { lastConv = i; break }
    const needConv = !!convPage?.hasNextPage && wantsConv &&
      (short || lastConv < 0 || (cursor <= lastConv && cursor >= lastConv - LOAD_MORE_MARGIN))
    const needThreads = !!threadsPage?.hasNextPage && wantsThreads &&
      (short || cursor >= visibleCount - LOAD_MORE_MARGIN)
    if (needConv || needThreads) loadPage({ threads: needThreads, conversation: needConv })
    const cur = flatComments[cursor]
    if (cur?._more && !cur.stalled) loadReplies(cur.threadId)
  }, [data, cursor, visibleCount, visibleHeight, filterMode, busy, moreFailed, convPage, threadsPage, flatComments, loadPage, loadReplies])

  // ── Open $EDITOR for multiline edit ───────────────────────────────────────
  const openEditor = useCallback((initial) => {
    const raw = process.env.EDITOR || process.env.VISUAL || 'vi'
    if (!raw || /[\0\n\r]/.test(raw)) return initial
    const [editorBin, ...editorArgs] = raw.split(/\s+/).filter(Boolean)
    let tmpDir
    try {
      tmpDir = mkdtempSync(join(tmpdir(), 'lazyhub-'))
      const tmp = join(tmpDir, 'comment.md')
      writeFileSync(tmp, initial || '', { mode: 0o600 })
      process.stdout.write('\x1b[?1049l')
      const result = spawnSync(editorBin, [...editorArgs, tmp], { stdio: 'inherit' })
      process.stdout.write('\x1b[?1049h\x1b[H')
      if (result.status !== 0) return initial
      const content = readFileSync(tmp, 'utf8')
      return content
    } catch { return initial }
    finally { try { if (tmpDir) rmSync(tmpDir, { recursive: true, force: true }) } catch {} }
  }, [])

  // ── Submit action ──────────────────────────────────────────────────────────
  // Each success patches the loaded list in place instead of refetching (which would drop loaded pages).
  const submitAction = useCallback(() => {
    if (!action) return
    const { type, comment } = action
    const body = actionText.trim()

    const done = () => { setAction(null); setActionText('') }

    if (type === 'reply') {
      if (!body) { done(); return }
      if (comment._conversation) {
        runWrite('Sending comment', () => addPRComment(repo, prNumber, body)
          .then(() => {
            flash('Comment sent'); done()
            update(d => ({ ...d, conversation: [...d.conversation, {
              id: `local-${Date.now()}`, kind: 'conversation', body, path: '', line: null, user: { login: 'you' },
              createdAt: new Date().toISOString(), inReplyToId: null, threadId: null, threadResolved: false,
            }] }))
          })
          .catch(err => flash(`Failed: ${err.message}`)))
        return
      }
      const rootId = comment._isRoot ? comment.id : comment._rootId
      if (!rootId) { flash('Cannot determine thread root'); done(); return }
      runWrite('Sending reply', () => replyToComment(repo, prNumber, rootId, body)
        .then((res) => {
          flash('Reply sent'); done()
          update(d => ({ ...d, comments: [...d.comments, {
            id: res?.id ?? `local-${Date.now()}`, body: res?.body ?? body, path: comment.path, line: comment.line, side: 'RIGHT',
            user: { login: res?.user?.login ?? 'you' }, createdAt: res?.created_at ?? new Date().toISOString(),
            inReplyToId: rootId, threadId: comment.threadId, threadResolved: comment.threadResolved,
          }] }))
        })
        .catch(err => flash(`Failed: ${err.message}`)))
    } else if (type === 'edit') {
      if (!body) { done(); return }
      runWrite('Updating comment', () => editPRComment(repo, comment.id, body)
        .then(() => {
          flash('Comment updated'); done()
          update(d => ({ ...d, comments: d.comments.map(c => (c.id === comment.id ? { ...c, body } : c)) }))
        })
        .catch(err => flash(`Failed: ${err.message}`)))
    } else if (type === 'delete') {
      runWrite('Deleting comment', () => deletePRComment(repo, comment.id)
        .then(() => {
          flash('Comment deleted'); done()
          // Deleting a thread's first comment removes the whole thread from GitHub's view.
          update(d => ({ ...d, comments: d.comments.filter(c => c.id !== comment.id && c.inReplyToId !== comment.id) }))
        })
        .catch(err => flash(`Failed: ${err.message}`)))
    }
  }, [action, actionText, repo, prNumber, flash, update, runWrite])

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useKeymapInput((input, key) => {
    // ── Action mode ──
    if (action) {
      if (action.type === 'delete') {
        const confirm = resolveConfirm(input, key)
        if (confirm === 'dialog.yes') { submitAction(); return }
        if (confirm === 'dialog.no') { setAction(null); return }
        return
      }
      // reply / edit: exit keys handled here, text by TextInput
      if (key.escape) { setAction(null); setActionText(''); return }
      // Ctrl+E opens editor; bare 'e' is a normal character typed in TextInput
      if (resolveConfirm(input, key) === 'dialog.editor') {
        const result = openEditor(actionText)
        setActionText(result)
        return
      }
      return
    }

    const id = resolveAction(input, key)
    if (id === 'app.back') { onBack(); return }
    if (id === 'list.refresh') { refetch(); return }

    if (id === 'cursor.down') { goTo(cursor + 1); return }
    if (id === 'cursor.up') { goTo(cursor - 1); return }
    if (id === 'cursor.top') { goTo(0); return }
    if (id === 'cursor.bottom') { goTo(visibleCount - 1); return }

    // A "N more replies" row is a loader, not a comment: no action applies to it.
    const comment = flatComments[cursor]?._more ? undefined : flatComments[cursor]

    const conversationOnly = comment?._conversation
    if (conversationOnly && ['comment.edit', 'comment.delete', 'comment.resolve', 'comment.jump'].includes(id)) {
      flash('Conversation comments can only be replied to here')
      return
    }

    if (id === 'comment.reply' && comment) {
      setAction({ type: 'reply', comment })
      // A conversation row has no thread to reply into: it posts a new PR comment, addressed to the author.
      setActionText(comment._conversation && comment.user?.login ? `@${comment.user.login} ` : '')
      return
    }
    if (id === 'comment.edit' && comment) {
      setAction({ type: 'edit', comment })
      setActionText(comment.body || '')
      return
    }
    if (id === 'comment.delete' && comment) {
      setAction({ type: 'delete', comment })
      return
    }
    if (id === 'comment.resolve' && comment) {
      // threadId is the GraphQL ReviewThread node ID (e.g. PRRT_kwDO...)
      const threadId = comment.threadId
      if (!threadId) { flash('Thread ID unavailable'); return }
      runWrite('Resolving thread', () => resolveThread(threadId)
        .then(() => {
          flash('Thread resolved')
          update(d => ({ ...d, comments: d.comments.map(c => (c.threadId === threadId ? { ...c, threadResolved: true } : c)) }))
        })
        .catch(err => flash(`Failed: ${err.message}`)))
      return
    }
    if (id === 'comment.filter') {
      const idx = FILTER_MODES.indexOf(filterMode)
      setFilterMode(FILTER_MODES[(idx + 1) % FILTER_MODES.length])
      return
    }
    if (id === 'comment.jump' && comment && onJumpToDiff) {
      onJumpToDiff(comment.line)
      return
    }
  })

  if (loading) return <Box paddingX={1}><Text color={t.ui.muted}>Loading comments…</Text></Box>
  if (error)   return <Box paddingX={1}><Text color={t.ci.fail}>⚠ Failed to load — {firstActionKey('list.refresh', 'r')} to retry</Text></Box>

  const loadedConversation = data?.conversation.length || 0
  const loadedThreads = new Set((data?.comments || []).map(c => c.threadId)).size
  const countLabel = `conversation ${loadedConversation} of ${Math.max(convPage?.total ?? 0, loadedConversation)} · threads ${loadedThreads} of ${Math.max(threadsPage?.total ?? 0, loadedThreads)}`
  const hasMore = !!(convPage?.hasNextPage || threadsPage?.hasNextPage)
  const incomplete = !!(convPage?.stalled || threadsPage?.stalled || Object.values(data?.partial || {}).some(p => p.stalled))

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold>PR #{prNumber} Comments</Text>
        <Box gap={2}>
          {statusMsg && <Text color={t.ci.pass}>{statusMsg}</Text>}
          <Text color={t.ui.dim}>filter: {filterMode}  {countLabel}{incomplete ? '  (incomplete: GitHub repeated a page cursor)' : ''}{hasMore ? (moreFailed ? '  (load failed, r to retry)' : '  (loading more…)') : ''}</Text>
        </Box>
      </Box>

      {/* Action box */}
      {action && (
        <Box flexDirection="column" borderStyle="round"
          borderColor={action.type === 'delete' ? t.ci.fail : t.diff.threadBorder}
          paddingX={1} marginX={1}>
          {action.type === 'delete' && (
            <>
              <Text color={t.ci.fail} bold>Delete comment by @{sanitize(action.comment.user?.login)}?</Text>
              <Text color={t.ui.dim} wrap="truncate">  "{sanitize(stripAnsi(action.comment.body || '').slice(0, 60))}"</Text>
              <Text color={t.ui.dim}>[y] confirm  [n / Esc] cancel</Text>
            </>
          )}
          {(action.type === 'reply' || action.type === 'edit') && (
            <>
              <Text color={t.ui.dim}>
                {action.type === 'reply'
                  ? (action.comment._conversation
                    ? `Comment on PR #${prNumber} (posts a new PR comment):`
                    : `Reply to @${sanitize(action.comment.user?.login)}:`)
                  : `Edit comment:`}
              </Text>
              <TextInput
                value={actionText}
                onChange={setActionText}
                focus={true}
                onEnter={submitAction}
              />
              <Text color={t.ui.dim}>[Ctrl+G / Enter] send  [Ctrl+E] open editor  [Esc] cancel</Text>
            </>
          )}
        </Box>
      )}

      {/* Comment list */}
      <Box flexDirection="column" flexGrow={1}>
        {visibleItems.map((comment, i) => {
          const idx = scrollOffset + i
          const isSelected = idx === cursor && !action
          const isReply = !comment._isRoot

          if (comment._more) {
            const label = comment.stalled
              ? `${comment.remaining} more replies (incomplete: GitHub repeated a page cursor)`
              : `${comment.remaining} more replies${isSelected ? ' (loading…)' : ''}`
            return (
              <Box key={rowKey(comment)} paddingX={4}>
                <Text color={isSelected ? t.ui.selected : t.ui.dim}>{`  ┗ ${label}`}</Text>
              </Box>
            )
          }

          return (
            <Box key={rowKey(comment)} flexDirection="column" marginBottom={isReply ? 0 : 1}
              borderStyle={isSelected ? 'round' : undefined}
              borderColor={isSelected ? t.ui.selected : undefined}>
              {/* Thread header — show once per root comment */}
              {comment._isRoot && comment._conversation && (
                <Box paddingX={1} gap={2}>
                  <Text color={t.ui.selected} bold>conversation</Text>
                </Box>
              )}
              {comment._isRoot && !comment._conversation && (
                <Box paddingX={1} gap={2}>
                  <Text color={t.ui.selected} bold>{sanitize(comment.path)}</Text>
                  <Text color={t.ui.dim}>line {comment.line}</Text>
                </Box>
              )}
              {/* Comment body */}
              <Box paddingX={isReply ? 4 : 2} flexDirection="column">
                <Box gap={1}>
                  <Text color={t.diff.threadBorder}>{isReply ? '  ┗' : '┃'}</Text>
                  <Text color={t.ui.selected} bold>@{sanitize(comment.user?.login)}</Text>
                  <Text color={t.ui.dim}>{shortAge(comment.createdAt)}</Text>
                  {isReply && <Text color={t.ui.dim}>(reply)</Text>}
                </Box>
                {stripAnsi(comment.body || '').split('\n').map((line, li) => (
                  <Box key={li}>
                    <Text color={t.diff.threadBorder}>{isReply ? '    ' : '┃ '}</Text>
                    <Text color={t.diff.ctxFg} wrap="truncate">{sanitize(line)}</Text>
                  </Box>
                ))}
                {isSelected && (
                  <Box gap={2} paddingLeft={2}>
                    <Text color={t.ui.dim}>{comment._conversation
                      ? `[${firstActionKey('comment.reply', 'c')}] comment on PR`
                      : `[${firstActionKey('comment.reply', 'c')}] reply  [${firstActionKey('comment.edit', 'e')}] edit  [${firstActionKey('comment.delete', 'Ctrl+X')}] delete  [${firstActionKey('comment.resolve', 'z')}] resolve  [${firstActionKey('comment.jump', 'J')}] jump to diff`}</Text>
                  </Box>
                )}
              </Box>
            </Box>
          )
        })}
        {flatComments.length === 0 && (
          <Box paddingX={2} paddingY={1}>
            <Text color={t.ui.muted}>No comment threads found.</Text>
          </Box>
        )}
      </Box>

      <FooterKeys keys={footerKeys} />
    </Box>
  )
}
