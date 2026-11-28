// @ts-nocheck
/**
 * src/features/prs/ClaimsView.jsx - the claims check view (#361). Read-only.
 * Mockup: docs/mockups/claims-check.md.
 *
 * Fetches the PR's files and patches (and the issues it says it fixes) once, then runs the
 * pure checker in claims.js. The PR text is untrusted: every string drawn here is cleaned.
 * Deterministic by default. The optional AI pass runs only when asked (`A`), only proposes
 * claims, and its claims are labelled AI and checked by the same deterministic verifiers.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useInput } from '../../hooks/useSafeInput.js'
import { useKeyScope } from '../../keyscope.js'
import { useTheme } from '../../theme.js'
import { matchesAction, hintLine } from '../../config/actions.js'
import { classifyGhFailure, getClaimsContext } from '../../executor.js'
import { getAIClaims, AIError } from '../../ai/index.js'
import { FailureNotice } from '../../components/FailureNotice.jsx'
import { Spinner } from '../../components/Spinner.jsx'
import { openInEditor } from '../../editor.js'
import { loadConfig } from '../../config.js'
import { logSwallowed } from '../../contain.js'
import { sanitize, sanitizeCode, sanitizePath, sanitizeRaw } from '../../utils.js'
import {
  claimLabel, claimsFromAI, claimsPromptText, extractClaims, mergeClaims, referencedIssues, summarize, verifyClaims, STATUS,
} from './claims.js'

const GLYPH = { [STATUS.VERIFIED]: '✓', [STATUS.CONTRADICTED]: '✗', [STATUS.UNVERIFIABLE]: '?' }
const NO_AI = { phase: 'idle', items: null, notices: [], error: null }

/**
 * @param {object} props
 * @param {{ number: number, title?: string, body?: string, author?: { login?: string } }} props.pr
 * @param {string} props.repo
 * @param {() => void} props.onClose
 * @param {(pr: object) => void} [props.onOpenDiff]
 */
