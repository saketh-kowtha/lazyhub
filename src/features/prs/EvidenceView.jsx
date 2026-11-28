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
 * filter. With no `returnTo`, Esc calls `onClose`. The diff opened here (`d`) covers this view
 * and the shell keeps it mounted, so coming back finds the same row and the same inspected head;
 * a reading that went stale meanwhile is read again on return, so a head that moved while the
 * diff was open shows as moved.
 *
 * Freshness: the read age ticks while the view is open; past a minute a banner says the reading is
 * stale. Refresh (r) reads every fact again and keeps the earlier rows on screen meanwhile; a failed
 * refresh keeps them, labelled with their age. A refresh never moves the inspected head, so it can
 * never make new commits look already read. Each row carries a plain `why` sentence
 * (executor/evidence-explain.js), shown for the selected row.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useInput } from '../../hooks/useSafeInput.js'
import { useKeyScope } from '../../keyscope.js'
import { useCovered, useCoveredInterval } from '../../shell/covered.js'
import { useTheme } from '../../theme.js'
import { matchesAction, hintLine, firstActionKey } from '../../config/actions.js'
import { classifyGhFailure, loadEvidenceDetail, evidenceRows, createEvidenceCache } from '../../executor.js'
// Pure helpers, imported from their module so a test that mocks the barrel keeps them real.
import { freshness, ageText } from '../../executor/evidence-detail.js'
import { FailureNotice } from '../../components/FailureNotice.jsx'
import { Spinner } from '../../components/Spinner.jsx'
import { sanitize, sanitizeRaw } from '../../utils.js'

// One cache per process so reopening the view within the TTL is instant and still flagged stale after it.
let cache = null
const evidenceCache = () => (cache ||= createEvidenceCache())

/** How often the read age on screen is brought up to date. */
export const AGE_TICK_MS = 5000

/**
 * The current time, moved on every `ms` while the view is on screen (paused while covered, like
 * every timer of a kept-alive layer), so the read age and staleness never freeze.
 */
function useNow(ms) {
  const [now, setNow] = useState(() => Date.now())
  useCoveredInterval(() => setNow(Date.now()), ms)
  return [now, setNow]
}

/**
 * @param {object} props
 * @param {{ number: number, title?: string }} props.pr
 * @param {string} props.repo
 * @param {() => void} props.onClose
 * @param {(pr: object) => void} [props.onOpenDiff]
 * @param {() => void} [props.onOpenDetail] Enter: open the full PR detail (only offered when the caller passes it)
 * @param {{ view: string, position: number, filter: string, key: string }} [props.returnTo] where Esc should go back to
 * @param {(target: object) => void} [props.onReturn]
 * @param {object} [props.queueRecord] the queue's evidence record when opened from the queue: its attention reasons are the ones shown
 */
