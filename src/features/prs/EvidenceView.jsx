// @ts-nocheck
/**
 * src/features/prs/EvidenceView.jsx - the read-only review evidence view (#127, #175).
 * Mockup: docs/mockups/review-evidence.md.
 *
 * Every row is an observed fact with its source and read time (shown for the selected row), or
 * an explicit `unknown`. The inspected head is the head read when the view opened; if a refresh
 * finds a different head the view says so and the earlier reading is marked as no longer
 * applying. Nothing here writes to GitHub or grants authority. The PR title, description and
 * thread excerpts are author-written: they sit under their own heading, already cleaned.
 *
 * Return continuity: the caller passes `returnTo` (see returnTarget() in executor/evidence-detail.js)
 * and `onReturn(returnTo)`; Esc hands the same target back so a queue can restore its position and
 * filter. With no `returnTo`, Esc calls `onClose`.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useInput } from '../../hooks/useSafeInput.js'
import { useKeyScope } from '../../keyscope.js'
import { useTheme } from '../../theme.js'
import { matchesAction, hintLine } from '../../config/actions.js'
import { classifyGhFailure, loadEvidenceDetail, evidenceRows, createEvidenceCache } from '../../executor.js'
import { FailureNotice } from '../../components/FailureNotice.jsx'
import { Spinner } from '../../components/Spinner.jsx'
import { sanitize, sanitizeRaw } from '../../utils.js'

// One cache per process so reopening the view within the TTL is instant and still flagged stale after it.
const cache = createEvidenceCache()

/**
 * @param {object} props
 * @param {{ number: number, title?: string }} props.pr
 * @param {string} props.repo
 * @param {() => void} props.onClose
 * @param {(pr: object) => void} [props.onOpenDiff]
 * @param {{ view: string, position: number, filter: string, key: string }} [props.returnTo] where Esc should go back to
 * @param {(target: object) => void} [props.onReturn]
 */
export function EvidenceView({ pr, repo, onClose, onOpenDiff, returnTo, onReturn }) {
  useKeyScope('dialog')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const height = Math.max(6, (stdout?.rows || 24) - 9)
  const [state, setState] = useState({ phase: 'loading', detail: null, error: null })
  const [cursor, setCursor] = useState(0)
  const [reload, setReload] = useState(0)
  const inspected = useRef(null)
  const force = useRef(false)

  useEffect(() => {
    let live = true
    loadEvidenceDetail(repo, pr.number, { cache, force: force.current, inspectedHead: inspected.current })
      .then(detail => {
        if (!live) return
        // The first head read is the revision the user inspects; later refreshes are compared with it.
        if (!inspected.current) inspected.current = detail.head.current
        setState({ phase: 'ok', detail, error: null })
      })
      .catch(error => { if (live) setState({ phase: 'error', detail: null, error }) })
    return () => { live = false }
  }, [repo, pr?.number, reload])

  const rows = useMemo(() => (state.detail ? evidenceRows(state.detail) : []), [state.detail])
  // Display list: a heading whenever the section changes. The cursor walks every line.
  const lines = useMemo(() => {
    const out = []
    let section = null
    for (const r of rows) {
      if (r.section !== section) { section = r.section; out.push({ head: r.section === 'File' ? 'Changed files' : r.section }) }
      out.push(r)
    }
    return out
  }, [rows])
  const at = Math.min(cursor, Math.max(0, lines.length - 1))
  const selected = lines[at]
  const toneColor = { ok: t.ci.pass, bad: t.ci.fail, warn: t.ci.pending, muted: t.ui.muted, plain: undefined }
  const glyph = { ok: '✓', bad: '✗', warn: '◔', muted: ' ', plain: ' ' }

  const goBack = () => {
    if (returnTo && onReturn) onReturn(returnTo)
    else onClose()
  }

  useInput((input, key) => {
    if (matchesAction('dialog.cancel', input, key)) { goBack(); return }
    if (matchesAction('cursor.down', input, key)) { setCursor(c => Math.min(lines.length - 1, c + 1)); return }
    if (matchesAction('cursor.up', input, key)) { setCursor(c => Math.max(0, c - 1)); return }
    if (matchesAction('list.refresh', input, key)) { force.current = true; setState(s => ({ ...s, phase: s.detail ? 'ok' : 'loading' })); setReload(n => n + 1); return }
    if (matchesAction('pr.diff', input, key) && onOpenDiff) onOpenDiff(pr)
  })

  const start = Math.max(0, Math.min(at - Math.floor(height / 2), lines.length - height))
  const win = lines.slice(start, start + height)
  const detail = state.detail
  const rec = detail?.record

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" borderColor={t.ui.border} paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold wrap="truncate">Evidence  {sanitize(repo)}#{pr.number}</Text>
        {rec && <Text color={t.ui.muted}>{sanitize(String(rec.facts.state.value))}  read-only</Text>}
      </Box>
      {state.phase === 'loading' && (
        <Box paddingX={1} gap={1}><Spinner /><Text color={t.ui.muted}>Reading the review evidence…</Text></Box>
      )}
      {state.phase === 'error' && (
        <Box paddingX={2} paddingY={1}><FailureNotice failure={classifyGhFailure(state.error)} /></Box>
      )}
      {state.phase === 'ok' && detail && (
        <>
          {detail.head.state === 'stale' && (
            <Box paddingX={1}><Text color={t.ci.fail} bold wrap="truncate">✗ The head changed since you opened this. What you read earlier no longer applies.</Text></Box>
          )}
          <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
            {win.map((l, i) => {
              if (l.head) return <Text key={`h${start + i}`} color={t.ui.selected} bold wrap="truncate">{sanitize(l.head)}</Text>
              const sel = lines[at] === l
              return (
                <Box key={`r${start + i}`} gap={1}>
                  <Text color={sel ? t.ui.selected : t.ui.dim}>{sel ? '>' : ' '}</Text>
                  <Text color={toneColor[l.tone]}>{glyph[l.tone]}</Text>
                  <Text color={sel ? t.ui.selected : t.ui.muted} wrap="truncate">{l.label.padEnd(18)}</Text>
                  <Text color={toneColor[l.tone]} wrap="truncate">{l.value}</Text>
                </Box>
              )
            })}
          </Box>
          <Box paddingX={1}>
            <Text color={t.ui.dim} wrap="truncate">
              {selected?.source ? `source ${sanitizeRaw(selected.source)}, read ${sanitizeRaw(selected.fetched_at || '')}` : selected?.untrusted ? 'written by the PR author or a commenter, not verified' : ' '}
            </Text>
          </Box>
        </>
      )}
      <Box paddingX={1}>
        <Text color={t.ui.dim}>Observation only. It does not approve, merge or authorize anything. No AI was used.</Text>
      </Box>
      <Box paddingX={1}>
        <Text color={t.ui.dim}>{hintLine([['cursor.down', 'scroll'], ['list.refresh', 'refresh'], ['pr.diff', 'diff']])}  Esc {returnTo?.view && onReturn ? `back to ${sanitize(returnTo.view)}` : 'close'}</Text>
      </Box>
    </Box>
  )
}
