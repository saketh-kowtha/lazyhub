// @ts-nocheck
/**
 * src/features/prs/story/StoryView.jsx -- the review story walkthrough (#362).
 *
 * A short list of steps (core change, call sites, config, tests, noise), the reason the current
 * step is grouped that way, and a windowed file list. n/p move between steps, j/k between files,
 * Enter opens the existing diff at the file. Read-only. Works at 80x24.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useTheme } from '../../../theme.js'
import { useKeyScope } from '../../../keyscope.js'
import { useActionResolver, useKeymapInput } from '../../../config/keymap.js'
import { sanitize, sanitizePath, sanitizeRaw, shortAge } from '../../../utils.js'
import { useStory } from './useStory.js'

/** One line saying what changed since the viewer's last review, or why that is unknown. */
export function sinceLine({ delta, deltaLoading, deltaError, sinceCount, sinceOutside }) {
  if (deltaError && !delta) return { text: 'Since your last review: unknown (could not read your review from GitHub).', tone: 'warn' }
  if (!delta) return { text: deltaLoading ? 'Since your last review: checking...' : 'Since your last review: unknown.', tone: 'dim' }
  if (delta.status === 'none') return { text: `Since your last review: ${delta.reason}`, tone: 'dim' }
  if (delta.status === 'unknown') return { text: `Since your last review: unknown. ${delta.reason}`, tone: 'warn' }
  const when = delta.submittedAt ? ` (reviewed ${shortAge(delta.submittedAt)} ago)` : ''
  if (delta.status === 'same') return { text: `Since your last review${when}: no new commits.`, tone: 'dim' }
  const extra = sinceOutside ? `, ${sinceOutside} no longer in this PR` : ''
  const cap = delta.capped ? '; GitHub lists at most 300 files, so there may be more' : ''
  const approx = delta.approximate ? ' File-level comparison (history was rewritten).' : ''
  return { text: `Since your last review${when}: ${sinceCount ?? 0} file${sinceCount === 1 ? '' : 's'} changed${extra}${cap}.${approx}`, tone: 'accent' }
}

/**
 * @param {object} props
 * @param {number} props.prNumber
 * @param {string} props.repo
 * @param {Function} props.onBack
 * @param {Function} props.onOpenFile (path, { step, cursor }) => void
 * @param {{step?: number, cursor?: number}} [props.initial] position to restore
 */
