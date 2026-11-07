/**
 * LogViewer.jsx — full-screen scrollable log viewer primitive.
 * Props: lines (string[]), onClose(), title (string, optional), excerpt (optional)
 * With `excerpt` ({ state, detail, excerpt } from loadFailureExcerpt) the viewer opens on a
 * "Failure excerpt" block and `f` switches to the full log and back (#463, #359). The excerpt is
 * already redacted and capped; it is still drawn as untrusted log text. A state other than 'ok'
 * is shown as what it is (expired, too large, ...), never as a guess.
 * Every line is untrusted: it is cleaned (ANSI, TABs, control chars) before it is drawn (#463).
 */

import React, { useState, useMemo } from 'react'
import { Box, Text, useStdout } from 'ink'
import { useInput } from '../../hooks/useSafeInput.js'
import { useTheme } from '../../theme.js'
import { useKeyScope } from '../../keyscope.js'
import { firstActionKey, hintLine, matchesAction } from '../../config/actions.js'
import { cleanLogLine } from '../../utils.js'

const STEP_HEADER_RE = /^(##\s+|Step \d+|^\d{4}-\d{2}-\d{2}.*\s+(##|step)|\s*\d+\.\d+\s)/i

function isStepHeader(line) {
  return STEP_HEADER_RE.test(line) || line.startsWith('##')
}

export function LogViewer({ lines: rawLines = [], onClose, title = 'Log Viewer', excerpt = null }) {
  useKeyScope('dialog')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const visibleHeight = (stdout?.rows || 24) - 6
  const [scrollOffset, setScrollOffset] = useState(0)
  const [filterQuery, setFilterQuery] = useState('')
  const [filtering, setFiltering] = useState(false)
  const [gPressed, setGPressed] = useState(false)
  const [showExcerpt, setShowExcerpt] = useState(Boolean(excerpt))

  const lines = useMemo(() => rawLines.map(cleanLogLine), [rawLines])

  const filteredLines = useMemo(() => {
    if (!filterQuery) return lines
    const lq = filterQuery.toLowerCase()
    return lines.filter(line => line.toLowerCase().includes(lq))
  }, [lines, filterQuery])

  const totalLines = filteredLines.length
  const maxScroll = Math.max(0, totalLines - visibleHeight)
  const visibleLines = filteredLines.slice(scrollOffset, scrollOffset + visibleHeight)

  useInput((input, key) => {
    if (filtering) {
      if (matchesAction('dialog.cancel', input, key) || matchesAction('dialog.confirm', input, key)) {
        setFiltering(false)
        return
      }
      if (key.backspace || key.delete) {
        setFilterQuery(q => q.slice(0, -1))
        return
      }
      if (input && !key.ctrl && !key.meta) {
        setFilterQuery(q => q + input)
      }
      return
    }

    if (matchesAction('dialog.cancel', input, key)) { onClose(); return }

    if (excerpt && matchesAction('log.excerpt', input, key)) {
      setShowExcerpt(v => !v)
      return
    }

    if (showExcerpt) return

    if (matchesAction('log.filter', input, key)) {
      setFiltering(true)
      return
    }

    const topSequenceKey = firstActionKey('cursor.top', 'gg')[0]
    if (input === topSequenceKey) {
      if (gPressed) {
        setScrollOffset(0)
        setGPressed(false)
      } else {
        setGPressed(true)
        setTimeout(() => setGPressed(false), 500)
      }
      return
    }

    if (matchesAction('cursor.bottom', input, key)) {
      setScrollOffset(maxScroll)
      return
    }

    if (matchesAction('cursor.down', input, key)) {
      setScrollOffset(s => Math.min(maxScroll, s + 1))
      return
    }

    if (matchesAction('cursor.up', input, key)) {
      setScrollOffset(s => Math.max(0, s - 1))
      return
    }

    setGPressed(false)
  })

  /** @type {(string | [string, string])[]} */
  const footerHints = [['cursor.down', 'scroll'], 'cursor.top', 'log.filter']
  if (excerpt) footerHints.push(['log.excerpt', 'excerpt'])
  footerHints.push(['dialog.cancel', 'close'])

  if (excerpt && showExcerpt) return <ExcerptView title={title} result={excerpt} />

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" borderColor={t.ui.border} paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold wrap="truncate">{cleanLogLine(title)}</Text>
        <Text color={t.ui.muted}>
          {filterQuery ? `filter: ${filterQuery}  ` : ''}
          {scrollOffset + 1}-{Math.min(scrollOffset + visibleHeight, totalLines)}/{totalLines}
        </Text>
      </Box>
      {filtering && (
        <Box paddingX={1}>
          <Text color={t.ui.muted}>Filter: </Text>
          <Text color={t.ui.selected}>{filterQuery}</Text>
          <Text color={t.ui.dim}>█</Text>
        </Box>
      )}
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {visibleLines.map((line, i) => {
          const isHeader = isStepHeader(line)
          const isSuccess = /✓|success|passed|completed/i.test(line)
          const isFailure = /✗|error|failed|failure/i.test(line)
          const isWarning = /warning|warn/i.test(line)
          let color
          if (isHeader) color = t.ui.selected
          else if (isSuccess) color = t.ci.pass
          else if (isFailure) color = t.ci.fail
          else if (isWarning) color = t.ci.pending
          else color = t.diff.ctxFg
          return (
            <Box key={scrollOffset + i}>
              <Text bold={isHeader} color={color} wrap="truncate">
                {line}
              </Text>
            </Box>
          )
        })}
      </Box>
      <Box borderStyle="single" borderColor={t.ui.border} paddingX={1}>
        <Text color={t.ui.dim}>{hintLine(footerHints)}</Text>
      </Box>
    </Box>
  )
}

/**
 * The "Failure excerpt" block: what failed, where, and the first failure's lines.
 * @param {{ title: string, result: { state: string, detail: string, excerpt: any } }} props
 */
function ExcerptView({ title, result }) {
  const { t } = useTheme()
  const ex = result.excerpt
  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" borderColor={t.ui.border} paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold wrap="truncate">{cleanLogLine(title)}</Text>
        <Text color={t.ui.muted}>Failure excerpt</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} overflow="hidden" paddingX={1}>
        {result.state !== 'ok' || !ex ? (
          <Text color={t.ci.pending} wrap="truncate">{`Failure excerpt unavailable (${cleanLogLine(result.state)}): ${cleanLogLine(result.detail || 'no detail')}`}</Text>
        ) : (
          <>
            <Text color={t.ui.muted} wrap="truncate">
              {[ex.kind && cleanLogLine(ex.kind), ex.job && cleanLogLine(ex.job), ex.step && cleanLogLine(ex.step)].filter(Boolean).join(' · ')}
            </Text>
            {ex.lines.map((line, i) => (
              <Box key={i}><Text color={t.diff.ctxFg} wrap="truncate">{cleanLogLine(line)}</Text></Box>
            ))}
            {ex.truncated && <Text color={t.ui.dim}>… excerpt cut; press f for the full log</Text>}
            {ex.locations.length > 0 && (
              <Text color={t.ui.dim} wrap="truncate">
                {`at ${ex.locations.slice(0, 5).map(l => `${cleanLogLine(l.path)}:${l.line}${l.col ? `:${l.col}` : ''}`).join('  ')}`}
              </Text>
            )}
          </>
        )}
      </Box>
      <Box borderStyle="single" borderColor={t.ui.border} paddingX={1}>
        <Text color={t.ui.dim}>{hintLine([['log.excerpt', 'full log'], ['dialog.cancel', 'close']])}</Text>
      </Box>
    </Box>
  )
}
