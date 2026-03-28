/**
 * src/features/prs/comments.jsx — PR comments/threads view
 * Supports: reply, edit, delete per comment
 */

import React, { useState, useMemo, useCallback } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { spawnSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, mkdtempSync, rmdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import {
  listPRComments, resolveThread,
  replyToComment, editPRComment, deletePRComment,
} from '../../executor.js'
import { FooterKeys } from '../../components/FooterKeys.jsx'
import { t } from '../../theme.js'

const FOOTER_KEYS = [
  { key: 'j/k',   label: 'nav' },
  { key: 'r',     label: 'reply' },
  { key: 'e',     label: 'edit' },
  { key: 'd',     label: 'delete' },
  { key: 'R',     label: 'resolve' },
  { key: 'f',     label: 'filter' },
  { key: 'Esc',   label: 'back' },
]

const FILTER_MODES = ['all', 'open', 'resolved']
const stripAnsi = s => (s || '').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')

export function PRComments({ prNumber, repo, onBack, onJumpToDiff }) {
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

  // ── Build flat list: each comment is individually navigable ────────────────

  const flatComments = useMemo(() => {
    if (!rawComments) return []
    // Group by thread (root = no inReplyToId)
    const roots = rawComments.filter(c => Object.hasOwn(c, 'inReplyToId') ? !c.inReplyToId : true)
    const replies = rawComments.filter(c => Object.hasOwn(c, 'inReplyToId') && c.inReplyToId)
    const all = []
    for (const root of roots) {
      all.push({ ...root, _isRoot: true })
      for (const reply of replies.filter(r => r.inReplyToId === root.id)) {
        all.push({ ...reply, _isRoot: false, _rootId: root.id })
      }
    }
    if (filterMode === 'resolved')  return all.filter(c => c.threadResolved)
    if (filterMode === 'open')      return all.filter(c => !c.threadResolved)
    return all
  }, [rawComments, filterMode])

  const visibleCount = flatComments.length

  // ── Status helper ──────────────────────────────────────────────────────────
  const flash = useCallback((msg) => {
    setStatusMsg(msg)
    setTimeout(() => setStatusMsg(null), 3000)
  }, [])

  // ── Open $EDITOR for multiline edit ───────────────────────────────────────
  const openEditor = useCallback((initial) => {
    const editor = process.env.EDITOR || process.env.VISUAL || 'vi'
    if (!editor || /[\0\n\r]/.test(editor)) return initial
    let tmpDir
    try {
      tmpDir = mkdtempSync(join(tmpdir(), 'lazyhub-'))
      const tmp = join(tmpDir, 'comment.md')
      writeFileSync(tmp, initial || '', { mode: 0o600 })
      spawnSync(editor, [tmp], { stdio: 'inherit' })
      const content = readFileSync(tmp, 'utf8')
      unlinkSync(tmp)
      return content
    } catch { return initial }
    finally { try { if (tmpDir) rmdirSync(tmpDir) } catch {} }
  }, [])

  // ── Submit action ──────────────────────────────────────────────────────────
  const submitAction = useCallback(() => {
    if (!action) return
    const { type, comment } = action
    const body = actionText.trim()

    if (type === 'reply') {
      if (!body) { setAction(null); setActionText(''); return }
      // Use root comment id for the reply
      const rootId = comment._isRoot ? comment.id : comment._rootId
      replyToComment(repo, prNumber, rootId, body)
        .then(() => { flash('Reply sent'); refetch() })
        .catch(err => flash(`Failed: ${err.message}`))
    } else if (type === 'edit') {
      if (!body) { setAction(null); setActionText(''); return }
      editPRComment(repo, comment.id, body)
        .then(() => { flash('Comment updated'); refetch() })
        .catch(err => flash(`Failed: ${err.message}`))
    } else if (type === 'delete') {
      deletePRComment(repo, comment.id)
        .then(() => { flash('Comment deleted'); refetch() })
        .catch(err => flash(`Failed: ${err.message}`))
    }

    setAction(null)
    setActionText('')
  }, [action, actionText, repo, prNumber, flash, refetch])

  // ── Keyboard ──────────────────────────────────────────────────────────────
  useInput((input, key) => {
    // ── Action mode ──
    if (action) {
      if (action.type === 'delete') {
        if (input === 'y') { submitAction(); return }
        if (key.escape || input === 'n') { setAction(null); return }
        return
      }
      // reply / edit: text input
      if (key.escape) { setAction(null); setActionText(''); return }
      if ((key.return && key.ctrl) || (key.ctrl && input === 'g')) { submitAction(); return }
      if (input === 'e' && action.type !== 'delete') {
        const result = openEditor(actionText)
        setActionText(result)
        return
      }
      if (key.backspace || key.delete) { setActionText(s => s.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) { setActionText(s => s + input); return }
      return
    }

    // ── Navigation ──
    if (key.escape || input === 'q') { onBack(); return }

    if (input === 'j' || key.downArrow) {
      setCursor(c => {
        const next = Math.min(visibleCount - 1, c + 1)
        if (next >= scrollOffset + visibleHeight) setScrollOffset(s => s + 1)
        return next
      })
      return
    }
    if (input === 'k' || key.upArrow) {
      setCursor(c => {
        const next = Math.max(0, c - 1)
        if (next < scrollOffset) setScrollOffset(s => Math.max(0, s - 1))
        return next
      })
      return
    }

    const comment = flatComments[cursor]

    if (input === 'r' && comment) {
      setAction({ type: 'reply', comment })
      setActionText('')
      return
    }
    if (input === 'e' && comment) {
      setAction({ type: 'edit', comment })
      setActionText(comment.body || '')
      return
    }
    if (input === 'd' && comment) {
      setAction({ type: 'delete', comment })
      return
    }
    if (input === 'R' && comment) {
      // threadId is the GraphQL ReviewThread node ID (e.g. PRRT_kwDO...)
      const threadId = comment.threadId
      if (!threadId) { flash('Thread ID unavailable'); return }
      resolveThread(threadId)
        .then(() => { flash('Thread resolved'); refetch() })
        .catch(err => flash(`Failed: ${err.message}`))
      return
    }
    if (input === 'f') {
      const idx = FILTER_MODES.indexOf(filterMode)
      setFilterMode(FILTER_MODES[(idx + 1) % FILTER_MODES.length])
      return
    }
    if (input === 'g' && comment && onJumpToDiff) {
      onJumpToDiff(comment.line)
      return
    }
  })

  if (loading) return <Box paddingX={1}><Text color={t.ui.muted}>Loading comments…</Text></Box>
  if (error)   return <Box paddingX={1}><Text color={t.ci.fail}>⚠ Failed to load — r to retry</Text></Box>

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
              <Text color={t.ci.fail} bold>Delete comment by @{action.comment.user?.login}?</Text>
              <Text color={t.ui.dim} wrap="truncate">  "{stripAnsi(action.comment.body || '').slice(0, 60)}"</Text>
              <Text color={t.ui.dim}>[y] confirm  [n / Esc] cancel</Text>
            </>
          )}
          {(action.type === 'reply' || action.type === 'edit') && (
            <>
              <Text color={t.ui.dim}>
                {action.type === 'reply'
                  ? `Reply to @${action.comment.user?.login}:`
                  : `Edit comment:`}
              </Text>
              <Box>
                <Text color={t.ui.selected}>{actionText}</Text>
                <Text color={t.ui.dim}>█</Text>
              </Box>
              <Text color={t.ui.dim}>[Ctrl+G] send  [e] open editor  [Esc] cancel</Text>
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
                  <Text color={t.ui.selected} bold>{comment.path}</Text>
                  <Text color={t.ui.dim}>line {comment.line}</Text>
                </Box>
              )}
              {/* Comment body */}
              <Box paddingX={isReply ? 4 : 2} flexDirection="column">
                <Box gap={1}>
                  <Text color={t.diff.threadBorder}>{isReply ? '  ┗' : '┃'}</Text>
                  <Text color={t.ui.selected} bold>@{comment.user?.login}</Text>
                  <Text color={t.ui.dim}>{format(comment.createdAt)}</Text>
                  {isReply && <Text color={t.ui.dim}>(reply)</Text>}
                </Box>
                {stripAnsi(comment.body || '').split('\n').map((line, li) => (
                  <Box key={li}>
                    <Text color={t.diff.threadBorder}>{isReply ? '    ' : '┃ '}</Text>
                    <Text color={t.diff.ctxFg} wrap="truncate">{line}</Text>
                  </Box>
                ))}
                {isSelected && (
                  <Box gap={2} paddingLeft={2}>
                    <Text color={t.ui.dim}>[r] reply  [e] edit  [d] delete  [R] resolve  [g] jump to diff</Text>
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

      <FooterKeys keys={FOOTER_KEYS} />
    </Box>
  )
}