export function StoryView({ prNumber, repo, onBack, onOpenFile, initial }) {
  useKeyScope('view')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const termRows = stdout?.rows || 24
  const resolve = useActionResolver(['global', 'pr-story'])
  const s = useStory({ repo, prNumber })
  const steps = s.story.steps
  const [step, setStep] = useState(initial?.step ?? 0)
  const [cursor, setCursor] = useState(initial?.cursor ?? 0)
  const [expanded, setExpanded] = useState(false)

  const at = Math.min(step, Math.max(0, steps.length - 1))
  const current = steps[at]
  const hidden = Boolean(current?.collapsed && !expanded)
  const files = current?.files || []
  const cur = Math.min(cursor, Math.max(0, files.length - 1))

  useEffect(() => { setExpanded(false) }, [at])

  const go = (n) => { setStep(n); setCursor(0) }
  useKeymapInput((input, key) => {
    const id = resolve(input, key)
    if (id === 'app.back') { onBack(); return }
    if (id === 'story.next') { if (at < steps.length - 1) go(at + 1); return }
    if (id === 'story.prev') { if (at > 0) go(at - 1); return }
    if (id === 'cursor.down') { setCursor(c => Math.min(files.length - 1, c + 1)); return }
    if (id === 'cursor.up') { setCursor(c => Math.max(0, c - 1)); return }
    if (id === 'cursor.top') { setCursor(0); return }
    if (id === 'cursor.bottom') { setCursor(Math.max(0, files.length - 1)); return }
    if (id === 'story.toggle') { if (current?.collapsed) setExpanded(v => !v); return }
    if (id === 'list.refresh') { s.refetch(); return }
    if (id === 'story.open') {
      if (hidden) { setExpanded(true); return }
      const file = files[cur]
      if (file) onOpenFile(file.path, { step: at, cursor: cur })
    }
  })

  const since = sinceLine(s)
  const sinceColor = since.tone === 'warn' ? t.ci.pending : since.tone === 'accent' ? t.ui.selected : t.ui.dim
  const progress = !s.complete && !s.error
    ? (s.listError ? `File list incomplete: ${s.loadedFiles} of ${s.total} loaded (${s.listError.message}). r to retry.`
      : s.capped ? `Showing the first ${s.loadedFiles} of ${s.total} files (page limit reached).`
        : `Loading file list: ${s.loadedFiles} of ${s.total}...`)
    : null

  // Rows left for the file list after the fixed chrome (status + footer = 3).
  const whyLines = Math.ceil(((current?.why || '').length + 1) / Math.max(20, (stdout?.columns || 80) - 2))
  const used = 1 + 1 + (progress ? 1 : 0) + steps.length + 1 + whyLines + 1
  const listRows = Math.max(3, termRows - 3 - used)
  const start = Math.max(0, Math.min(cur - Math.floor(listRows / 2), Math.max(0, files.length - listRows)))
  const shown = hidden ? [] : files.slice(start, start + listRows)

  const noiseSummary = useMemo(() => {
    if (!hidden) return ''
    const counts = new Map()
    for (const f of files) counts.set(f.reason, (counts.get(f.reason) || 0) + 1)
    return [...counts].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${n} ${r}`).join(', ')
  }, [hidden, files])

  if (s.loading) return <Box paddingX={1}><Text color={t.ui.dim}>Building review story for #{prNumber}...</Text></Box>
  if (s.error) return <Box paddingX={1}><Text color={t.ci.fail}>Could not load the changed files: {sanitizeRaw(s.error.message)}</Text></Box>
  if (!steps.length) return <Box paddingX={1}><Text color={t.ui.dim}>This PR has no changed files.</Text></Box>

  return (
    <Box flexDirection="column" paddingX={1} flexGrow={1} overflow="hidden">
      <Text bold wrap="truncate">Review story #{prNumber}  {s.loadedFiles}{s.complete ? '' : ` of ${s.total}`} files in {steps.length} steps</Text>
      <Text color={sinceColor} wrap="wrap">{sanitize(since.text)}</Text>
      {progress && <Text color={t.ci.pending} wrap="truncate">{progress}</Text>}
      {steps.map((st, i) => (
        <Text key={st.id} wrap="truncate" color={i === at ? t.ui.selected : undefined} bold={i === at}>
          {i === at ? '> ' : '  '}{i + 1}. {sanitize(st.title)}  {st.files.length} file{st.files.length === 1 ? '' : 's'}  +{st.additions} -{st.deletions}
          {st.sinceCount ? `  [${st.sinceCount} since review]` : ''}
        </Text>
      ))}
      <Text color={t.ui.dim} wrap="wrap">Why: {current.why}</Text>
      {hidden && (
        <Text color={t.ui.dim} wrap="wrap">{files.length} files collapsed ({noiseSummary}). Space or Enter to expand.</Text>
      )}
      {shown.map((f, i) => {
        const idx = start + i
        return (
          <Box key={f.path}>
            <Text color={idx === cur ? t.ui.selected : undefined} wrap="truncate-middle">
              {idx === cur ? '> ' : '  '}{sanitizePath(f.path)}
            </Text>
            <Text color={t.ui.dim} wrap="truncate">  +{f.additions} -{f.deletions} {f.reason}{f.sinceReview ? '  [since review]' : ''}</Text>
          </Box>
        )
      })}
      {!hidden && files.length > shown.length && (
        <Text color={t.ui.dim}>{start + 1}-{start + shown.length} of {files.length} files in this step</Text>
      )}
    </Box>
  )
}
