/**
 * src/features/prs/comments.jsx — PR comments/threads view
 * Supports: reply, edit, delete per comment
 */

import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { Box, Text, useStdout } from 'ink'
import { spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { useActionResolver, useKeymapInput } from '../../config/keymap.js'
import { firstActionKey } from '../../config/actions.js'
import { contextFooterHints } from '../../ui/actions.js'
import { useGh } from '../../hooks/useGh.js'
import {
  listPRComments, resolveThread,
  replyToComment, editPRComment, deletePRComment,
} from '../../executor.js'
import { useKeyScope } from '../../keyscope.js'
import { FooterKeys } from '../../components/FooterKeys.jsx'
import { useTheme } from '../../theme.js'
import { TextInput, sanitize, shortAge } from '../../utils.js'


const FILTER_MODES = ['all', 'open', 'resolved']
const stripAnsi = s => (s || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')

export function PRComments({ prNumber, repo, onBack, onJumpToDiff }) {
  useKeyScope('view')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const visibleHeight = Math.max(5, (stdout?.rows || 24) - 8)

  const { data: rawComments, loading, error, refetch } = useGh(listPRComments, [repo, prNumber])
  const [cursor, setCursor]         = useState(0)
  const [filterMode, setFilterMode] = useState('all')
  const [statusMsg, setStatusMsg]   = useState(null)
  const [scrollOffset, setScrollOffset] = useState(0)

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
    if (!rawComments) return []
    // Group by thread (root = no inReplyToId)
    const roots = rawComments.filter(c => Object.hasOwn(c, 'inReplyToId') ? !c.inReplyToId : true)
    const replies = rawComments.filter(c => Object.hasOwn(c, 'inReplyToId') && c.inReplyToId)
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
      ...extra,
    })
    const all = []
    for (const root of roots) {
      all.push(pickComment(root, { _isRoot: true }))
      for (const reply of replies.filter(r => r.inReplyToId === root.id)) {
        all.push(pickComment(reply, { _isRoot: false, _rootId: root.id }))
      }
    }
    if (filterMode === 'resolved')  return all.filter(c => c.threadResolved)
    if (filterMode === 'open')      return all.filter(c => !c.threadResolved)
    return all
  }, [rawComments, filterMode])

  const visibleCount = flatComments.length

  // A refetch (deleted comment) or the filter cycle can shrink the list; keep the cursor on a real row.
  useEffect(() => {
    if (cursor > Math.max(0, visibleCount - 1)) {
      const last = Math.max(0, visibleCount - 1)
      setCursor(last)
      setScrollOffset(Math.max(0, last - visibleHeight + 1))
    }
  }, [visibleCount]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Status helper ──────────────────────────────────────────────────────────
  const flash = useCallback((msg) => {
    setStatusMsg(msg)
    setTimeout(() => setStatusMsg(null), 3000)
  }, [])

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
  const submitAction = useCallback(() => {
    if (!action) return
    const { type, comment } = action
    const body = actionText.trim()

    const done = () => { setAction(null); setActionText('') }

    if (type === 'reply') {
      if (!body) { done(); return }
      const rootId = comment._isRoot ? comment.id : comment._rootId
      if (!rootId) { flash('Cannot determine thread root'); done(); return }
      replyToComment(repo, prNumber, rootId, body)
        .then(() => { flash('Reply sent'); done(); refetch() })
        .catch(err => flash(`Failed: ${err.message}`))
    } else if (type === 'edit') {
      if (!body) { done(); return }
      editPRComment(repo, comment.id, body)
        .then(() => { flash('Comment updated'); done(); refetch() })
        .catch(err => flash(`Failed: ${err.message}`))
    } else if (type === 'delete') {
      deletePRComment(repo, comment.id)
        .then(() => { flash('Comment deleted'); done(); refetch() })
        .catch(err => flash(`Failed: ${err.message}`))
    }
  }, [action, actionText, repo, prNumber, flash, refetch])

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

    if (id === 'cursor.down') {
      setCursor(c => {
        const next = Math.max(0, Math.min(visibleCount - 1, c + 1))
        if (next >= scrollOffset + visibleHeight) setScrollOffset(s => s + 1)
        return next
      })
      return
    }
    if (id === 'cursor.up') {
      setCursor(c => {
        const next = Math.max(0, c - 1)
        if (next < scrollOffset) setScrollOffset(s => Math.max(0, s - 1))
        return next
      })
      return
    }
    if (id === 'cursor.top') { setCursor(0); setScrollOffset(0); return }
    if (id === 'cursor.bottom') {
      const last = Math.max(0, visibleCount - 1)
      setCursor(last); setScrollOffset(Math.max(0, last - visibleHeight + 1))
      return
    }

    const comment = flatComments[cursor]

    if (id === 'comment.reply' && comment) {
      setAction({ type: 'reply', comment })
      setActionText('')
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
      resolveThread(threadId)
        .then(() => { flash('Thread resolved'); refetch() })
        .catch(err => flash(`Failed: ${err.message}`))
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

  const visibleItems = flatComments.slice(scrollOffset, scrollOffset + visibleHeight)

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header */}
      <Box paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold>PR #{prNumber} Comments</Text>
        <Box gap={2}>
          {statusMsg && <Text color={t.ci.pass}>{statusMsg}</Text>}
          <Text color={t.ui.dim}>filter: {filterMode}  {flatComments.length} comments</Text>
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
                  ? `Reply to @${sanitize(action.comment.user?.login)}:`
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

          return (
            <Box key={comment.id} flexDirection="column" marginBottom={isReply ? 0 : 1}
              borderStyle={isSelected ? 'round' : undefined}
              borderColor={isSelected ? t.ui.selected : undefined}>
              {/* Thread header — show once per root comment */}
              {comment._isRoot && (
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
                    <Text color={t.ui.dim}>{`[${firstActionKey('comment.reply', 'c')}] reply  [${firstActionKey('comment.edit', 'e')}] edit  [${firstActionKey('comment.delete', 'Ctrl+X')}] delete  [${firstActionKey('comment.resolve', 'z')}] resolve  [${firstActionKey('comment.jump', 'J')}] jump to diff`}</Text>
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
