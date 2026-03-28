/**
 * CustomPane.jsx — generic pane renderer for user-defined tabs.
 *
 * A custom pane is declared in ~/.config/lazyhub/config.json like:
 *
 *   "customPanes": {
 *     "my-deploys": {
 *       "label": "Deployments",
 *       "icon": "▶",
 *       "command": "gh api repos/{repo}/deployments --jq '[.[] | {title:.environment,number:.id,state:.task,updatedAt:.created_at,url:.url}]'",
 *       "actions": { "o": "open" }
 *     }
 *   }
 *
 * The command runs in a shell. Placeholders: {repo}, {owner}, {name}.
 * stdout must be a JSON array. Recommended item fields:
 *   title      — main text (required for a useful display)
 *   number     — short id shown in gutter (optional)
 *   state      — status badge text (optional)
 *   updatedAt  — ISO date shown as time-ago (optional)
 *   url        — used by 'y' copy and 'o' open actions (optional)
 *
 * Built-in actions always available:
 *   j/k / ↑↓  navigate
 *   gg / G    jump top / bottom
 *   r         re-run command
 *   /         fuzzy search (title field)
 *   y         copy .url to clipboard (if present)
 *   o         open .url in browser (if present)
 *
 * User-defined actions (via "actions" key):
 *   Supports action value: "open" (same as o), "copy" (same as y)
 */

import React, { useState, useCallback, useEffect, useContext, useRef } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { format } from 'timeago.js'
import { FuzzySearch } from './dialogs/FuzzySearch.jsx'
import { AppContext } from '../context.js'
import { t } from '../theme.js'

// Resolve {repo}, {owner}, {name} placeholders in a command string
function resolveCommand(cmd, repo) {
  const [owner = '', name = ''] = (repo || '').split('/')
  return cmd
    .replace(/\{repo\}/g, repo || '')
    .replace(/\{owner\}/g, owner)
    .replace(/\{name\}/g, name)
}

function stateColor(state) {
  if (!state) return t.ui.muted
  const s = String(state).toLowerCase()
  if (/open|active|success|ok|pass|running/.test(s)) return t.ci.pass
  if (/fail|error|closed|reject/.test(s))           return t.ci.fail
  if (/pending|wait|queue|in_progress/.test(s))     return t.ci.pending
  return t.ui.muted
}

