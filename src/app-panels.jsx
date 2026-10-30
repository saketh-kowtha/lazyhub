import React from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import { useTheme } from './theme.js'
import { useKeyScope } from './keyscope.js'
import { matchesAction } from './config/actions.js'
import { APP_CONFIG as _config, GLOBAL_KEYS, PANE_ICONS, PANE_LABELS } from './app-keys.js'
import { contextHelpRows } from './ui/actions.js'

// ─── Help overlay — shown on ? from any view ─────────────────────────────────

export function HelpOverlay({ pane, view, actionCtx, onClose, availableWidth, availableHeight }) {
  useKeyScope('overlay')
  const { t } = useTheme()
  const { stdout } = useStdout()
  const cols = stdout?.columns || 80
  const termRows = stdout?.rows || 24
  useInput((input, key) => {
    if (matchesAction('dialog.cancel', input, key, _config.toml) ||
        matchesAction('dialog.confirm', input, key, _config.toml) ||
        matchesAction('app.help', input, key, _config.toml)) onClose()
  })

  const isListView = view === 'list'
  const contextKeys = contextHelpRows(pane, view, actionCtx, _config.toml)
  const contextLabel = isListView
    ? `${PANE_ICONS[pane] || '○'}  ${PANE_LABELS[pane] || pane} list`
    : `${view.charAt(0).toUpperCase()}${view.slice(1)} view`

  // The overlay lives inside the pane area (below the status bar and footer), so it
  // never claims more than the terminal has: width is clamped, and a short terminal
  // clips the lower rows instead of pushing the frame off-screen.
  const compactPad = cols < 60 || termRows < 24
  const roomW = availableWidth ?? cols
  const narrow = roomW < 90
  const roomH = availableHeight ?? termRows
  const outerWidth = Math.max(20, Math.min(roomW - 2, narrow ? 62 : 90))
  const colWidth = Math.max(16, Math.min(40, outerWidth - (compactPad ? 4 : 6)))
  const keyWidth = Math.min(18, Math.max(8, Math.floor(colWidth / 2)))
  const maxHeight = Math.max(6, roomH - 2)

  return (
    <Box flexDirection="column" paddingX={compactPad ? 1 : 2} paddingY={compactPad ? 0 : 1} borderStyle="round" borderColor={t.ui.selected}
         width={outerWidth} maxHeight={maxHeight} overflow="hidden">
      {/* ── Header ── */}
      <Box marginBottom={compactPad ? 0 : 1} justifyContent="space-between" flexShrink={0}>
        <Box gap={1} flexShrink={1} overflow="hidden">
          <Text color={t.ui.selected} bold wrap="truncate">⌨  Keyboard Reference</Text>
          {outerWidth >= 84 && <Text color={t.ui.dim} wrap="truncate">— {contextLabel}</Text>}
        </Box>
        {outerWidth >= 44 && <Text color={t.ui.dim} wrap="truncate">{outerWidth >= 70 ? '[Esc/Enter/?] close' : '[Esc] close'}</Text>}
      </Box>

      <Box flexDirection="row" gap={narrow ? 2 : 4}>
        {/* Context-specific keys */}
        <Box flexDirection="column" width={colWidth}>
          <Box marginBottom={0} flexShrink={0} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderBottom={true} borderColor={t.ui.dim}>
            <Text color={t.ui.muted} bold wrap="truncate">{contextLabel}</Text>
          </Box>
	          <Box flexDirection="column" marginTop={compactPad ? 0 : 1} flexShrink={0}>
	            {contextKeys.length > 0 ? contextKeys.map((k, i) => (
	              <Box key={`${i}:${k.key}`} gap={2} flexShrink={0}>
	                <Box width={keyWidth} flexShrink={0}>
	                  <Text color={t.ui.selected} bold wrap="truncate">{k.key}</Text>
	                </Box>
	                <Text color={t.ui.muted}>{k.label}</Text>
	              </Box>
	            )) : <Text color={t.ui.dim}>No specific keys</Text>}
          </Box>
        </Box>

        {/* Global keys — hidden on narrow terminals */}
        {!narrow && (
          <Box flexDirection="column" width={Math.min(38, colWidth)}>
            <Box marginBottom={0} flexShrink={0} borderStyle="single" borderTop={false} borderLeft={false} borderRight={false} borderBottom={true} borderColor={t.ui.dim}>
              <Text color={t.ui.muted} bold>Global (any view)</Text>
            </Box>
	            <Box flexDirection="column" marginTop={compactPad ? 0 : 1} flexShrink={0}>
	              {GLOBAL_KEYS.map((k, i) => (
	                <Box key={`${i}:${k.key}`} gap={2} flexShrink={0}>
	                  <Box width={keyWidth} flexShrink={0}>
	                    <Text color={t.ui.selected} bold wrap="truncate">{k.key}</Text>
	                  </Box>
	                  <Text color={t.ui.muted}>{k.label}</Text>
	                </Box>
	              ))}
            </Box>
          </Box>
        )}
      </Box>

      {/* ── Config + docs hint ── */}
      <Box marginTop={compactPad ? 0 : 1} flexDirection="column" paddingTop={compactPad ? 0 : 1} flexShrink={0} borderStyle="single" borderBottom={false} borderLeft={false} borderRight={false} borderColor={t.ui.border}>
        <Box gap={1} overflow="hidden" height={1}>
          <Text color={t.ui.dim}>Config:</Text>
          <Text color={t.ui.selected} wrap="truncate">~/.config/lazyhub/lazyhub.toml</Text>
          {!narrow && <Box flexGrow={1} />}
          {!narrow && <Text color={t.ui.dim}>Docs:</Text>}
          {!narrow && <Text color={t.ui.selected}>https://saketh-kowtha.github.io/lgh</Text>}
        </Box>
      </Box>
    </Box>
  )
}

// ─── PR summary panel (right side) ───────────────────────────────────────────

// ─── Pane header ──────────────────────────────────────────────────────────────

export function PaneHeader({ pane, count, loading, error, isStale }) {
  const { t } = useTheme()
  return (
    <Box paddingX={1} paddingY={0} gap={1} flexShrink={0} height={2} overflow="hidden"
         borderStyle="single" borderTop={false} borderLeft={false} borderRight={false}
         borderColor={t.ui.divider}>
      <Text color={t.ui.selected} bold wrap="truncate">{PANE_ICONS[pane] || '✦'}  {PANE_LABELS[pane] || pane}</Text>
      {count != null && !loading && <Text color={t.ui.dim}>{count}</Text>}
      {isStale && <Text color={t.ui.muted} wrap="truncate">⟳ refreshing</Text>}
      {loading && <Text color={t.ui.muted} wrap="truncate">loading…</Text>}
      {error   && (
        <>
          <Box flexShrink={1} overflow="hidden"><Text color={t.ci.fail} wrap="truncate-end">⚠  {error?.message || 'fetch error'}</Text></Box>
          <Text color={t.ci.fail} wrap="truncate">· r retry</Text>
        </>
      )}
    </Box>
  )
}