export function EvidenceView({ pr, repo, onClose, onOpenDiff, onOpenDetail, returnTo, onReturn, queueRecord }) {
  useKeyScope('dialog')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const [state, setState] = useState({ phase: 'loading', detail: null, error: null, refreshing: false, refreshError: null })
  const [cursor, setCursor] = useState(0)
  const [reload, setReload] = useState(0)
  const inspected = useRef(null)
  const force = useRef(false)
  const [now, setNow] = useNow(AGE_TICK_MS)
  const queueAsked = Boolean(queueRecord?.attention?.some(r => r.code === 'review_requested'))

  useEffect(() => {
    let live = true
    setState(s => (s.detail ? { ...s, refreshing: true } : s))
    loadEvidenceDetail(repo, pr.number, { cache: evidenceCache(), force: force.current, inspectedHead: inspected.current, reviewRequestedOfMe: queueAsked })
      .then(detail => {
        if (!live) return
        // The first head read is the revision the user inspects; later refreshes are compared with it.
        if (!inspected.current) inspected.current = detail.head.current
        setState({ phase: 'ok', detail, error: null, refreshing: false, refreshError: null })
      })
      .catch(error => {
        if (!live) return
        // A failed refresh keeps the earlier reading on screen, labelled with its age, instead of blanking it.
        setState(s => (s.detail ? { ...s, refreshing: false, refreshError: error } : { phase: 'error', detail: null, error, refreshing: false, refreshError: null }))
      })
    return () => { live = false }
  }, [repo, pr?.number, reload, queueAsked])

  const rows = useMemo(() => (state.detail ? evidenceRows(state.detail, { now }) : []), [state.detail, now])
  // Display list: a heading whenever the section changes.
  const lines = useMemo(() => {
    const out = []
    let section = null
    for (const r of rows) {
      if (r.section !== section) { section = r.section; out.push({ head: r.section === 'File' ? 'Changed files' : r.section }) }
      out.push(r)
    }
    return out
  }, [rows])
  // The cursor walks the rows only (never a heading), so the selected line always has a source or a why.
  const at = Math.min(cursor, Math.max(0, rows.length - 1))
  const selected = rows[at]
  const selLine = Math.max(0, lines.indexOf(selected))
  const toneColor = { ok: t.ci.pass, bad: t.ci.fail, warn: t.ci.pending, muted: t.ui.muted, plain: undefined }
  const glyph = { ok: '✓', bad: '✗', warn: '◐', muted: ' ', plain: ' ' }

  // Back on screen (the diff opened from here, or an overlay, was closed): the shell kept this view
  // mounted, so the row and the inspected head are as they were. Bring the age up to date and, when
  // the reading went stale meanwhile, read it again behind the rows, still against the inspected head.
  const covered = useCovered()
  const wasCovered = useRef(false)
  const detailRef = useRef(null)
  detailRef.current = state.detail
  useEffect(() => {
    if (covered) { wasCovered.current = true; return }
    if (!wasCovered.current) return
    wasCovered.current = false
    const at0 = Date.now()
    setNow(at0)
    if (detailRef.current && freshness(detailRef.current.record?.fetched_at, at0).stale) setReload(n => n + 1)
  }, [covered, setNow])

  const goBack = () => {
    if (returnTo && onReturn) onReturn(returnTo)
    else onClose()
  }

  useInput((input, k) => {
    if (matchesAction('dialog.cancel', input, k)) { goBack(); return }
    if (matchesAction('cursor.down', input, k)) { setCursor(c => Math.min(rows.length - 1, c + 1)); return }
    if (matchesAction('cursor.up', input, k)) { setCursor(c => Math.max(0, c - 1)); return }
    if (matchesAction('list.refresh', input, k)) { force.current = true; setReload(n => n + 1); return }
    if (matchesAction('pr.open-selected', input, k) && onOpenDetail) { onOpenDetail(); return }
    if (matchesAction('pr.diff', input, k) && onOpenDiff) onOpenDiff(pr)
  })

  const detail = state.detail
  const rec = detail?.record
  const fresh = rec ? freshness(rec.fetched_at, now) : null
  const banners = []
  if (state.phase === 'ok' && detail) {
    if (detail.head.state === 'stale') banners.push({ id: 'head', tone: 'bad', words: '✗ The head changed since you opened this. What you read earlier no longer applies.' })
    if (state.refreshError) banners.push({ id: 'refresh', tone: 'bad', words: `✗ Refresh failed: ${sanitizeRaw(classifyGhFailure(state.refreshError)?.cause || 'gh error')} Showing the reading from ${ageText(fresh?.age_ms)}.` })
    else if (fresh?.stale && !state.refreshing) banners.push({ id: 'age', tone: 'warn', words: `◐ Read ${ageText(fresh.age_ms)}, older than a minute: ${firstActionKey('list.refresh', 'r')} reads it again before you rely on it.` })
  }
  // Frame rows outside the list: border 3, banners, why 2, source 1, boundary 1, footer 1, shell 2.
  const height = Math.max(4, (stdout?.rows || 24) - 11 - banners.length)
  const start = Math.max(0, Math.min(selLine - Math.floor(height / 2), lines.length - height))
  const win = lines.slice(start, start + height)
  const rowAge = selected?.fetched_at ? ageText(now - Date.parse(selected.fetched_at)) : null
  const sourceLine = selected?.source
    ? `source ${sanitizeRaw(selected.source)}, read ${sanitizeRaw(selected.fetched_at || '')}${rowAge && rowAge !== 'time unknown' ? ` (${rowAge})` : ''}`
    : selected?.untrusted ? 'written by the PR author or a commenter, not verified' : ' '

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" borderColor={t.ui.border} paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold wrap="truncate">Evidence  {sanitize(repo)}#{pr.number}</Text>
        {rec && <Text color={t.ui.muted}>{state.refreshing ? 'reading…  ' : ''}{sanitize(String(rec.facts.state.value))}  read-only</Text>}
      </Box>
      {state.phase === 'loading' && (
        <Box paddingX={1} gap={1}><Spinner /><Text color={t.ui.muted}>Reading the review evidence…</Text></Box>
      )}
      {state.phase === 'error' && (
        <Box paddingX={2} paddingY={1}><FailureNotice failure={classifyGhFailure(state.error)} /></Box>
      )}
      {state.phase === 'ok' && detail && (
        <>
          {banners.map(b => (
            <Box key={b.id} paddingX={1}><Text color={b.tone === 'bad' ? t.ci.fail : t.ci.pending} bold wrap="truncate">{b.words}</Text></Box>
          ))}
          <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
            {win.map((l, i) => {
              if (l.head) return <Text key={`h${start + i}`} color={t.ui.selected} bold wrap="truncate">{sanitize(l.head)}</Text>
              const sel = l === selected
              return (
                <Box key={`r${start + i}`} gap={1}>
                  <Box flexShrink={0}><Text color={sel ? t.ui.selected : t.ui.dim}>{sel ? '>' : ' '}</Text></Box>
                  <Box flexShrink={0}><Text color={toneColor[l.tone]}>{glyph[l.tone]}</Text></Box>
                  <Box flexShrink={0}><Text color={sel ? t.ui.selected : t.ui.muted} wrap="truncate">{l.label.padEnd(18)}</Text></Box>
                  <Text color={toneColor[l.tone]} wrap="truncate">{l.value}</Text>
                </Box>
              )
            })}
          </Box>
          <Box paddingX={1} height={2} flexShrink={0} overflow="hidden">
            <Text color={t.ui.muted} wrap="wrap">{selected?.explain ? `why: ${selected.explain}` : ' '}</Text>
          </Box>
          <Box paddingX={1} flexShrink={0}>
            <Text color={t.ui.dim} wrap="truncate">{sourceLine}</Text>
          </Box>
        </>
      )}
      <Box paddingX={1}>
        <Text color={t.ui.dim} wrap="truncate">Observation only. It does not approve, merge or authorize anything. No AI was used.</Text>
      </Box>
      <Box paddingX={1}>
        <Text color={t.ui.dim} wrap="truncate">{hintLine([['cursor.down', 'scroll'], ['list.refresh', 'refresh'], ['pr.diff', 'diff'], ...(onOpenDetail ? [['pr.open-selected', 'PR detail']] : [])])}  Esc {returnTo?.view && onReturn ? `back to ${sanitize(returnTo.view)}` : 'close'}</Text>
      </Box>
    </Box>
  )
}
