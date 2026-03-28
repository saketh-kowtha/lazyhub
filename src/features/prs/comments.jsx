/**
 * src/features/prs/comments.jsx — PR comments/threads view
 */

import React, { useState, useMemo } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import { listPRComments, resolveThread, addPRLineComment } from '../../executor.js'
import { FooterKeys } from '../../components/FooterKeys.jsx'
import { t } from '../../theme.js'

const FOOTER_KEYS = [
  { key: 'j/k', label: 'nav' },
  { key: 'r', label: 'reply' },
  { key: 'R', label: 'resolve' },
  { key: 'f', label: 'filter' },
  { key: 'Esc', label: 'back' },
]

const FILTER_MODES = ['all', 'open', 'resolved']

export function PRComments({ prNumber, repo, onBack, onJumpToDiff }) {
  const { stdout } = useStdout()
  const visibleHeight = Math.max(5, (stdout?.rows || 24) - 8)

  const { data: rawComments, loading, error, refetch } = useGh(listPRComments, [repo, prNumber])
  const [cursor, setCursor] = useState(0)
  const [filterMode, setFilterMode] = useState('all')
  const [replyTarget, setReplyTarget] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [statusMsg, setStatusMsg] = useState(null)
  const [scrollOffset, setScrollOffset] = useState(0)

  // Group comments by file+line
  const threads = useMemo(() => {
    if (!rawComments) return []
    const groups = new Map()
    for (const c of rawComments) {
      const key = `${c.path}:${c.line || c.originalLine}`
      if (!groups.has(key)) groups.set(key, { path: c.path, line: c.line || c.originalLine, comments: [] })
      groups.get(key).comments.push(c)
    }
    return Array.from(groups.values())
  }, [rawComments])

  const filteredThreads = useMemo(() => {
    return threads // All threads shown (no resolved state tracking in this simplified impl)
  }, [threads])

  const visibleThreads = filteredThreads.slice(scrollOffset, scrollOffset + visibleHeight)

  useInput((input, key) => {
    if (replyTarget) {
      if (key.escape) { setReplyTarget(null); setReplyText(''); return }
      if ((key.return && key.ctrl) || (key.ctrl && input === 's')) {
        // Submit reply
        const thread = filteredThreads[cursor]
        if (thread && replyText) {
          addPRLineComment(repo, prNumber, {
            body: replyText,
            path: thread.path,
            line: thread.line,
            side: 'RIGHT',
          }).then(() => {
            setStatusMsg('Reply sent')
            setTimeout(() => setStatusMsg(null), 3000)
            refetch()
          }).catch(err => {
            setStatusMsg(`Failed: ${err.message}`)
            setTimeout(() => setStatusMsg(null), 3000)
          })
        }
        setReplyTarget(null)
        setReplyText('')
        return
      }
      if (key.backspace || key.delete) { setReplyText(r => r.slice(0, -1)); return }
      if (input && !key.ctrl && !key.meta) { setReplyText(r => r + input); return }
      return
    }

    if (input === 'r') { refetch(); return }
    if (key.escape || input === 'q') { onBack(); return }
    if (input === 'j' || key.downArrow) {
      setCursor(c => {
        const next = Math.min(filteredThreads.length - 1, c + 1)
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
    if (input === 'f') {
      const idx = FILTER_MODES.indexOf(filterMode)
      setFilterMode(FILTER_MODES[(idx + 1) % FILTER_MODES.length])
      return
    }
    if (input === 'r') {
      setReplyTarget(filteredThreads[cursor])
      return
    }
    if (input === 'R') {
      const thread = filteredThreads[cursor]
      if (thread) {
        resolveThread(thread.comments[0]?.pullRequestReviewId)
          .then(() => { setStatusMsg('Thread resolved'); refetch() })
          .catch(err => setStatusMsg(`Failed: ${err.message}`))
        setTimeout(() => setStatusMsg(null), 3000)
      }
      return
    }
    if (input === 'g') {
      const thread = filteredThreads[cursor]
      if (thread && onJumpToDiff) onJumpToDiff(thread.line)
      return
    }
  })

  if (loading) {
    return <Box paddingX={1}><Text color={t.ui.muted}>Loading comments...</Text></Box>
  }
  if (error) {
    return <Box paddingX={1}><Text color={t.ci.fail}>⚠ Failed to load — r to retry</Text></Box>
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold>PR #{prNumber} Comments</Text>
        <Box gap={2}>
          {statusMsg && <Text color={t.ci.pass}>{statusMsg}</Text>}
          <Text color={t.ui.dim}>filter: {filterMode}</Text>
        </Box>
      </Box>

      {replyTarget && (
        <Box paddingX={1} flexDirection="column" borderStyle="round" borderColor={t.diff.threadBorder}>
          <Text color={t.ui.muted}>Reply to thread:</Text>
          <Box>
            <Text color={t.ui.selected}>{replyText}</Text>
            <Text color={t.ui.dim}>█</Text>
          </Box>
          <Text color={t.ui.dim}>[Ctrl+S] send  [Esc] cancel</Text>
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1}>
        {visibleThreads.map((thread, i) => {
          const idx = scrollOffset + i
          const isSelected = idx === cursor
          return (
            <Box key={`${thread.path}:${thread.line}`} flexDirection="column" marginBottom={1}
              borderStyle={isSelected ? 'round' : undefined}
              borderColor={isSelected ? t.ui.selected : undefined}>
              <Box paddingX={1} gap={2}>
                <Text color={t.ui.selected} bold>{thread.path}</Text>
                <Text color={t.ui.dim}>line {thread.line}</Text>
              </Box>
              {thread.comments.map(c => (
                <Box key={c.id} paddingX={2} gap={1} flexDirection="column">
                  <Box gap={1}>
                    <Text color={t.diff.threadBorder}>┃</Text>
                    <Text color={t.ui.selected}>{c.user?.login}</Text>
                    <Text color={t.ui.dim}>{format(c.createdAt)}</Text>
                  </Box>
                  <Box>
                    <Text color={t.diff.threadBorder}>┃ </Text>
                    <Text color={t.diff.ctxFg} wrap="truncate">{c.body}</Text>
                  </Box>
                </Box>
              ))}
            </Box>
          )
        })}
        {filteredThreads.length === 0 && (
          <Box paddingX={2} paddingY={1}>
            <Text color={t.ui.muted}>No comment threads found.</Text>
          </Box>
        )}
      </Box>
      <FooterKeys keys={FOOTER_KEYS} />
    </Box>
  )
}
