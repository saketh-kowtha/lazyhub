/** CommandPalette.jsx — fuzzy command palette overlay for executing actions. */
/**
 * CommandPalette.jsx — fuzzy command palette overlay.
 *
 * Triggered by `:` or `<space><space>` from app.jsx.
 * Fuzzy-searches every action available for the current view context.
 *
 * Props:
 *   context   { pane, view, selectedItem, repo, themeName }
 *   onClose   ()
 *   onNavigate  ({ pane, view, itemNumber, filter })
 *   onTheme   (themeName)
 *   onQuit    ()
 *   themes    string[]
 */

import React, { useState, useMemo, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'
import { useTheme }   from '../theme.js'
import { useKeyScope } from '../keyscope.js'
import { buildActions, filterActions, resolveContext } from '../ui/actions.js'

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * @param {object} props
 * @param {{ pane: string, view: string, selectedItem: object|null, repo: string, themeName?: string }} props.context
 * @param {() => void} props.onClose
 * @param {(opts: object) => void} props.onNavigate
 * @param {(name: string) => void} props.onTheme
 * @param {() => void} [props.onQuit]
 * @param {string[]} props.themes
 */
export function CommandPalette({ context, onClose, onNavigate, onTheme, onQuit, themes }) {
  useKeyScope('dialog')
  const { t } = useTheme()
  const [query, setQuery]   = useState('')
  const [cursor, setCursor] = useState(0)
  const [status, setStatus] = useState(null)

  const { pane, view = 'list', selectedItem, repo, themeName } = context || {}
  const activeContext = useMemo(() => resolveContext(pane, view), [pane, view])

  // Build the full action list once (callbacks are stable via onClose/onNavigate refs)
  const allActions = useMemo(() => buildActions({
    onNavigate: onNavigate || (() => {}),
    onTheme:    onTheme    || (() => {}),
    onClose:    onClose    || (() => {}),
    onQuit:     onQuit     || (() => {}),
    themes:     themes     || [],
  }), [onNavigate, onTheme, onClose, onQuit, themes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Resolve the leading "#<n>" shorthand before fuzzy scoring
  // e.g. "pr 42" → navigate to PR #42; "issue 17" → issue #17
  const handleNumberShorthand = useCallback((q) => {
    const prMatch    = q.match(/^(?:pr\s+|#)(\d+)$/)
    const issueMatch = q.match(/^(?:issue\s+|i\s*)(\d+)$/)
    if (prMatch)    { onNavigate?.({ pane: 'prs',    view: 'detail', itemNumber: parseInt(prMatch[1],    10) }); onClose(); return true }
    if (issueMatch) { onNavigate?.({ pane: 'issues', view: 'detail', itemNumber: parseInt(issueMatch[1], 10) }); onClose(); return true }
    return false
  }, [onNavigate, onClose])

  const filtered = useMemo(() => {
    return filterActions(allActions, query, activeContext, 9)
  }, [allActions, query, activeContext])

  // Keep cursor in bounds when filtered list changes length
  const clampedCursor = Math.min(cursor, Math.max(0, filtered.length - 1))

  useInput((raw, key) => {
    if (key.escape) { onClose(); return }

    if (key.upArrow || (key.ctrl && raw === 'p')) {
      setCursor(c => Math.max(0, c - 1))
      return
    }
    if (key.downArrow || (key.ctrl && raw === 'n')) {
      setCursor(c => Math.min(filtered.length - 1, c + 1))
      return
    }

    if (key.tab) {
      // Autocomplete: fill query with selected action label
      if (filtered[clampedCursor]) {
        setQuery(filtered[clampedCursor].label + ' ')
        setCursor(0)
      }
      return
    }

    if (key.return) {
      // Number shorthand — fast path
      if (handleNumberShorthand(query.trim())) return

      const action = filtered[clampedCursor]
      if (!action) return

      // Pass any trailing text after the action label as _args
      const argsText = query.trim().startsWith(action.label.toLowerCase())
        ? query.trim().slice(action.label.length).trim()
        : ''

      try {
        const result = action.run({ ...context, themeName, _args: argsText })
        if (result && typeof result.then === 'function') {
          setStatus('Running…')
          result
            .then(() => { setStatus('✓ Done'); setTimeout(onClose, 600) })
            .catch(err => { setStatus(`✗ ${err.message ?? String(err)}`); setTimeout(onClose, 2500) })
        }
        // If run() already called onClose() (most navigation actions do), we're done.
        // If not (e.g. async exec actions), the status line will close us.
      } catch (err) {
        setStatus(`✗ ${err.message ?? String(err)}`)
        setTimeout(onClose, 2500)
      }
      return
    }

    if (key.backspace || key.delete) {
      setQuery(s => s.slice(0, -1))
      setCursor(0)
      return
    }

    if (raw && !key.ctrl && !key.meta) {
      setQuery(s => s + raw)
      setCursor(0)
    }
  })

  const MAX_VISIBLE = 9
  const displayedActions = filtered.slice(0, MAX_VISIBLE)

  return (
    <Box flexDirection="column" borderStyle="double" borderColor={t.ui.selected} paddingX={1} paddingY={0}>
      {/* ── Header + query input ── */}
      <Box gap={1} paddingY={0}>
        <Text color={t.ui.selected} bold>▶</Text>
        <Text color={t.ui.selected}>{query || ''}</Text>
        <Text color={t.ui.muted}>▍</Text>
        {status && (
          <Text color={status.startsWith('✓') ? t.ci.pass : t.ci.fail}>{status}</Text>
        )}
        {!status && (
          <Text color={t.ui.dim}>{activeContext}</Text>
        )}
      </Box>

      {/* ── Divider ── */}
      <Box><Text color={t.ui.dim}>{'─'.repeat(46)}</Text></Box>

      {/* ── Filtered action list ── */}
      {displayedActions.length === 0 ? (
        <Box paddingLeft={2}><Text color={t.ui.dim}>No matching actions</Text></Box>
      ) : (
        displayedActions.map((action, i) => {
          const isCursor = i === clampedCursor
          return (
            <Box key={action.id} gap={1}>
              <Text color={isCursor ? t.ui.selected : t.ui.dim}>{isCursor ? '▶' : ' '}</Text>
              <Box width={32}>
                <Text
                  color={isCursor ? t.ui.selected : t.ui.muted}
                  bold={isCursor}
                  wrap="truncate"
                >
                  {action.label}
                </Text>
              </Box>
              {action.hint && (
                <Text color={t.ui.dim} wrap="truncate">
                  {action.hint}
                </Text>
              )}
              {action.keys?.length > 0 && !action.hint && (
                <Text color={t.ui.dim}>[{action.keys.join(', ')}]</Text>
              )}
            </Box>
          )
        })
      )}

      {/* ── Footer hint ── */}
      <Box marginTop={0} paddingTop={0}>
        <Text color={t.ui.dim}>[↑↓/Ctrl+np] nav  [Tab] fill  [Enter] run  [Esc] cancel</Text>
      </Box>
    </Box>
  )
}
