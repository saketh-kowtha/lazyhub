/**
 * WhyRed.jsx — the "Why is CI red?" view (issue #359). Opened with `f` from a PR.
 * Read-only: it fetches logs, file lists and base-branch check history through the
 * typed executor and draws the model from why-red.js. Scrollable, 80x24 safe.
 * All text is cleaned in why-red-rows.js; this file only maps tones to theme tokens.
 */

import React, { useState, useEffect, useMemo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useInput } from '../../hooks/useSafeInput.js'
import { useTheme } from '../../theme.js'
import { useKeyScope } from '../../keyscope.js'
import { hintLine, matchesAction } from '../../config/actions.js'
import * as executor from '../../executor.js'
import { logSwallowed } from '../../contain.js'
import { sanitizeRaw } from '../../utils.js'
import { loadWhyRed } from './why-red.js'
import { whyRedRows } from './why-red-rows.js'

// Resolved when the view opens, so importing this file never touches the executor.
const defaultDeps = () => ({
  getFailedLog: executor.getFailedLog,
  listPRChangedPaths: executor.listPRChangedPaths,
  getPRFilePatch: executor.getPRFilePatch,
  getBaseCheckHistory: executor.getBaseCheckHistory,
})

/**
 * @param {object} props
 * @param {string} props.repo
 * @param {number} props.prNumber
 * @param {string} props.baseBranch
 * @param {any[]} props.checks      rows from getPRChecks
 * @param {() => void} props.onClose
 * @param {() => void} [props.onOpenDiff]
 * @param {ReturnType<typeof defaultDeps>} [props.deps]  injectable for tests
 */
export function WhyRed({ repo, prNumber, baseBranch, checks, onClose, onOpenDiff, deps: depsProp }) {
  const deps = useMemo(() => depsProp || defaultDeps(), [depsProp])
  useKeyScope('dialog')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const height = Math.max(3, (stdout?.rows || 24) - 6)
  const [model, setModel] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [scroll, setScroll] = useState(0)

  useEffect(() => {
    let live = true
    loadWhyRed({ checks, repo, prNumber, baseBranch, deps, onProgress: m => { if (live) setModel(m) } })
      .then(m => { if (live) { setModel(m); setLoading(false) } })
      .catch(err => {
        logSwallowed('prs.why-red.load', err)
        if (live) { setError(sanitizeRaw(err?.message || 'failed to load')); setLoading(false) }
      })
    return () => { live = false }
  }, [checks, repo, prNumber, baseBranch, deps])

  const rows = useMemo(() => whyRedRows(model, { prNumber, loading, error }), [model, prNumber, loading, error])
  const maxScroll = Math.max(0, rows.length - height)
  const shown = rows.slice(scroll, scroll + height)

  useInput((input, key) => {
    if (matchesAction('dialog.cancel', input, key)) { onClose(); return }
    if (onOpenDiff && matchesAction('pr.diff', input, key)) { onOpenDiff(); return }
    if (matchesAction('cursor.bottom', input, key)) { setScroll(maxScroll); return }
    if (matchesAction('cursor.down', input, key)) { setScroll(s => Math.min(maxScroll, s + 1)); return }
    if (matchesAction('cursor.up', input, key)) { setScroll(s => Math.max(0, s - 1)) }
  })

  /** @type {Record<string, string>} */
  const color = {
    title: t.ui.selected, ok: t.ci.pass, fail: t.ci.fail, warn: t.ci.pending, dim: t.ui.dim,
    code: t.diff.ctxFg, unknown: t.ui.muted, text: t.diff.ctxFg, head: t.ui.selected,
  }

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" borderColor={t.ui.border} paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold wrap="truncate">{`Why is CI red? #${Number(prNumber)}`}</Text>
        <Text color={t.ui.muted}>{rows.length > height ? `${scroll + 1}-${Math.min(scroll + height, rows.length)}/${rows.length}` : ''}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
        {shown.map((r, i) => (
          <Box key={scroll + i} paddingLeft={r.indent}>
            <Text color={color[r.tone]} bold={r.tone === 'title' || r.tone === 'head' || r.tone === 'fail'} wrap="truncate">{r.text || ' '}</Text>
          </Box>
        ))}
      </Box>
      <Box borderStyle="single" borderColor={t.ui.border} paddingX={1}>
        <Text color={t.ui.dim} wrap="truncate">{hintLine([['cursor.down', 'scroll'], ...(onOpenDiff ? ['pr.diff'] : []), ['dialog.cancel', 'close']])}</Text>
      </Box>
    </Box>
  )
}
