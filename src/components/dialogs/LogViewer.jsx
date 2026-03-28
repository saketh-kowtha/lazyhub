/**
 * LogViewer.jsx — full-screen scrollable log viewer primitive.
 * Props: lines (string[]), onClose()
 */

import React, { useState, useMemo } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { useTheme } from '../../theme.js'

const STEP_HEADER_RE = /^(##\s+|Step \d+|^\d{4}-\d{2}-\d{2}.*\s+(##|step)|\s*\d+\.\d+\s)/i

function isStepHeader(line) {
  return STEP_HEADER_RE.test(line) || line.startsWith('##')
}

export function LogViewer({ lines = [], onClose }) {
  const { t } = useTheme()
  const { stdout } = useStdout()
  const visibleHeight = (stdout?.rows || 24) - 6
  const [scrollOffset, setScrollOffset] = useState(0)
  const [filterQuery, setFilterQuery] = useState('')
  const [filtering, setFiltering] = useState(false)
  const [gPressed, setGPressed] = useState(false)

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
      if (key.escape || key.return) {
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

    if (key.escape) { onClose(); return }

    if (input === 'f') {
      setFiltering(true)
      return
    }

    if (input === 'g') {
      if (gPressed) {
        setScrollOffset(0)
        setGPressed(false)
      } else {
        setGPressed(true)
        setTimeout(() => setGPressed(false), 500)
      }
      return
    }

    if (input === 'G') {
      setScrollOffset(maxScroll)
      return
    }

    if (input === 'j' || key.downArrow) {
      setScrollOffset(s => Math.min(maxScroll, s + 1))
      return
    }

    if (input === 'k' || key.upArrow) {
      setScrollOffset(s => Math.max(0, s - 1))
      return
    }

    setGPressed(false)
  })

  return (
    <Box flexDirection="column" height="100%">
      <Box borderStyle="single" borderColor={t.ui.border} paddingX={1} justifyContent="space-between">
        <Text color={t.ui.selected} bold>Log Viewer</Text>
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
            <Text key={scrollOffset + i} bold={isHeader} color={color} wrap="truncate">
              {line}
            </Text>
          )
        })}
      </Box>
      <Box borderStyle="single" borderColor={t.ui.border} paddingX={1}>
        <Text color={t.ui.dim}>[j/k] scroll  [gg] top  [G] bottom  [f] filter  [Esc] close</Text>
      </Box>
    </Box>
  )
}