export function CustomPane({ paneDef, repo, listHeight = 10, onPaneState }) {
  const { notifyDialog } = useContext(AppContext)
  const { stdout } = useStdout()
  const visibleHeight = listHeight || Math.max(5, (stdout?.rows || 24) - 8)

  const [items, setItems]         = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [cursor, setCursor]       = useState(0)
  const [scrollOffset, setScrollOffset] = useState(0)
  const [dialog, setDialog]       = useState(null)
  const [statusMsg, setStatusMsg] = useState(null)
  const lastKeyRef   = useRef(null)
  const lastKeyTimer = useRef(null)

  const showStatus = (msg, isError = false) => {
    setStatusMsg({ msg, isError })
    setTimeout(() => setStatusMsg(null), 3000)
  }

  const fetchItems = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const cmd = resolveCommand(paneDef.command, repo)
      const { execa } = await import('execa')
      const result = await execa('sh', ['-c', cmd], { reject: false })
      if (result.exitCode !== 0) {
        throw new Error(result.stderr?.split('\n')[0] || 'Command failed')
      }
      const data = JSON.parse(result.stdout)
      setItems(Array.isArray(data) ? data : [])
    } catch (err) {
      setError(err.message || String(err))
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [paneDef.command, repo])

  useEffect(() => { fetchItems() }, [fetchItems])

  useEffect(() => {
    if (onPaneState) onPaneState({ loading, error, count: items.length })
  }, [loading, error, items.length]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    notifyDialog(!!dialog)
    return () => notifyDialog(false)
  }, [dialog, notifyDialog])

  const moveCursor = useCallback((delta) => {
    setCursor(prev => {
      const next = Math.max(0, Math.min(items.length - 1, prev + delta))
      if (next < scrollOffset) setScrollOffset(next)
      if (next >= scrollOffset + visibleHeight) setScrollOffset(next - visibleHeight + 1)
      return next
    })
  }, [items.length, scrollOffset, visibleHeight])

  const selectedItem = items[cursor]

  const openInBrowser = useCallback((url) => {
    if (!url) return showStatus('No URL', true)
    import('execa').then(({ execa }) => {
      const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
      execa(cmd, [url]).catch(() => {})
    })
  }, [])

  const copyUrl = useCallback((url) => {
    if (!url) return showStatus('No URL', true)
    import('execa').then(({ execa }) => {
      const [cmd, args] = process.platform === 'darwin'
        ? ['pbcopy', []]
        : ['xclip', ['-selection', 'clipboard']]
      const proc = execa(cmd, args)
      proc.stdin?.end(url)
      proc.then(() => showStatus(`✓ Copied`)).catch(() => showStatus('✗ Copy failed', true))
    })
  }, [])

  useInput((input, key) => {
    if (dialog) return

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

    if (input === 'G') {
      const last = items.length - 1
      setCursor(last); setScrollOffset(Math.max(0, last - visibleHeight + 1))
      return
    }
    if (input === 'j' || key.downArrow) { moveCursor(1);  return }
    if (input === 'k' || key.upArrow)   { moveCursor(-1); return }
    if (input === 'r') { fetchItems(); return }
    if (input === '/') { setDialog('fuzzy'); return }

    if (!selectedItem) return

    // Built-in actions
    if (input === 'y') { copyUrl(selectedItem.url); return }
    if (input === 'o') { openInBrowser(selectedItem.url); return }

    // User-defined actions
    const userActions = paneDef.actions || {}
    if (userActions[input]) {
      const action = userActions[input]
      if (action === 'open')  { openInBrowser(selectedItem.url); return }
      if (action === 'copy')  { copyUrl(selectedItem.url); return }
    }
  })

  // ── Dialogs ───────────────────────────────────────────────────────────────

  if (dialog === 'fuzzy') {
    return (
      <Box flexDirection="column" flexGrow={1}>
        <FuzzySearch
          items={items}
          searchFields={['title', 'number', 'state', 'author']}
          onSubmit={(item) => {
            const idx = items.indexOf(item)
            if (idx !== -1) { setCursor(idx); setScrollOffset(Math.max(0, idx - 2)) }
            setDialog(null)
          }}
          onCancel={() => setDialog(null)}
        />
      </Box>
    )
  }

  // ── List ──────────────────────────────────────────────────────────────────

  const visibleItems = items.slice(scrollOffset, scrollOffset + visibleHeight)

  return (
    <Box flexDirection="column" flexGrow={1}>
      {/* Header bar */}
      <Box paddingX={1} gap={1}>
        <Text color={t.ui.selected} bold>{paneDef.label}</Text>
        {items.length > 0 && <Text color={t.ui.dim}>({items.length})</Text>}
        <Text color={t.ui.dim}>[r] refresh  [/] search  [y] copy url  [o] browser</Text>
        {statusMsg && (
          <Text color={statusMsg.isError ? t.ci.fail : t.ci.pass}> {statusMsg.msg}</Text>
        )}
      </Box>

      {/* Loading */}
      {loading && (
        <Box paddingX={2} paddingY={1}>
          <Text color={t.ui.muted}>Loading {paneDef.label}…</Text>
        </Box>
      )}

      {/* Error */}
      {!loading && error && (
        <Box paddingX={2} paddingY={1} flexDirection="column">
          <Text color={t.ci.fail}>⚠ Command failed — [r] retry</Text>
          <Text color={t.ui.dim}>{error}</Text>
          <Text color={t.ui.dim} dimColor>$ {resolveCommand(paneDef.command, repo)}</Text>
        </Box>
      )}

      {/* Empty state */}
      {!loading && !error && items.length === 0 && (
        <Box paddingX={2} paddingY={1}>
          <Text color={t.ui.muted}>No items returned. [r] re-run</Text>
        </Box>
      )}

      {/* List rows */}
      {!loading && !error && visibleItems.map((item, i) => {
        const idx = scrollOffset + i
        const isSelected = idx === cursor
        const numStr  = item.number != null ? String(item.number).padEnd(5) : '     '
        const state   = item.state || ''
        const title   = item.title || item.name || item.description || JSON.stringify(item).slice(0, 60)
        const timeStr = item.updatedAt ? format(item.updatedAt) : ''

        return (
          <Box key={idx} paddingX={1} backgroundColor={isSelected ? t.ui.headerBg : undefined}>
            <Text color={t.ui.dim} bold>{numStr} </Text>
            {state ? <Text color={stateColor(state)}>{state.slice(0, 8).padEnd(9)}</Text> : null}
            <Text color={isSelected ? t.ui.selected : undefined} wrap="truncate" flexGrow={1}>
              {title}
            </Text>
            {item.author && <Text color={t.ui.muted}> {String(item.author).slice(0, 12).padEnd(12)}</Text>}
            <Text color={t.ui.dim}> {timeStr}</Text>
          </Box>
        )
      })}

      {/* Scroll indicator */}
      {items.length > visibleHeight && (
        <Box paddingX={1}>
          <Text color={t.ui.dim}>
            {scrollOffset + 1}–{Math.min(scrollOffset + visibleHeight, items.length)} / {items.length}
          </Text>
        </Box>
      )}
    </Box>
  )
}
