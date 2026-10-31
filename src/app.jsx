// @ts-nocheck
// TODO(#197): root app state/navigate callbacks need explicit typedefs after split.
/**
 * app.jsx — root Ink layout + renderApp() entry point.
 *
 * Layout (≥100 cols):
 *   ┌─ sidebar 18 ─┐┌─ list (flex) ──────────────────┐┌─ detail 40 ─┐
 *   │              ││                                 ││             │
 *   └──────────────┘└─────────────────────────────────┘└─────────────┘
 *     status bar (1 row)
 *     footer keys (1 row)
 *
 * Layout (<100 cols, ≥80):  sidebar + list only
 * Layout (<80 cols):        list only (sidebar replaced by tab header)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import { render, useInput, useApp } from 'ink'
import { ThemeProvider, useTheme, readRawThemeCfg } from './theme.js'
import { terminalStdout } from './theme/terminal.js'
import { KeyScopeProvider, useActiveScope, useKeyScope } from './keyscope.js'
import { armPrefix, disarmPrefix, getArmedPrefix } from './config/keymap.js'
import { prefixContinuations, registeredPrefixes } from './ui/actions.js'
import { WhichKey } from './ui/WhichKey.jsx'
import { loadConfig, CONFIG_PATH } from './config.js'
import { ConfigProvider } from './config/index.js'
import { takeUnknownActionIds } from './config/loader.js'
import { setConfigWriteNotifier } from './config/writer.js'
import { migrateStateJsonToToml } from './config/migrate.js'
import { useLayout } from './hooks/useLayout.js'
import { AppContext } from './context.js'
import { logger } from './utils.js'
import { emitIPC, startIPC } from './ipc.js'
import { openInEditor } from './editor.js'
import { THEME_NAMES } from './theme.js'
import { matchesAction } from './config/actions.js'
import { writeDebugState } from './debug-state.js'
import { restoreTerminal } from './crash.js'
import { startTimer, recordMeasure, isPerfEnabled } from './perf.js'
import { useGhHealth } from './hooks/useGhHealth.js'


import { APP_CONFIG as _config, PANES } from './app-keys.js'
import { renderAppView } from './app-views.jsx'

const PANE_FOR_GO_ACTION = {
  'go.home': 'home',
  'go.prs': 'prs',
  'go.issues': 'issues',
  'go.branches': 'branches',
  'go.actions': 'actions',
  'go.notifications': 'notifications',
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export function App({ repo }) {
  const { t, setTheme } = useTheme()
  const { exit } = useApp()
  const ghHealth = useGhHealth()
  const pendingInputPerf = useRef([])
  const activeScope = useActiveScope()
  const layout = useLayout()
  const { cols: columns, rows, sidebarWidth, previewWidth, borderStyle, compactFooter, showSidebar, showPreview, listHeight, tooSmall, minCols, minRows } = layout

  // ─── Mouse support ────────────────────────────────────────────────────────
  const [mouseEnabled, setMouseEnabled] = useState(
    _config.mouse === true || process.env.LAZYHUB_MOUSE === '1'
  )

  useEffect(() => {
    if (!mouseEnabled) return
    // Enable mouse button + scroll tracking (X10 + SGR mode)
    process.stdout.write('\x1b[?1000h\x1b[?1002h\x1b[?1015h\x1b[?1006h')
    // Parse mouse events from raw stdin data — runs before readline/Ink sees the bytes
    const handleData = (buf) => {
      const str = buf.toString()
      // SGR mouse: ESC [ < Cb ; Cx ; Cy M/m
      const sgr = str.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/)
      if (!sgr) return
      const btn = parseInt(sgr[1])
      // Scroll up = btn 64, scroll down = btn 65
      if (btn === 64) { process.stdin.emit('keypress', 'k', { name: 'k', sequence: 'k', ctrl: false, meta: false, shift: false }) }
      if (btn === 65) { process.stdin.emit('keypress', 'j', { name: 'j', sequence: 'j', ctrl: false, meta: false, shift: false }) }
    }
    process.stdin.prependListener('data', handleData)
    return () => {
      process.stdout.write('\x1b[?1000l\x1b[?1002l\x1b[?1015l\x1b[?1006l')
      process.stdin.off('data', handleData)
    }
  }, [mouseEnabled])

  // GHUI_PR / GHUI_VIEW — set by nvim :LazyHubPR (or any external launcher)
  // to deep-link directly to a PR's diff view on startup.
  const _initPRNum  = process.env.GHUI_PR  ? parseInt(process.env.GHUI_PR,  10) : null
  const _initView   = process.env.GHUI_VIEW || 'list'
  const _validViews = ['list', 'detail', 'diff', 'comments']

  // GHUI_ISSUE — `lazyhub owner/repo#N` resolved to an issue (#315)
  const _initIssueNum = !_initPRNum && process.env.GHUI_ISSUE ? parseInt(process.env.GHUI_ISSUE, 10) : null

  const [pane, setPane]             = useState(_initPRNum ? 'prs' : _initIssueNum ? 'issues' : _config.defaultPane)
  const [view, setView]             = useState(
    _initPRNum && _validViews.includes(_initView) ? _initView : _initIssueNum ? 'detail' : 'list'
  )
  const [selectedItem, setSelectedItem] = useState(
    _initPRNum && !isNaN(_initPRNum) ? { number: _initPRNum }
      : _initIssueNum && !isNaN(_initIssueNum) ? { number: _initIssueNum } : null
  )
  const [showHelp, setShowHelp]         = useState(false)
  const [showAI, setShowAI]             = useState(false)
  const [paneState, setPaneState]       = useState({})
  const [appMode, setAppMode]           = useState('NORMAL')
  const [toasts, setToasts]             = useState([])
  const [recentStatus, setRecentStatus] = useState([])
  const [showPalette, setShowPalette]   = useState(false)
  const [leaderActive, setLeaderActive] = useState(false)
  const leaderTimerRef = useRef(null)
  // Which-key popup for an armed prefix key such as `g` (#312)
  const [prefixPopup, setPrefixPopup] = useState(null)
  const prefixTimerRef = useRef(null)

  const addToast = useCallback(({ message, variant = 'info', durationMs }) => {
    const id = Date.now() + Math.random()
    setRecentStatus(prev => [...prev.slice(-4), { message, variant, at: new Date().toISOString() }])
    setToasts(prev => [...prev.slice(-2), { id, message, variant }])
    if (variant !== 'error') {
      const ttl = durationMs ?? (variant === 'success' ? 2500 : variant === 'warning' ? 4000 : 3000)
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), ttl)
    }
  }, [])

  // Unknown action ids in the user's keymaps used to land only in debug.log (#475).
  useEffect(() => {
    const ids = takeUnknownActionIds()
    if (ids.length > 0) {
      addToast({ message: `lazyhub.toml: unknown action id${ids.length > 1 ? 's' : ''} ignored: ${ids.join(', ')}`, variant: 'warning', durationMs: 8000 })
    }
  }, [addToast])

  // A failed config save (e.g. lazyhub.toml has a syntax error) becomes a visible notice (#435).
  useEffect(() => {
    setConfigWriteNotifier((message) => addToast({ message, variant: 'error' }))
    return () => setConfigWriteNotifier(null)
  }, [addToast])

  const dialogActiveRef    = useRef(false)
  const savedListPosition  = useRef({})
  const pendingNavigationRef = useRef(null)
  const paneStateMapRef    = useRef(new Map())
  const notifyDialog = useCallback((active) => { dialogActiveRef.current = active }, [])
  const openHelp     = useCallback(() => setShowHelp(true), [])
  const openAI       = useCallback(() => setShowAI(true), [])

  const appCtx = { notifyDialog, openHelp, openAI, setMouseEnabled, addToast, paneStateMap: paneStateMapRef.current }

  const dumpDebugState = useCallback(() => {
    try {
      const { path } = writeDebugState({
        activePane: pane,
        view,
        itemNumber: selectedItem?.number ?? null,
        filters: paneState.filters || paneState.filter || {},
        cursors: {
          selectedIndex: paneState.selectedIndex ?? null,
          cursor: paneState.cursor ?? null,
          count: paneState.count ?? null,
        },
        dialog: paneState.dialogHint || (dialogActiveRef.current ? 'active' : null),
        mode: appMode,
        recentStatus,
      })
      addToast({ message: `Debug state written: ${path}`, variant: 'success', durationMs: 5000 })
    } catch (err) {
      addToast({ message: `Debug state failed: ${err.message}`, variant: 'error' })
    }
  }, [addToast, appMode, pane, paneState, recentStatus, selectedItem, view])

  // ─── IPC state broadcast ──────────────────────────────────────────────────
  useEffect(() => {
    const ipcState = {
      repo:        process.env.GHUI_REPO || null,
      pane,
      view,
      prNumber:    (pane === 'prs' && selectedItem) ? selectedItem.number : null,
      issueNumber: (pane === 'issues' && selectedItem) ? selectedItem.number : null,
    }
    emitIPC('view-changed', ipcState)
  }, [pane, view, selectedItem])

  // ─── Layout (via useLayout hook) ─────────────────────────────────────────
  const showDetailPanel  = false
  const detailPanelWidth = 0

  // ─── AI navigate callback ─────────────────────────────────────────────────
  const handleAINavigate = useCallback(({ pane: tp, view: tv, itemNumber, filter } = {}) => {
    setShowAI(false)
    const validPane = PANES.includes(tp) ? tp : null
    if (validPane) {
      setPane(validPane)
      setActionsTarget({ repo: null, branch: null })
      savedListPosition.current = {}
      pendingNavigationRef.current = { itemNumber, filter }
      // "Go to PR/issue #N" and "open diff" carry a view + item number (B-86).
      const num = Number.isInteger(itemNumber) && itemNumber > 0 ? itemNumber : null
      const canOpen = num != null && (
        (validPane === 'prs' && (tv === 'detail' || tv === 'diff')) ||
        (validPane === 'issues' && tv === 'detail')
      )
      if (canOpen) {
        setSelectedItem({ number: num })
        setView(tv)
      } else {
        setSelectedItem(null)
        setView('list')
      }
    }
  }, [PANES]) // eslint-disable-line react-hooks/exhaustive-deps

  // go.* actions (g p, g i, ...) and the digit keys (app.jump-pane) jump to a pane.
  const goToPane = useCallback((target) => {
    const resolved = target === 'home' ? (PANES.includes('focus') ? 'focus' : PANES[0]) : target
    if (!PANES.includes(resolved) || resolved === pane) return
    setPane(resolved)
    setSelectedItem(null); setView('list')
    setActionsTarget({ repo: null, branch: null })
  }, [pane]) // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Global key handler ───────────────────────────────────────────────────
  useInput((input, key) => {
    if (isPerfEnabled()) pendingInputPerf.current.push(startTimer())
    if (process.env.LAZYHUB_CRASH_TEST === '1' && ((key.ctrl && input === '_') || input === '\x1f')) {
      throw new Error('LAZYHUB_CRASH_TEST crash')
    }
    // Ctrl+A: open AI assistant (always fires regardless of scope)
    if (matchesAction('app.ai-assistant', input, key, _config.toml)) { setShowAI(true); return }
    if (matchesAction('debug.dump-state', input, key, _config.toml)) { dumpDebugState(); return }

    // Dismiss sticky error toasts on any key
    if (toasts.some(t => t.variant === 'error')) {
      setToasts(prev => prev.filter(t => t.variant !== 'error'))
      return
    }

    // Only handle global keys when no higher-priority scope has captured input.
    // Scope stack: global(0) < pane(1) < view(2) < overlay(3) < dialog(4) < input(5)
    // At pane level, Tab/number/? are still valid (list pane doesn't block them).
    // At view/overlay/dialog/input, we must defer — EXCEPT for q/Esc when no
    // component at the active scope handles it (see below).
    const inView = activeScope === 'view' || activeScope === 'detail'
    const highScope = activeScope !== 'global' && activeScope !== 'pane' && activeScope !== 'list' && !inView
    if (highScope || dialogActiveRef.current) {
      // q/Esc from the list view (pane scope active) should always quit/back.
      // This is the lazygit convention.  We allow it through even at 'view' scope
      // only when the view is one of the static shell views (settings/logs) that
      // don't have their own useInput 'q' handlers and don't claim a scope — so
      // their activeScope falls back to whatever the last list pane pushed.
      // Concrete case: user is in list → presses S (opens settings) → presses q.
      // Settings mounts without claiming a scope, so activeScope is still 'pane'.
      // highScope is false for 'pane', so this block isn't even entered.
      // The only problematic case would be if some intermediate component
      // incorrectly pushes 'view' scope while settings/logs are shown.
      return
    }

    // Prefix keys (g): the next key picks a continuation from the registry.
    const armed = getArmedPrefix()
    if (armed) {
      clearTimeout(prefixTimerRef.current)
      disarmPrefix()
      setPrefixPopup(null)
      if (key.escape) return
      const hit = prefixContinuations(armed.prefix, pane, view).find(c => c.global && c.key === input)
      if (hit) goToPane(PANE_FOR_GO_ACTION[hit.actionId])
      return
    }
    if (input && !key.ctrl && !key.meta && !showHelp && registeredPrefixes(_config.toml).has(input)) {
      const items = prefixContinuations(input, pane, view)
      armPrefix(input, items.filter(c => c.global).map(c => c.key))
      setPrefixPopup({ prefix: input, items })
      clearTimeout(prefixTimerRef.current)
      prefixTimerRef.current = setTimeout(() => { disarmPrefix(); setPrefixPopup(null) }, 1500)
      return
    }

    // 1-9: jump straight to the Nth active pane, from list views only (#450). Detail,
    // diff, comments and settings keep their own keys, and a digit after the <Space>
    // leader never jumps. Dialogs, inputs and overlays were filtered out above.
    if (!showHelp && !leaderActive && view === 'list' && matchesAction('app.jump-pane', input, key, _config.toml)) {
      const target = PANES[Number(input) - 1]
      if (target) goToPane(target)
      return
    }

    // Inside a full-screen view only help and the palette are global; every
    // other key belongs to the view.
    if (inView) {
      if (matchesAction('app.help', input, key, _config.toml)) { setShowHelp(v => !v); return }
      if (matchesAction('command-palette.open', input, key, _config.toml)) {
        setShowPalette(true)
        setAppMode('COMMAND')
      }
      return
    }

    if (matchesAction('app.back', input, key, _config.toml)) {
      if (showHelp)              { setShowHelp(false); return }
      if (view === 'settings')   { setView('list'); return }
      if (view === 'logs')       { setView('list'); return }
      if (view === 'comments')   { setView('diff'); return }
      if (view === 'conflict')   { setView('detail'); return }
      if (view === 'diff')       { setView(selectedItem?._fromList ? 'list' : 'detail'); return }
      if (view === 'detail')     { setSelectedItem(null); setView('list'); return }
      // At the root only `q` quits; a stray Esc must never kill the app.
      if (!key.escape) exit()
      return
    }

    if (matchesAction('app.help', input, key, _config.toml)) { setShowHelp(v => !v); return }

    // Help overlay eats everything else
    if (showHelp) { setShowHelp(false); return }

    if (matchesAction('app.next-pane', input, key, _config.toml) || matchesAction('app.prev-pane', input, key, _config.toml)) {
      const idx = PANES.indexOf(pane)
      setPane(PANES[matchesAction('app.prev-pane', input, key, _config.toml)
        ? (idx - 1 + PANES.length) % PANES.length
        : (idx + 1) % PANES.length
      ])
      setSelectedItem(null); setView('list')
      setActionsTarget({ repo: null, branch: null })
      return
    }

    if (matchesAction('app.settings', input, key, _config.toml)) { setView('settings'); setSelectedItem(null); return }
    if (matchesAction('app.open-config', input, key, _config.toml)) { openInEditor(CONFIG_PATH, 1, _config.editor).catch(() => {}); return }
    if (matchesAction('app.logs', input, key, _config.toml) && process.env.LAZYHUB_DEBUG === '1') { setView('logs'); setSelectedItem(null); return }

    // V — toggle visual (batch-select) mode skeleton
    if (matchesAction('app.visual-toggle', input, key, _config.toml) && view === 'list') {
      setAppMode(m => m === 'VISUAL' ? 'NORMAL' : 'VISUAL')
      return
    }

    // : — command palette
    if (matchesAction('command-palette.open', input, key, _config.toml)) {
      setShowPalette(true)
      setAppMode('COMMAND')
      return
    }

    // Space — leader key (1500ms window)
    // Second space within the window opens the command palette (<space><space>)
    if (matchesAction('app.leader', input, key, _config.toml)) {
      if (leaderActive) {
        // Double-space: open command palette
        clearTimeout(leaderTimerRef.current)
        setLeaderActive(false)
        setShowPalette(true)
        setAppMode('COMMAND')
        return
      }
      setLeaderActive(true)
      clearTimeout(leaderTimerRef.current)
      leaderTimerRef.current = setTimeout(() => {
        setLeaderActive(false)
      }, 1500)
      return
    }

    // Leader chords (only when leaderActive)
    if (leaderActive) {
      clearTimeout(leaderTimerRef.current)
      setLeaderActive(false)
      if (matchesAction('app.leader-theme', input, key, _config.toml)) { setShowPalette(true); setAppMode('COMMAND'); return }
      if (matchesAction('app.leader-ai', input, key, _config.toml)) { setShowAI(true); return }
      if (matchesAction('app.leader-help', input, key, _config.toml)) { setShowHelp(true); return }
      if (matchesAction('app.leader-recent', input, key, _config.toml)) { /* recent PRs — future */ return }
      return
    }

  })

  useEffect(() => {
    if (!isPerfEnabled() || pendingInputPerf.current.length === 0) return
    const pending = pendingInputPerf.current.splice(0)
    for (const started of pending) recordMeasure('input', 'keypress-render', started)
  })

  // ─── Navigation callbacks ─────────────────────────────────────────────────
  const goToDetail   = useCallback((item) => {
    setSelectedItem(item); setView('detail')
  }, [])
  // The detail pane hands back its own fetched PR; keep the dashboard identity (_repo/_kind) of the item (#493).
  const goToDiff       = useCallback((item) => {
    setSelectedItem(prev => ({ ...item, _kind: item._kind ?? prev?._kind, _repo: item._repo ?? prev?._repo, _fromList: view === 'list' }))
    setView('diff')
  }, [view])
  const goToComments   = useCallback(() => setView('comments'), [])
  // An item opened from a dashboard section can belong to another repo (#493).
  // Local-git views (conflict resolution, checkout) run in the launch directory, so they
  // are only offered for the launch repo. Moving them onto findLocalCheckout (#471) is
  // part of the services layer (#479).
  const itemIsForeign = !!selectedItem?._repo && String(selectedItem._repo).toLowerCase() !== String(repo || '').toLowerCase()
  const goToConflict   = useCallback(() => {
    if (itemIsForeign) {
      addToast({ message: `Conflict resolution needs a local checkout of ${selectedItem._repo}; open it from that repository's clone`, variant: 'error' })
      return
    }
    setView('conflict')
  }, [itemIsForeign, selectedItem, addToast])
  const [actionsTarget, setActionsTarget] = useState({ repo: null, branch: null })
  const goToActions    = useCallback((branch) => {
    setActionsTarget({ repo: selectedItem?._repo || null, branch: branch || null })
    setPane('actions')
    setSelectedItem(null)
    setView('list')
  }, [selectedItem])
  const actionsBranch = actionsTarget.branch
  const actionsRepo = actionsTarget.repo
  const goBack         = useCallback(() => {
    if (view === 'comments') { setView('diff'); return }
    if (view === 'conflict') { setView('detail'); return }
    if (view === 'diff')     { setView(selectedItem?._fromList ? 'list' : 'detail'); return }
    setSelectedItem(null); setView('list')
  }, [view, selectedItem])

  const onPaneState = useCallback((s) => setPaneState(prev => ({ ...prev, ...s })), [])

  // Clear visual mode whenever we leave list view
  useEffect(() => {
    if (view !== 'list' && appMode === 'VISUAL') setAppMode('NORMAL')
  }, [view, appMode])

  const tree = renderAppView({
    actionsBranch, actionsRepo, itemIsForeign, activeScope, appCtx, appMode, borderStyle, columns, compactFooter,
    exit, ghHealth, goBack, goToActions, goToComments, goToConflict, goToDetail,
    goToDiff, handleAINavigate, leaderActive, listHeight, onPaneState, pane,
    paneState, repo, rows, selectedItem, setAppMode, setPane, setSelectedItem,
    setShowAI, setShowHelp, setShowPalette, setTheme, setView, showAI, showHelp,
    showPalette, showSidebar, sidebarWidth, t, toasts, view, tooSmall, minCols, minRows,
  })

  return (
    <>
      {tree}
      {prefixPopup && (
        <WhichKey
          prefix={prefixPopup.prefix}
          items={prefixPopup.items}
          onClose={() => { clearTimeout(prefixTimerRef.current); disarmPrefix(); setPrefixPopup(null) }}
        />
      )}
    </>
  )
}

export function renderApp() {
  const repo = process.env.GHUI_REPO || ''
  migrateStateJsonToToml()

  // Enter alternate screen buffer — terminal restores on exit (like lazygit / vim)
  process.stdout.write('\x1b[?1049h\x1b[H')

  process.on('exit', restoreTerminal)

  const initialTheme = readRawThemeCfg()
  try {
    const { unmount } = render(
      <ConfigProvider>
        <ThemeProvider initialTheme={initialTheme}>
          <KeyScopeProvider>
            <App repo={repo} />
          </KeyScopeProvider>
        </ThemeProvider>
      </ConfigProvider>,
      { stdout: terminalStdout() }
    )

    // When Ink exits (useApp().exit() called), also restore terminal
    // Ink emits its own cleanup; we hook the process 'exit' above which covers it.
    // Store unmount so bootstrap can use it if needed.
    process.env._GHUI_UNMOUNT = '1'
    return unmount
  } catch (err) {
    logger.error('Fatal App Crash', err)
    restoreTerminal()
    process.exit(1)
  }
}
