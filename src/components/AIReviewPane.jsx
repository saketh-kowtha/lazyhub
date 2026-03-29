/**
 * src/components/AIReviewPane.jsx — Overlay for AI-powered code review results
 *
 * Rendered inside PRDiff when the user presses `A`. Shows a list of AI
 * suggestions with j/k navigation, Enter to jump to the relevant line,
 * and `p` to post the suggestion as a real GitHub line comment.
 */

import React, { useState } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../theme.js'

export function AIReviewPane({ suggestions, summary, onJumpTo, onPost, onClose, postStatus }) {
  const { t } = useTheme()
  const [cursor, setCursor] = useState(0)

  useInput((input, key) => {
    if (key.escape || input === 'q') { onClose(); return }
    if (input === 'j' || key.downArrow) {
      setCursor(c => Math.min(c + 1, Math.max(0, suggestions.length - 1)))
      return
    }
    if (input === 'k' || key.upArrow) {
      setCursor(c => Math.max(c - 1, 0))
      return
    }
    if (key.return) {
      const s = suggestions[cursor]
      if (s) onJumpTo(s.file, s.line)
      return
    }
    if (input === 'p') {
      const s = suggestions[cursor]
      if (s) onPost(s)
      return
    }
  })

  const severityColor = (sev) => {
    if (sev === 'bug')     return t.ci.fail
    if (sev === 'warning') return t.ci.pending
    return t.ui.muted
  }

  const severityBadge = (sev) => `[${sev.padEnd(10)}]`

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1} marginX={1}>
      {/* Header row */}
      <Box justifyContent="space-between">
        <Text bold color={t.ui.selected}>
          AI Review — {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''}
        </Text>
        {postStatus && (
          <Text color={postStatus.startsWith('error') ? t.ci.fail : t.ci.pass}>
            {' '}{postStatus}
          </Text>
        )}
        <Text color={t.ui.muted}>  [q] close</Text>
      </Box>

      {/* Summary */}
      {summary ? (
        <Box paddingLeft={1} marginBottom={1}>
          <Text color={t.ui.dim}>{summary}</Text>
        </Box>
      ) : null}

      {/* Suggestions list */}
      {suggestions.length === 0 ? (
        <Box paddingLeft={1}>
          <Text color={t.ui.muted}>No issues found.</Text>
        </Box>
      ) : (
        suggestions.map((s, i) => (
          <Box key={i}>
            <Text color={i === cursor ? t.ui.selected : t.ui.dim}>
              {i === cursor ? '▶ ' : '  '}
            </Text>
            <Text color={severityColor(s.severity)}>
              {severityBadge(s.severity)}
            </Text>
            <Text color={t.ui.muted}>
              {' '}{s.file}{s.line != null ? `:${s.line}` : ''}{'  '}
            </Text>
            <Text wrap="truncate">{s.comment}</Text>
          </Box>
        ))
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text color={t.ui.dim}>
          [j/k] navigate  [Enter] jump to line  [p] post as comment  [q/Esc] close
        </Text>
      </Box>
    </Box>
  )
}
