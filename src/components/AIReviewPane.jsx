/**
 * src/components/AIReviewPane.jsx — Interactive step-through AI code review
 *
 * Flow (research-backed: one-at-a-time > list; ~70% suggestions skipped):
 *
 *   Phase 1 — Summary
 *     Show overall summary + suggestion count breakdown.
 *     [Enter] to start stepping through, [q] to close.
 *
 *   Phase 2 — Step (per suggestion)
 *     Diff auto-scrolls to the relevant line.
 *     Shows: severity badge, file:line, AI comment as editable draft.
 *     [Enter/s] post draft as comment  [e] edit in $EDITOR  [n/Space] skip  [q] cancel all
 *     While editing inline (after pressing [i]): Esc returns to command mode.
 *
 *   Phase 3 — Done
 *     "Posted N  Skipped M" summary, then close.
 */

import React, { useState, useEffect, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme } from '../theme.js'
import { TextInput } from '../utils.js'

// ── helpers ───────────────────────────────────────────────────────────────────

const SEV_COLOR = (t, sev) => {
  if (sev === 'bug')     return t.ci.fail
  if (sev === 'warning') return t.ci.pending
  return t.ui.muted
}

const SEV_BADGE = sev => {
  const map = { bug: '● BUG', warning: '▲ WARN', suggestion: '◆ NOTE' }
  return map[sev] || sev.toUpperCase()
}

// ── component ─────────────────────────────────────────────────────────────────

