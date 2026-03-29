/**
 * src/features/logs/index.jsx — In-app structured log viewer
 */

import React, { useState, useMemo, useEffect, useContext } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { format } from 'timeago.js'
import { getLogs, logger, TextInput, copyToClipboard } from '../../utils.js'
import { useTheme } from '../../theme.js'
import { AppContext } from '../../context.js'

const LEVELS = ['ALL', 'INFO', 'WARN', 'ERROR', 'DEBUG']

export function LogPane({ onBack }) {
  const { t } = useTheme()
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const rows = stdout?.rows || 24

  const [allLogs, setAllLogs] = useState([])
  const [filterLevel, setFilterLevel] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [selectedLog, setSelectedLog] = useState(null)
  const [copyStatus, setCopyStatus] = useState(null)

  const doCopy = (log) => {
    copyToClipboard(JSON.stringify(log, null, 2))
      .then(() => { setCopyStatus('✓ Copied'); setTimeout(() => setCopyStatus(null), 2000) })
      .catch(() => { setCopyStatus('✗ Copy failed'); setTimeout(() => setCopyStatus(null), 2000) })
  }

  const refreshLogs = () => {
    setAllLogs(getLogs())
  }

  useEffect(() => {
    refreshLogs()
    const id = setInterval(refreshLogs, 5000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    notifyDialog(!!(searching || selectedLog))
    return () => notifyDialog(false)
  }, [searching, selectedLog, notifyDialog])

  const filteredLogs = useMemo(() => {
    return allLogs.filter(log => {
      if (filterLevel !== 'ALL' && log.level !== filterLevel) return false
      if (searchQuery) {
        const q = searchQuery.toLowerCase()
        const match = log.message?.toLowerCase().includes(q) || 
                      log.level?.toLowerCase().includes(q) ||
                      log.component?.toLowerCase().includes(q) ||
                      log.error?.toLowerCase().includes(q)
        if (!match) return false
      }
      return true
    })
  }, [allLogs, filterLevel, searchQuery])

  const visibleHeight = Math.max(5, rows - 6)
  const maxScroll = Math.max(0, filteredLogs.length - visibleHeight)

  useInput((input, key) => {
    if (selectedLog) {
      if (input === 'y') { doCopy(selectedLog); return }
      if (key.escape || input === 'q') { setSelectedLog(null); return }
      return
    }

    if (searching) {
      if (key.escape) { setSearching(false); setSearchQuery(''); return }
      if (key.return) { setSearching(false); return }
      return
    }

    if (input === 'r') { refreshLogs(); return }
    if (input === 'f') {
      const idx = LEVELS.indexOf(filterLevel)
      setFilterLevel(LEVELS[(idx + 1) % LEVELS.length])
      setCursor(0); setScrollOffset(0)
      return
    }
    if (input === '/') { setSearching(true); return }
    if (key.escape || input === 'q') { onBack(); return }

    if (input === 'j' || key.downArrow) {
      setCursor(c => {
        const next = Math.min(filteredLogs.length - 1, c + 1)
        if (next >= scrollOffset + visibleHeight) setScrollOffset(next - visibleHeight + 1)
        return next
      })
    }
    if (input === 'k' || key.upArrow) {
      setCursor(c => {
        const next = Math.max(0, c - 1)
        if (next < scrollOffset) setScrollOffset(next)
        return next
      })
    }
    if (input === 'y' && filteredLogs[cursor]) {
      doCopy(filteredLogs[cursor])
      return
    }
    if (key.return && filteredLogs[cursor]) {
      setSelectedLog(filteredLogs[cursor])
    }
  })

  if (selectedLog) {
    return (
      <Box flexDirection="column" borderStyle="round" borderColor={t.ui.selected} paddingX={1}>
        <Box justifyContent="space-between">
          <Text color={t.ui.selected} bold>Log Details</Text>
          {copyStatus && <Text color={copyStatus.startsWith('✓') ? t.ci.pass : t.ci.fail}>{copyStatus}</Text>}
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text color={t.ui.dim}>Time:  <Text color={t.ui.muted}>{selectedLog.timestamp}</Text></Text>
          <Text color={t.ui.dim}>Level: <Text color={levelColor(selectedLog.level, t)}>{selectedLog.level}</Text></Text>
          <Text color={t.ui.dim}>Msg:   <Text color={t.ui.selected}>{selectedLog.message}</Text></Text>
          {Object.entries(selectedLog).map(([k, v]) => {
            if (['timestamp', 'level', 'message'].includes(k)) return null
            return (
              <Text key={k} color={t.ui.dim}>{k.padEnd(6)}: <Text color={t.ui.muted}>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</Text></Text>
            )
          })}
        </Box>
        <Box marginTop={1}>
          <Text color={t.ui.dim}>[y] copy  [Esc/q] close</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box marginBottom={1} justifyContent="space-between" borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderColor={t.ui.border}>
        <Box gap={2}>
          <Text color={t.ui.selected} bold>📋 Debug Logs</Text>
          <Text color={t.ui.dim}>|</Text>
          <Text color={t.ui.dim}>Filter: <Text color={t.ui.selected}>{filterLevel}</Text></Text>
          {searchQuery && <Text color={t.ui.dim}>Search: <Text color={t.ui.selected}>{searchQuery}</Text></Text>}
        </Box>
        <Text color={t.ui.dim}>{filteredLogs.length} entries</Text>
      </Box>

      {searching && (
        <Box borderStyle="round" borderColor={t.ui.selected} paddingX={1} marginBottom={1}>
          <Text color={t.ui.dim}>/</Text>
          <TextInput value={searchQuery} onChange={setSearchQuery} focus={true} />
        </Box>
      )}

      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {filteredLogs.slice(scrollOffset, scrollOffset + visibleHeight).map((log, i) => {
          const idx = scrollOffset + i
          const isSelected = idx === cursor
          return (
            <Box key={idx} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
              <Text color={t.ui.dim}>{log.timestamp.split('T')[1].slice(0, 8)} </Text>
              <Text color={levelColor(log.level, t)} bold width={6}>{log.level.padEnd(6)}</Text>
              <Text color={isSelected ? t.ui.selected : undefined} wrap="truncate" flexGrow={1}>
                {log.message}
              </Text>
              {log.component && <Text color={t.ui.dim}> [{log.component}]</Text>}
            </Box>
          )
        })}
        {filteredLogs.length === 0 && (
          <Text color={t.ui.muted}>  No logs found matching filters.</Text>
        )}
      </Box>

      <Box borderStyle="single" borderTop={true} borderBottom={false} borderLeft={false} borderRight={false} borderColor={t.ui.border} justifyContent="space-between">
        <Text color={t.ui.dim}>[j/k] nav  [Enter] detail  [y] copy  [f] level  [/] search  [r] refresh  [Esc] back</Text>
        {copyStatus && <Text color={copyStatus.startsWith('✓') ? t.ci.pass : t.ci.fail}> {copyStatus}</Text>}
      </Box>
    </Box>
  )
}

function levelColor(level, t) {
  switch (level) {
    case 'ERROR': return t.ci.fail
    case 'WARN':  return t.ci.pending
    case 'INFO':  return t.ui.selected
    case 'DEBUG': return t.ui.dim
    default:      return t.ui.muted
  }
}