export function ClaimsView({ pr, repo, onClose, onOpenDiff }) {
  useKeyScope('dialog')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const height = Math.max(6, (stdout?.rows || 24) - 9)
  const [state, setState] = useState({ phase: 'loading', data: null, error: null })
  const [ai, setAi] = useState(NO_AI)
  const [cursor, setCursor] = useState(0)
  const [note, setNote] = useState(null)

  const extracted = useMemo(() => extractClaims({ title: pr?.title, body: pr?.body }), [pr?.title, pr?.body])
  const fromAI = useMemo(
    () => (ai.items ? claimsFromAI(ai.items, { title: pr?.title, body: pr?.body }) : { claims: [], notices: [] }),
    [ai.items, pr?.title, pr?.body]
  )
  const merged = useMemo(() => mergeClaims(extracted.claims, fromAI.claims), [extracted, fromAI])
  const issueKey = referencedIssues(merged).join(',')

  useEffect(() => {
    let live = true
    // Every claim type but the wording-only ones reads the changed files, so they are always read.
    getClaimsContext(repo, pr.number, issueKey ? issueKey.split(',').map(Number) : [])
      .then(data => { if (live) setState({ phase: 'ok', data, error: null }) })
      .catch(error => { if (live) setState({ phase: 'error', data: null, error }) })
    return () => { live = false }
  }, [repo, pr?.number, issueKey])

  const checked = useMemo(() => (state.data ? verifyClaims(merged, state.data) : null), [state.data, merged])
  const claims = checked?.claims || []
  const notices = [...extracted.notices, ...ai.notices, ...fromAI.notices, ...(checked?.notices || [])]
  const selected = claims[Math.min(cursor, Math.max(0, claims.length - 1))]

  const openEvidence = () => {
    const ev = selected?.evidence?.[0]
    if (!ev) { setNote('This claim has no file to open'); return }
    openInEditor(ev.path, ev.line || 1, loadConfig().editor).catch((err) => {
      logSwallowed('prs.claims.open-editor', err)
      setNote('Could not open the editor')
    })
  }

  const runAI = () => {
    if (ai.phase === 'loading' || ai.phase === 'done') return
    if (loadConfig().aiReviewEnabled === false) { setNote('AI is disabled in Settings (,)'); return }
    const prompt = claimsPromptText({ title: pr?.title, body: pr?.body })
    setAi({ ...NO_AI, phase: 'loading' })
    getAIClaims({ text: prompt.text, authorHint: pr?.author?.login })
      .then(items => setAi({ phase: 'done', items, notices: prompt.notices, error: null }))
      .catch((err) => {
        if (!(err instanceof AIError)) logSwallowed('prs.claims.ai', err)
        setAi({ ...NO_AI, phase: 'error', error: err instanceof AIError ? err.message : 'The AI pass failed' })
      })
  }

  useInput((input, key) => {
    if (note) setNote(null)
    if (matchesAction('dialog.cancel', input, key)) { onClose(); return }
    if (matchesAction('cursor.down', input, key)) { setCursor(c => Math.min(claims.length - 1, c + 1)); return }
    if (matchesAction('cursor.up', input, key)) { setCursor(c => Math.max(0, c - 1)); return }
    if (matchesAction('pr.diff', input, key) && onOpenDiff) { onOpenDiff(pr); return }
    if (matchesAction('diff.ai-review', input, key)) { runAI(); return }
    if (matchesAction('pr.open-editor', input, key)) openEvidence()
  })

  // One flat list of rows so the window can follow the selected claim.
  const rows = []
  let selectedRow = 0
  claims.forEach((c, i) => {
    const isSel = i === Math.min(cursor, claims.length - 1)
    if (isSel) selectedRow = rows.length
    const color = c.status === STATUS.VERIFIED ? t.ci.pass : c.status === STATUS.CONTRADICTED ? t.ci.fail : t.ui.muted
    const where = c.source === 'title' ? 'title' : `body, line ${c.line}`
    rows.push(
      <Box key={`${c.id}-h`} gap={1}>
        <Text color={isSel ? t.ui.selected : t.ui.dim}>{isSel ? '>' : ' '}</Text>
        <Text color={color} bold>{GLYPH[c.status]} {c.status.padEnd(12)}</Text>
        <Text color={t.ui.dim}>{c.origin === 'ai' ? 'AI' : '  '}</Text>
        <Text color={isSel ? t.ui.selected : undefined} wrap="truncate">{sanitize(claimLabel(c)).padEnd(22)} "{sanitize(c.text)}"</Text>
        <Text color={t.ui.dim}> ({where})</Text>
      </Box>
    )
    if (isSel) {
      rows.push(<Box key={`${c.id}-r`} paddingLeft={5}><Text color={t.ui.muted} wrap="truncate">{sanitizeRaw(c.reason)}</Text></Box>)
      for (const [j, ev] of c.evidence.entries()) {
        rows.push(
          <Box key={`${c.id}-e${j}`} paddingLeft={7} gap={1}>
            <Text color={t.ui.selected}>{sanitizePath(ev.path)}{ev.line ? `:${ev.line}` : ''}</Text>
            <Text color={t.ui.dim} wrap="truncate">{sanitizeCode(ev.text)}</Text>
          </Box>
        )
      }
    }
  })
  const start = Math.max(0, Math.min(selectedRow - 1, rows.length - height))
  const summary = checked?.summary || summarize([])
  const aiAdded = claims.filter(c => c.origin === 'ai').length

  const aiLine = {
    idle: 'Deterministic checks only. No AI was used.',
    loading: null,
    done: `AI pass: ${aiAdded} new ${aiAdded === 1 ? 'claim' : 'claims'} (marked AI), each checked against the diff like the rest. The AI decides no status.`,
    error: `AI pass failed: ${sanitizeRaw(ai.error || '')}. Deterministic checks only.`,
  }[ai.phase]
  const hints = [['cursor.down', 'select'], ['pr.diff', 'diff'], ['pr.open-editor', 'editor']]
  if (ai.phase === 'idle' || ai.phase === 'error') hints.push(['diff.ai-review', 'AI pass'])
  hints.push(['dialog.cancel', 'close'])

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" borderColor={t.ui.border} paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold>Claims check  PR #{pr.number}</Text>
        {state.phase === 'ok' && <Text color={t.ui.muted}>{summary.line}</Text>}
      </Box>
      {state.phase === 'loading' && (
        <Box paddingX={1} gap={1}><Spinner /><Text color={t.ui.muted}>Reading the changed files…</Text></Box>
      )}
      {state.phase === 'error' && (
        <Box paddingX={2} paddingY={1}><FailureNotice failure={classifyGhFailure(state.error)} /></Box>
      )}
      {state.phase === 'ok' && (
        <>
          {notices.map(n => <Box key={n} paddingX={1}><Text color={t.ci.pending} wrap="truncate">{sanitizeRaw(n)}</Text></Box>)}
          <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
            {claims.length === 0
              ? <Text color={t.ui.muted}>The title and description make no claim this check recognises (fixes #n, tests, docs, no breaking changes, only touches X, version bump).</Text>
              : rows.slice(start, start + height)}
          </Box>
        </>
      )}
      <Box paddingX={1} gap={2}>
        {ai.phase === 'loading'
          ? <Box gap={1}><Spinner /><Text color={t.ui.muted}>AI pass: reading the description…</Text></Box>
          : <Text color={ai.phase === 'error' ? t.ci.fail : t.ui.dim} wrap="truncate">{aiLine}</Text>}
        {note && <Text color={t.ci.fail}>{sanitizeRaw(note)}</Text>}
      </Box>
      <Box paddingX={1}>
        <Text color={t.ui.dim}>{hintLine(hints)}</Text>
      </Box>
    </Box>
  )
}