export function AIReviewPane({
  suggestions,
  summary,
  onJumpTo,       // (file, line) → void — scroll diff, do NOT close pane
  onPost,         // (suggestion, body) → void — post comment to GitHub
  onClose,        // () → void
  postStatus,     // string | null
  onOpenEditor,   // (initialText) → string — open $EDITOR, return edited text
}) {
  const { t } = useTheme()

  // phase: 'summary' | 'step' | 'done'
  const [phase, setPhase]       = useState('summary')
  const [index, setIndex]       = useState(0)
  const [draft, setDraft]       = useState('')
  const [editing, setEditing]   = useState(false)   // inline TextInput mode
  const [posted, setPosted]     = useState(0)
  const [skipped, setSkipped]   = useState(0)
  const [posting, setPosting]   = useState(false)

  const total = suggestions.length
  const bugs  = suggestions.filter(s => s.severity === 'bug').length
  const warns = suggestions.filter(s => s.severity === 'warning').length
  const notes = suggestions.filter(s => s.severity === 'suggestion').length

  // Jump to the current suggestion's line whenever index changes in step phase
  useEffect(() => {
    if (phase === 'step' && suggestions[index]) {
      const s = suggestions[index]
      if (s.file) onJumpTo(s.file, s.line)
      setDraft(s.comment)
      setEditing(false)
    }
  }, [phase, index])   // eslint-disable-line react-hooks/exhaustive-deps

  const advanceTo = useCallback((nextIndex, wasPosted) => {
    if (wasPosted) setPosted(p => p + 1)
    else           setSkipped(sk => sk + 1)

    if (nextIndex >= total) {
      setPhase('done')
    } else {
      setIndex(nextIndex)
    }
  }, [total])

  const doPost = useCallback(() => {
    if (posting) return
    const s = suggestions[index]
    if (!s) return
    setPosting(true)
    onPost(s, draft.trim() || s.comment)
    // Advance immediately; postStatus from parent shows result briefly
    advanceTo(index + 1, true)
    setPosting(false)
  }, [posting, suggestions, index, draft, onPost, advanceTo])

  const doSkip = useCallback(() => {
    advanceTo(index + 1, false)
  }, [index, advanceTo])

  const doOpenEditor = useCallback(() => {
    if (!onOpenEditor) return
    const result = onOpenEditor(draft)
    if (typeof result === 'string') setDraft(result)
    setEditing(false)
  }, [onOpenEditor, draft])

  useInput((input, key) => {
    // Always: q/Esc closes (unless editing inline)
    if (!editing && (key.escape || input === 'q')) {
      onClose()
      return
    }

    if (phase === 'summary') {
      if (key.return || input === ' ') {
        if (total === 0) { onClose(); return }
        setIndex(0)
        setPhase('step')
      }
      return
    }

    if (phase === 'done') {
      onClose()
      return
    }

    // phase === 'step'
    if (editing) {
      // Esc exits inline edit mode (TextInput swallows everything else)
      if (key.escape) {
        setEditing(false)
        return
      }
      // Enter in edit mode = post
      if (key.return) {
        setEditing(false)
        doPost()
      }
      return
    }

    // Command mode (not editing)
    if (key.return || input === 's') { doPost(); return }
    if (input === 'n' || input === ' ') { doSkip(); return }
    if (input === 'i') { setEditing(true); return }  // inline edit
    if (input === 'e') { doOpenEditor(); return }     // $EDITOR
  })

  // ── Summary phase ─────────────────────────────────────────────────────────

  if (phase === 'summary') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={2} paddingY={1} marginX={1}>
        <Box justifyContent="space-between" marginBottom={1}>
          <Text bold color={t.ui.selected}>AI Review</Text>
          <Text color={t.ui.dim}>[q] close</Text>
        </Box>

        {summary ? (
          <Box marginBottom={1}>
            <Text color={t.ui.fg} wrap="wrap">{summary}</Text>
          </Box>
        ) : null}

        {total === 0 ? (
          <Box>
            <Text color={t.ci.pass}>✓ No issues found.</Text>
          </Box>
        ) : (
          <Box gap={3} marginBottom={1}>
            {bugs  > 0 && <Text color={t.ci.fail}  bold>{bugs} bug{bugs  > 1 ? 's' : ''}</Text>}
            {warns > 0 && <Text color={t.ci.pending}     >{warns} warning{warns > 1 ? 's' : ''}</Text>}
            {notes > 0 && <Text color={t.ui.muted}       >{notes} note{notes > 1 ? 's' : ''}</Text>}
          </Box>
        )}

        <Box marginTop={1}>
          <Text color={t.ui.dim}>
            {total > 0
              ? `[Enter] review ${total} suggestion${total > 1 ? 's' : ''} one-by-one   [q] close`
              : '[q] close'}
          </Text>
        </Box>
      </Box>
    )
  }

  // ── Done phase ────────────────────────────────────────────────────────────

  if (phase === 'done') {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={t.ci.pass} paddingX={2} paddingY={1} marginX={1}>
        <Text bold color={t.ci.pass}>Review complete</Text>
        <Box gap={4} marginTop={1}>
          {posted  > 0 && <Text color={t.ci.pass}>✓ Posted {posted}</Text>}
          {skipped > 0 && <Text color={t.ui.dim}>⊘ Skipped {skipped}</Text>}
          {posted === 0 && skipped === 0 && <Text color={t.ui.muted}>Nothing posted.</Text>}
        </Box>
        <Box marginTop={1}>
          <Text color={t.ui.dim}>[any key] close</Text>
        </Box>
      </Box>
    )
  }

  // ── Step phase ────────────────────────────────────────────────────────────

  const s = suggestions[index]
  if (!s) return null

  const progressColor = s.severity === 'bug' ? t.ci.fail
    : s.severity === 'warning' ? t.ci.pending
    : t.ui.selected

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={progressColor} paddingX={2} paddingY={1} marginX={1}>
      {/* Header: progress + severity + location */}
      <Box justifyContent="space-between" marginBottom={1}>
        <Box gap={2}>
          <Text color={t.ui.dim}>{index + 1}/{total}</Text>
          <Text color={SEV_COLOR(t, s.severity)} bold>{SEV_BADGE(s.severity)}</Text>
          <Text color={t.ui.muted}>
            {s.file}{s.line != null ? `:${s.line}` : ''}
          </Text>
        </Box>
        {postStatus && (
          <Text color={postStatus.startsWith('error') ? t.ci.fail : t.ci.pass}>
            {postStatus}
          </Text>
        )}
      </Box>

      {/* Draft comment (editable) */}
      <Box
        borderStyle="single"
        borderColor={editing ? t.ui.selected : t.ui.dim}
        paddingX={1}
        marginBottom={1}
      >
        {editing ? (
          <TextInput
            value={draft}
            onChange={setDraft}
            focus={true}
          />
        ) : (
          <Text color={t.ui.fg} wrap="wrap">{draft || s.comment}</Text>
        )}
      </Box>

      {/* Action hints */}
      <Box>
        {editing ? (
          <Text color={t.ui.dim}>
            [Enter] post  [Esc] back to commands
          </Text>
        ) : (
          <Text color={t.ui.dim}>
            [Enter/s] post  [i] edit inline  [e] open $EDITOR  [n/Space] skip  [q] cancel all
          </Text>
        )}
      </Box>
    </Box>
  )
}
