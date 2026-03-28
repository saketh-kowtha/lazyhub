/**
 * src/features/gists/index.jsx — Gist browser pane
 *
 * Props:
 *   listHeight   number   — visible row count from App
 *   onPaneState  fn({loading, error, count})
 */

import React, { useState, useCallback, useEffect, useContext, useRef } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { format } from 'timeago.js'
import { useGh } from '../../hooks/useGh.js'
import { listGists, getGist, createGist, deleteGist } from '../../executor.js'
import { FuzzySearch } from '../../components/dialogs/FuzzySearch.jsx'
import { ConfirmDialog } from '../../components/dialogs/ConfirmDialog.jsx'
import { FormCompose } from '../../components/dialogs/FormCompose.jsx'
import { LogViewer } from '../../components/dialogs/LogViewer.jsx'
import { AppContext } from '../../app.jsx'
import { t } from '../../theme.js'

// ─── GistList ─────────────────────────────────────────────────────────────────

export function GistList({ listHeight = 10, onPaneState }) {
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const visibleHeight = listHeight || Math.max(5, (stdout?.rows || 24) - 8)

  // Gists are user-scoped, no repo arg
  const { data: gists, loading, error, refetch } = useGh(listGists, [])
  const [cursor, setCursor] = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog] = useState(null)
  const [viewContent, setViewContent] = useState(null) // { lines: string[], title: string }
  const [statusMsg, setStatusMsg] = useState(null)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const items = gists || []

  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length })
  }, [loading, error, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    notifyDialog(!!dialog || !!viewContent)
    return () => notifyDialog(false)
  }, [dialog, viewContent, notifyDialog])

  const showStatus = (msg, isError = false) => {
    setStatusMsg({ msg, isError })
    setTimeout(() => setStatusMsg(null), 3000)
  }

  const moveCursor = useCallback((delta) => {
    setCursor(prev => {
      const next = Math.max(0, Math.min(items.length - 1, prev + delta))
      if (next < scrollOffset) setScrollOffset(next)
      if (next >= scrollOffset + visibleHeight) setScrollOffset(next - visibleHeight + 1)
      return next
    })
  }, [items.length, scrollOffset, visibleHeight])

  useInput((input, key) => {
    if (dialog || viewContent) return

    // gg → top
    if (input === 'g') {
      if (lastKeyRef.current === 'g') {
        clearTimeout(lastKeyTimer.current)
        lastKeyRef.current = null
        setCursor(0); setScrollOffset(0)
        return
      }
      lastKeyRef.current = 'g'
      lastKeyTimer.current = setTimeout(() => { lastKeyRef.current = null }, 400)
      return
    }
    lastKeyRef.current = null

    // G → bottom
    if (input === 'G') {
      const last = items.length - 1
      setCursor(last); setScrollOffset(Math.max(0, last - visibleHeight + 1))
      return
    }

    if (input === 'j' || key.downArrow) { moveCursor(1);  return }
    if (input === 'k' || key.upArrow)   { moveCursor(-1); return }
    if (input === 'r') { refetch(); return }
    if (input === '/') { setDialog('fuzzy'); return }
    if (input === 'n') { setDialog('new'); return }

    if (loading || items.length === 0) return
    const gist = items[cursor]
    if (!gist) return

    if (key.return) {
      // View gist content
      getGist(gist.id)
        .then(raw => {
          const content = typeof raw === 'string' ? raw : JSON.stringify(raw, null, 2)
          setViewContent({ lines: content.split('\n'), title: gist.description || gist.id })
        })
        .catch(err => showStatus(`✗ Failed to load: ${err.message}`, true))
      return
    }

    if (input === 'D') { setDialog('delete'); return }

    if (input === 'y') {
      const url = `https://gist.github.com/${gist.id}`
      import('execa').then(({ execa }) => {
        const [cmd, args] = process.platform === 'darwin'
          ? ['pbcopy', []]
          : ['xclip', ['-selection', 'clipboard']]
        const proc = execa(cmd, args)
        proc.stdin?.end(url)
        proc.then(() => showStatus(`✓ Copied ${url}`)).catch(() => showStatus('✗ Copy failed', true))
      })
      return
    }
  })

  // ── LogViewer for gist content ──
  if (viewContent) {
    return (
      <LogViewer
        lines={viewContent.lines}
        title={viewContent.title}
        onClose={() => setViewContent(null)}
      />
    )
  }

  // ── Dialogs ──
  const selectedGist = items[cursor]

  if (dialog === 'fuzzy') {
    return (
      <FuzzySearch
        items={items}
        searchFields={['description', 'id']}
        onSubmit={(item) => {
          const idx = items.indexOf(item)
          if (idx !== -1) {
            setCursor(idx)
            setScrollOffset(Math.max(0, idx - Math.floor(visibleHeight / 2)))
          }
          setDialog(null)
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'new') {
    return (
      <FormCompose
        title="Create new gist"
        fields={[
          { name: 'description', label: 'Description', type: 'text' },
          { name: 'filename',    label: 'Filename (e.g. snippet.js)', type: 'text' },
          { name: 'content',     label: 'Content (e to open $EDITOR)', type: 'multiline' },
          { name: 'public',      label: 'Public? (type "yes" to make public)', type: 'text' },
        ]}
        onSubmit={async (values) => {
          setDialog(null)
          if (!values.filename || !values.content) {
            showStatus('✗ Filename and content are required', true)
            return
          }
          try {
            await createGist(
              values.description || '',
              { [values.filename]: values.content },
              values.public?.toLowerCase() === 'yes',
            )
            showStatus('✓ Gist created')
            refetch()
          } catch (err) {
            showStatus(`✗ ${err.message}`, true)
          }
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  if (dialog === 'delete' && selectedGist) {
    return (
      <ConfirmDialog
        message={`Delete gist ${selectedGist.id.slice(0, 8)}? (${selectedGist.description || 'no description'})`}
        destructive={true}
        onConfirm={async () => {
          setDialog(null)
          try {
            await deleteGist(selectedGist.id)
            showStatus(`✓ Deleted gist ${selectedGist.id.slice(0, 8)}`)
            refetch()
          } catch (err) {
            showStatus(`✗ ${err.message}`, true)
          }
        }}
        onCancel={() => setDialog(null)}
      />
    )
  }

  // ── List view ──
  const visibleItems = items.slice(scrollOffset, scrollOffset + visibleHeight)

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box paddingX={1} gap={1}>
        <Text color={t.ui.dim}>gists</Text>
        {statusMsg && (
          <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}>{statusMsg.msg}</Text>
        )}
      </Box>

      {loading && (
        <Box paddingX={2}><Text color={t.ui.muted}>Loading gists…</Text></Box>
      )}
      {error && (
        <Box paddingX={2}><Text color={t.ci.fail}>⚠ Failed to load — r to retry</Text></Box>
      )}
      {!loading && !error && items.length === 0 && (
        <Box paddingX={2} paddingY={1}>
          <Text color={t.ui.muted}>No gists found. [n] create one</Text>
        </Box>
      )}

      {visibleItems.map((gist, i) => {
        const idx = scrollOffset + i
        const isSelected = idx === cursor
        const icon = gist.public ? '🔓' : '🔒'
        const shortId = (gist.id || '').slice(0, 8)
        const desc = gist.description || '(no description)'
        const timeStr = gist.updatedAt ? format(gist.updatedAt) : ''

        return (
          <Box
            key={gist.id || idx}
            paddingX={1}
            backgroundColor={isSelected ? t.ui.headerBg : undefined}
          >
            <Text>{icon} </Text>
            <Text color={t.ui.dim}>{shortId} </Text>
            <Text
              color={isSelected ? t.ui.selected : undefined}
              wrap="truncate"
              flexGrow={1}
            >
              {desc}
            </Text>
            <Text color={t.ui.dim}> {timeStr}</Text>
          </Box>
        )
      })}

      {items.length > visibleHeight && (
        <Box paddingX={1}>
          <Text color={t.ui.dim}>
            {scrollOffset + 1}–{Math.min(scrollOffset + visibleHeight, items.length)} / {items.length}
          </Text>
        </Box>
      )}

      <Box paddingX={1} gap={2} marginTop={1}>
        <Text color={t.ui.dim}>[j/k] nav</Text>
        <Text color={t.ui.dim}>[Enter] view</Text>
        <Text color={t.ui.dim}>[n] new</Text>
        <Text color={t.ui.dim}>[D] delete</Text>
        <Text color={t.ui.dim}>[y] copy URL</Text>
        <Text color={t.ui.dim}>[r] refresh</Text>
        <Text color={t.ui.dim}>[/] search</Text>
      </Box>
    </Box>
  )
}
