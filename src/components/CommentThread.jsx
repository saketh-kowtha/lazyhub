/**
 * CommentThread.jsx — renders a list of comments as a threaded discussion.
 * Props: comments ([Comment]), t (theme object)
 * Used in: diff.jsx inline threads, comments.jsx view
 */

import React from 'react'
import { Box, Text } from 'ink'
import { sanitize, shortAge, authorColor } from '../utils.js'

function Monogram({ login }) {
  if (!login) return <Text>[??]</Text>
  const color = authorColor(login)
  return <Text color={color} bold>[{login.slice(0, 2).toUpperCase()}]</Text>
}

export function CommentThread({ comments = [], t }) {
  if (!comments.length) return null

  const sorted = [...comments].sort((a, b) =>
    new Date(a.createdAt) - new Date(b.createdAt)
  )
  const topLevel = sorted.filter(c => !c.inReplyToId)
  const replies  = sorted.filter(c =>  c.inReplyToId)

  const elements = []

  for (const comment of topLevel) {
    const pending = comment.pending
    const age = comment.createdAt ? shortAge(comment.createdAt) : '…'

    // Thread header
    elements.push(
      <Box key={`${comment.id}-hdr`} gap={1}>
        <Text color={t.diff.threadBorder}>❯</Text>
        <Monogram login={comment.user?.login} />
        <Text color={pending ? t.ui.dim : t.ui.selected} bold={!pending}>
          @{comment.user?.login || '…'}
        </Text>
        <Text color={t.ui.dim}>·</Text>
        <Text color={t.ui.dim}>{age}</Text>
        {pending && <Text color={t.ui.dim} italic> (posting…)</Text>}
      </Box>
    )

    // Body lines
    const bodyLines = (comment.body || '').split('\n')
    for (let i = 0; i < bodyLines.length; i++) {
      elements.push(
        <Box key={`${comment.id}-body-${i}`} paddingLeft={2}>
          <Text color={t.diff.threadBorder}>┃ </Text>
          <Text color={t.diff.ctxFg} wrap="truncate">{sanitize(bodyLines[i])}</Text>
        </Box>
      )
    }

    // Replies
    const commentReplies = replies.filter(r => r.inReplyToId === comment.id)
    for (const reply of commentReplies) {
      const replyAge = reply.createdAt ? shortAge(reply.createdAt) : '…'
      elements.push(
        <Box key={`${reply.id}-hdr`} gap={1} paddingLeft={2}>
          <Text color={t.diff.threadBorder}>└─ ❯</Text>
          <Monogram login={reply.user?.login} />
          <Text color={t.ui.muted}>@{reply.user?.login || '…'}</Text>
          <Text color={t.ui.dim}>· {replyAge}</Text>
        </Box>
      )
      const replyLines = (reply.body || '').split('\n')
      for (let i = 0; i < replyLines.length; i++) {
        elements.push(
          <Box key={`${reply.id}-body-${i}`} paddingLeft={6}>
            <Text color={t.diff.ctxFg} wrap="truncate">{sanitize(replyLines[i])}</Text>
          </Box>
        )
      }
    }

    // Spacer between top-level threads
    elements.push(<Box key={`${comment.id}-spacer`}><Text> </Text></Box>)
  }

  return <Box flexDirection="column">{elements}</Box>
}
