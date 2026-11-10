// @ts-nocheck
// TODO(#197): extracted app view renderer needs explicit prop typedefs after split.
import React, { memo, useEffect, useRef } from 'react'
import { Box, Text } from 'ink'
import { APP_CONFIG as _config, DIALOG_KEYS, PANES, PANE_ICONS, PANE_LABELS } from './app-keys.js'
import { hintLine } from './config/actions.js'
import { TooSmall } from './components/TooSmall.jsx'
import { TabStrip } from './components/TabStrip.jsx'
import { Shell, LeaderHint } from './shell/Shell.jsx'
import { scopeIndicator } from './shell/scopeIndicator.js'
import { PRList } from './features/prs/list.jsx'
import { PRDetail } from './features/prs/detail.jsx'
import { EvidenceView } from './features/prs/EvidenceView.jsx'
import { returnTarget } from './executor/evidence-detail.js'
import { PRDiff } from './features/prs/diff.jsx'
import { StoryView } from './features/prs/story/StoryView.jsx'
import { PRComments } from './features/prs/comments.jsx'
import { ConflictView } from './features/prs/ConflictView.jsx'
import { IssueList } from './features/issues/list.jsx'
import { IssueDetail } from './features/issues/detail.jsx'
import { BranchList } from './features/branches/index.jsx'
import { ActionList } from './features/actions/index.jsx'
import { SettingsPane } from './features/settings/index.jsx'
import { LogPane } from './features/logs/index.jsx'
import { NotificationList } from './features/notifications/index.jsx'
import { CustomPane } from './components/CustomPane.jsx'
import { TabView } from './features/tabs/view.jsx'
import { ReviewQueue } from './features/queue/view.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { AIAssistant } from './components/AIAssistant.jsx'
import { CommandPalette } from './components/CommandPalette.jsx'
import { RepoSwitcher } from './features/onboarding/Onboarding.jsx'
import { HelpOverlay, PaneHeader } from './app-panels.jsx'
import { THEME_NAMES } from './theme.js'
import { CoveredContext } from './shell/covered.js'
import { navigate } from './shell/navStack.js'
import { createViewStateStore } from './shell/viewState.js'
import { contextFooterHints } from './ui/actions.js'


// Ids are stable per view + item, so a covered layer is found again when navigation comes back to it.
const itemRef = (ctx) => {
  const { selectedItem, repo } = ctx
  return selectedItem ? `${selectedItem._repo || repo}#${selectedItem.number}` : ''
}

/**
 * Which base layer the app is showing: a stable id (the React key of the layer) and whether it is a
 * list pane (a stack root). Mirrors the branch order of buildBaseLayer.
 * @param {object} ctx the App's view context
 * @returns {{ id: string, base: boolean }} layer identity
 */
export function identifyBaseLayer(ctx) {
  const { view, selectedItem, pane, actionsRepo, actionsBranch } = ctx
  const ref = itemRef(ctx)
  if (selectedItem && ['evidence', 'conflict', 'diff', 'story', 'comments'].includes(view)) return { id: `${view}:${ref}`, base: false }
  if (view === 'logs' || view === 'queue' || view === 'settings') return { id: view, base: false }
  if (view === 'detail' && selectedItem) return { id: `detail:${selectedItem._kind || pane}:${ref}`, base: false }
  return { id: pane === 'actions' ? `list:actions:${actionsRepo || ''}:${actionsBranch || ''}` : `list:${pane}`, base: true }
}

// Map dialog names (emitted by list panes) to footer hint sets
const DIALOG_HINT_MAP = {
  'fuzzy':         DIALOG_KEYS.fuzzy,
  'author-search': DIALOG_KEYS.fuzzy,
  'merge':         DIALOG_KEYS.merge,
  'labels':        DIALOG_KEYS.multiselect,
  'assignees':     DIALOG_KEYS.multiselect,
  'reviewers':     DIALOG_KEYS.multiselect,
  'approve-body':  DIALOG_KEYS.compose,
  'reqchanges-body': DIALOG_KEYS.compose,
  'comment-pr':    DIALOG_KEYS.compose,
  'new-pr':        DIALOG_KEYS.compose,
  'close-pr':      DIALOG_KEYS.confirm,
  'checkout':      DIALOG_KEYS.confirm,
  'new-issue':     DIALOG_KEYS.compose,
  'close-issue':   DIALOG_KEYS.confirm,
  'new-branch':    DIALOG_KEYS.fuzzy,
  'delete-branch': DIALOG_KEYS.confirm,
  'cancel-run':    DIALOG_KEYS.confirm,
  'mark-all':      DIALOG_KEYS.confirm,
  'logs':          DIALOG_KEYS.logs,
  'failed-logs':   DIALOG_KEYS.failedLogs,
  // Confirms and forms opened from list panes (#468): same hints as their siblings above.
  'merge-confirm': DIALOG_KEYS.confirm,
  'auto-merge':    DIALOG_KEYS.confirm,
  'close':         DIALOG_KEYS.confirm,
  'delete':        DIALOG_KEYS.confirm,
  'rerun':         DIALOG_KEYS.confirm,
  'cancel':        DIALOG_KEYS.confirm,
  'new':           DIALOG_KEYS.compose,
}

/** What differs per view is passed to <Shell>; the frame itself is defined once there (#488). */
function frameKit(ctx) {
  const {
    actionsBranch, actionsRepo, itemIsForeign, activeScope, appCtx, appMode, borderStyle, columns, compactFooter,
    exit, ghHealth, goBack, goToActions, goToComments, goToConflict, goToDetail, goToPRRow,
    goToDiff, goToQueueItem, goToEvidenceDetail, returnFromEvidence, goToStory, openStoryFile, storyNav, handleAINavigate, leaderActive, listHeight, onPaneState, pane,
    paneState, repo, rows, selectedItem, setAppMode, setPane, setSelectedItem,
    setShowAI, setShowHelp, setShowPalette, setTheme, setView, showAI, showHelp,
    showPalette, showSidebar, sidebarWidth, t, toasts, view, tooSmall, minCols, minRows, termRows,
    showRepoPicker, setShowRepoPicker, onSwitchRepo,
  } = ctx
  const scopeChip = scopeIndicator(activeScope)
  const statusFor = (extra) => ({ repo, pane, count: paneState.count, scopeIndicator: scopeChip, mode: appMode, ghHealth, ...extra })
  const sidebarFor = (onSelect, extra) => showSidebar ? {
    currentPane: pane, visiblePanes: PANES, width: sidebarWidth, borderStyle, paneLabels: PANE_LABELS,
    paneIcons: PANE_ICONS, repo, onSelect, ...extra,
  } : null
  const toList = (p) => { setPane(p); setSelectedItem(null); setView('list') }
  const frame = { appCtx, rows, compactFooter }
  return { statusFor, sidebarFor, toList, frame }
}

/**
 * An overlay (AI, repository picker, command palette, help) or the too-small message, drawn as a
 * layer over the base view, which stays mounted underneath (#597). Null when none is open.
 * @param {object} ctx the App's view context
 * @returns {{ id: string, element: React.ReactElement } | null} the top layer
 */
function buildOverlay(ctx) {
  const {
    actionsBranch, actionsRepo, itemIsForeign, activeScope, appCtx, appMode, borderStyle, columns, compactFooter,
    exit, ghHealth, goBack, goToActions, goToComments, goToConflict, goToDetail, goToPRRow,
    goToDiff, goToQueueItem, goToEvidenceDetail, returnFromEvidence, goToStory, openStoryFile, storyNav, handleAINavigate, leaderActive, listHeight, onPaneState, pane,
    paneState, repo, rows, selectedItem, setAppMode, setPane, setSelectedItem,
    setShowAI, setShowHelp, setShowPalette, setTheme, setView, showAI, showHelp,
    showPalette, showSidebar, sidebarWidth, t, toasts, view, tooSmall, minCols, minRows, termRows,
    showRepoPicker, setShowRepoPicker, onSwitchRepo,
  } = ctx
  const itemRepo = selectedItem?._repo || repo
  const { statusFor, sidebarFor, frame } = frameKit(ctx)
  if (tooSmall) return { id: 'too-small', element: <TooSmall cols={columns} rows={rows} termRows={termRows} minCols={minCols} minRows={minRows} /> }
  // ─── AI assistant overlay ─────────────────────────────────────────────────
  if (showAI) {
    return { id: 'overlay:ai', element: (
      <Shell {...frame} overflow="hidden" bodyProps={{ overflow: 'hidden' }}
        sidebar={sidebarFor((p) => { setPane(p); setShowAI(false); setSelectedItem(null); setView('list') })}
        status={statusFor()}
        footer={[{ key: 'Esc', label: 'close AI' }, { key: 'j/k', label: 'scroll' }, { key: 'Enter', label: 'send' }]}>
        <ErrorBoundary>
          <AIAssistant
            repo={repo}
            pane={pane}
            selectedItem={selectedItem}
            onClose={() => setShowAI(false)}
            onNavigate={handleAINavigate}
            aiConfig={_config.ai}
            rows={rows - 2}
          />
        </ErrorBoundary>
      </Shell>
    ) }
  }
  // ─── Repository picker (palette: Switch repository, #466) ───────────────
  if (showRepoPicker) {
    return { id: 'overlay:repo', element: (
      <Shell {...frame} overflow="hidden" bodyProps={{ overflow: 'hidden', justifyContent: 'center', alignItems: 'flex-start', paddingY: 1 }}
        status={statusFor({ scopeIndicator: null, mode: 'COMMAND' })}>
        <ErrorBoundary>
          <RepoSwitcher onDone={(result) => {
            setShowRepoPicker(false)
            if (result.status === 'completed' && result.repo.toLowerCase() !== String(repo).toLowerCase()) onSwitchRepo?.(result.repo)
          }} />
        </ErrorBoundary>
      </Shell>
    ) }
  }
  // ─── Command palette overlay ──────────────────────────────────────────────
  if (showPalette) {
    return { id: 'overlay:palette', element: (
      <Shell {...frame} overflow="hidden" bodyProps={{ overflow: 'hidden', justifyContent: 'center', alignItems: 'flex-start', paddingY: 2 }}
        status={statusFor({ scopeIndicator: null, mode: 'COMMAND' })}
        footer={[{ key: '↑↓', label: 'nav' }, { key: 'Tab', label: 'complete' }, { key: 'Enter', label: 'run' }, { key: 'Esc', label: 'cancel' }]}>
        <Box width={Math.min(columns - 4, 80)}>
          <CommandPalette
            context={{ pane, view, selectedItem, repo: itemRepo, localGit: !itemIsForeign, themeName: _config.theme, onSwitchRepo: () => setShowRepoPicker(true) }}
            onClose={() => { setShowPalette(false); setAppMode('NORMAL') }}
            onNavigate={(opts) => {
              setShowPalette(false); setAppMode('NORMAL')
              handleAINavigate(opts)
            }}
            onTheme={(name) => { setShowPalette(false); setAppMode('NORMAL'); setTheme(name) }}
            onQuit={() => exit()}
            themes={THEME_NAMES}
          />
        </Box>
      </Shell>
    ) }
  }
  // ─── Help overlay — ? works from every view ──────────────────────────────
  if (showHelp) {
    return { id: 'overlay:help', element: (
      <Shell {...frame} overflow="hidden" bodyProps={{ overflow: 'hidden' }}
        sidebar={sidebarFor((p) => { setPane(p); setShowHelp(false); setSelectedItem(null); setView('list') })}
        status={statusFor()}
        footer={[{ key: '? / Esc / Enter', label: 'close help' }]}>
        <Box flexDirection="column" flexGrow={1} overflow="hidden" justifyContent="center" alignItems="center">
          <HelpOverlay pane={view === 'detail' && selectedItem?._kind ? selectedItem._kind : pane} view={view} actionCtx={paneState.actionCtx} onClose={() => setShowHelp(false)}
            availableWidth={columns - (showSidebar ? sidebarWidth : 0)} availableHeight={rows - (compactFooter ? 1 : 3)} />
        </Box>
      </Shell>
    ) }
  }
  return null
}

/**
 * The base view for the current navigation state.
 * @param {object} ctx the App's view context
 * @param {(state: object) => void} onPaneState the layer's gated pane-state callback
 * @returns {React.ReactElement} the framed view
 */
function buildBaseLayer(ctx, onPaneState) {
  const {
    actionsBranch, actionsRepo, itemIsForeign, activeScope, appCtx, appMode, borderStyle, columns, compactFooter,
    exit, ghHealth, goBack, goToActions, goToComments, goToConflict, goToDetail, goToPRRow,
    goToDiff, goToQueueItem, goToEvidenceDetail, returnFromEvidence, goToStory, openStoryFile, storyNav, handleAINavigate, leaderActive, listHeight, pane,
    paneState, repo, rows, selectedItem, setAppMode, setPane, setSelectedItem,
    setShowAI, setShowHelp, setShowPalette, setTheme, setView, showAI, showHelp,
    showPalette, showSidebar, sidebarWidth, t, toasts, view, tooSmall, minCols, minRows, termRows,
    showRepoPicker, setShowRepoPicker, onSwitchRepo,
  } = ctx
  const itemRepo = selectedItem?._repo || repo
  const { statusFor, sidebarFor, toList, frame } = frameKit(ctx)
  if (view === 'evidence' && selectedItem) {
    const evRepo = itemRepo
    return (
      <Shell {...frame} bodyProps={null}>
        <ErrorBoundary>
          <EvidenceView
            pr={{ number: selectedItem.number, title: selectedItem.title }}
            repo={evRepo}
            onClose={() => returnFromEvidence(selectedItem._fromQueue ? { view: 'queue' } : undefined)}
            onOpenDiff={goToDiff}
            onOpenDetail={goToEvidenceDetail}
            returnTo={selectedItem._fromQueue ? returnTarget({ view: 'queue', key: `${evRepo}#${selectedItem.number}` }) : undefined}
            onReturn={returnFromEvidence}
          />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'conflict' && selectedItem) {
    return (
      <Shell {...frame} bodyProps={{ overflow: 'hidden' }}
        status={statusFor({ repo: itemRepo, count: undefined })}
        footer={[
          { key: 'j/k', label: 'navigate' },
          { key: 'e/Enter', label: 'open editor' },
          { key: 'Space', label: 'stage/unstage' },
          { key: 'c', label: 'commit + push' },
          { key: 'Esc', label: 'back' },
        ]}>
        <ErrorBoundary>
          <ConflictView pr={selectedItem} repo={itemRepo} onBack={goBack} onResolved={() => setView('detail')} />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'diff' && selectedItem) {
    return (
      <Shell {...frame} overflow="hidden" bodyProps={null}>
        <ErrorBoundary>
          <PRDiff
            prNumber={selectedItem.number}
            repo={itemRepo}
            onBack={goBack}
            onViewComments={goToComments}
            initialFile={storyNav?.active ? storyNav.file : undefined}
          />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'story' && selectedItem) {
    return (
      <Shell {...frame} bodyProps={{ flexDirection: 'column', overflow: 'hidden' }}
        status={statusFor({ repo: itemRepo, count: undefined })}
        footer={[
          { key: 'n/p', label: 'step' },
          { key: 'j/k', label: 'file' },
          { key: 'Enter', label: 'open diff' },
          { key: 'Space', label: 'expand' },
          { key: 'Esc', label: 'back' },
        ]}>
        <ErrorBoundary>
          <StoryView prNumber={selectedItem.number} repo={itemRepo} onBack={goBack}
            onOpenFile={openStoryFile} initial={storyNav?.pos} />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'comments' && selectedItem) {
    return (
      <Shell {...frame} overflow="hidden" bodyProps={null}>
        <ErrorBoundary>
          <PRComments
            prNumber={selectedItem.number}
            repo={itemRepo}
            onBack={goBack}
            onJumpToDiff={() => setView('diff')}
          />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'logs') {
    return (
      <Shell {...frame} sidebar={sidebarFor(toList)}
        status={statusFor({ pane: 'logs', count: undefined })}
        footer={[
          { key: 'j/k', label: 'navigate' },
          { key: 'Enter', label: 'detail' },
          { key: 'f', label: 'level' },
          { key: '/', label: 'search' },
          { key: 'Esc', label: 'back' }
        ]}>
        <ErrorBoundary>
          <LogPane onBack={() => setView('list')} />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'queue') {
    return (
      <Shell {...frame} sidebar={sidebarFor(toList)}
        status={statusFor({ count: undefined })}
        footer={contextFooterHints(pane, 'queue', {}, _config.toml)}>
        <ErrorBoundary>
          {/* goToQueueItem is the only place that decides what Enter opens (the evidence view, #127). */}
          <ReviewQueue onOpen={goToQueueItem} innerWidth={columns - (showSidebar ? sidebarWidth : 0) - 2} listHeight={listHeight} />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'settings') {
    return (
      <Shell {...frame} sidebar={sidebarFor(toList)}
        status={statusFor({ pane: 'settings', count: undefined })}
        footer={[
          { key: 'j/k', label: 'navigate' },
          { key: 'Enter', label: 'select' },
          { key: '?', label: 'help' },
          { key: 'Esc', label: 'back' }
        ]}>
        <ErrorBoundary>
          <SettingsPane onBack={() => setView('list')} />
        </ErrorBoundary>
      </Shell>
    )
  }

  if (view === 'detail' && selectedItem) {
    // A dashboard tab (Focus) opens items of either kind; the item says which.
    const detailKind = selectedItem._kind || pane
    const DetailPane = detailKind === 'issues' ? IssueDetail : PRDetail
    const detailFooter = contextFooterHints(detailKind, 'detail', paneState.actionCtx, _config.toml)

    return (
      <Shell {...frame} bodyProps={{ flexDirection: 'column' }}
        status={statusFor({ repo: itemRepo })} footer={detailFooter}>
        <ErrorBoundary>
          <DetailPane
            {...(detailKind === 'issues'
              ? { issueNumber: selectedItem.number }
              : { prNumber: selectedItem.number, baseRefName: selectedItem.baseRefName, entry: selectedItem._entry })}
            repo={itemRepo}
            onBack={goBack}
            onOpenDiff={goToDiff}
            onOpenStory={detailKind === 'prs' ? goToStory : undefined}
            onOpenConflict={detailKind === 'prs' ? goToConflict : undefined}
            onOpenActions={detailKind === 'prs' ? goToActions : undefined}
            onViewComments={detailKind === 'prs' ? goToComments : undefined}
            onPaneState={detailKind === 'prs' ? onPaneState : undefined}
          />
        </ErrorBoundary>
      </Shell>
    )
  }

  // ─── List view ────────────────────────────────────────────────────────────
  // Columns inside the pane border: what every list row may use (the width contract, #512).
  const listInnerWidth = columns - (showSidebar ? sidebarWidth : 0) - 2
  function renderListPane() {
    switch (pane) {
      case 'prs': return (
        <PRList repo={repo} listHeight={listHeight}
          innerWidth={listInnerWidth}
          onSelectPR={goToPRRow}
          onOpenDiff={goToDiff} onPaneState={onPaneState} />
      )
      case 'issues': return (
        <IssueList repo={repo} listHeight={listHeight} innerWidth={listInnerWidth}
          onSelectIssue={goToDetail} onPaneState={onPaneState} />
      )
      case 'branches':     return <BranchList repo={repo} listHeight={listHeight} innerWidth={listInnerWidth} onPaneState={onPaneState} />
      case 'actions':      return <ActionList repo={actionsRepo || repo} listHeight={listHeight} innerWidth={listInnerWidth} onPaneState={onPaneState} initialBranch={actionsBranch} />
      case 'notifications': return (
        <NotificationList repo={repo} listHeight={listHeight} innerWidth={listInnerWidth} onPaneState={onPaneState}
          onNavigateTo={(notif) => {
            const type = notif.subject?.type
            if (type === 'PullRequest') setPane('prs')
            else if (type === 'Issue')  setPane('issues')
            setView('list')
          }} />
      )
      default: {
        // Custom user-defined pane
        const customDef = (_config.customPanes || {})[pane]
        if (customDef) {
          return <CustomPane paneDef={customDef} repo={repo} listHeight={listHeight} onPaneState={onPaneState} />
        }
        const customTab = (_config.customTabs || {})[pane]
        if (customTab) {
          return <TabView tab={customTab} repo={repo} innerWidth={listInnerWidth} listHeight={listHeight} onOpenItem={(item, kind, itemRepo) => goToDetail({ ...item, _kind: kind, _repo: itemRepo })} />
        }
        return <Box paddingX={1}><Text color={t.ui.muted}>Unknown pane: {pane}</Text></Box>
      }
    }
  }

  const listFooter = (() => {
    if (paneState.dialogHint && DIALOG_HINT_MAP[paneState.dialogHint]) {
      return DIALOG_HINT_MAP[paneState.dialogHint]
    }
    return contextFooterHints(pane, 'list', paneState.actionCtx, _config.toml)
  })()

  const paneSwitch = (p) => { toList(p); setAppMode('NORMAL') }

  return (
    <Shell {...frame} overflow="hidden" bodyProps={{ overflow: 'hidden' }}
      // Compact mode: horizontal tab strip replaces sidebar
      header={!showSidebar && (
        <TabStrip panes={PANES} currentPane={pane} paneLabels={PANE_LABELS} paneIcons={PANE_ICONS} onSelect={paneSwitch} />
      )}
      sidebar={sidebarFor(paneSwitch, { borderRight: false })} sidebarBoundary
      leaderHint={leaderActive && <LeaderHint text={hintLine(['app.leader-theme', 'app.leader-ai', 'app.leader-help'], _config.toml)} />}
      status={statusFor()} footer={listFooter} toasts={toasts}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden"
           borderStyle={borderStyle || 'round'}
           borderColor={t.ui.borderActive}>
        <ErrorBoundary section="Pane header">
          <PaneHeader pane={pane} count={paneState.count} loading={paneState.loading} error={paneState.error} isStale={paneState.isStale} />
        </ErrorBoundary>
        <Box flexGrow={1} flexDirection="column" overflow="hidden">
          <ErrorBoundary>
            {renderListPane()}
          </ErrorBoundary>
        </Box>
      </Box>
    </Shell>
  )
}


/** One layer: covered layers stay mounted but draw nothing (Ink `display="none"`) and read `covered` (#597). */
const Layer = memo(function Layer({ covered, children }) {
  return (
    <CoveredContext.Provider value={covered}>
      <Box flexDirection="column" display={covered ? 'none' : 'flex'}>{children}</Box>
    </CoveredContext.Provider>
  )
})

/** Shallow copy of what a list pane saved in the App's paneStateMap, for the snapshot of an evicted layer. */
const savedPaneState = (ctx, pane) => {
  const saved = ctx.appCtx?.paneStateMap?.get(pane)
  return saved ? { ...saved } : null
}

/**
 * The view tree: the active base view, the covered views kept alive underneath it (navigation
 * stack, src/shell/navStack.js) and at most one overlay or the too-small message on top.
 * Layers are keyed by view identity, so going back or closing an overlay finds the same mounted
 * view: its state, cursor, scroll and query subscriptions are untouched and no gh call is made.
 * @param {{ ctx: object }} props the App's view context
 * @returns {React.ReactElement} all mounted layers
 */
function AppViews({ ctx }) {
  const ref = useRef(null)
  if (!ref.current) ref.current = { covered: [], active: null, gates: new Map(), store: createViewStateStore(), latestOnPaneState: null }
  const st = ref.current
  const identity = identifyBaseLayer(ctx)
  if (!st.active || st.active.id !== identity.id) {
    const next = navigate(st.covered, st.active, identity)
    for (const gone of next.evicted) {
      st.store.save(gone.id, { ...gone.meta, paneState: gone.base ? savedPaneState(ctx, gone.meta?.pane) : null })
    }
    st.covered = next.covered
    st.active = { ...identity, element: null, meta: null }
    // A layer rebuilt after eviction gets its pane state back before it mounts.
    const snapshot = st.store.take(identity.id)
    const map = ctx.appCtx?.paneStateMap
    if (snapshot?.paneState && map && !map.has(snapshot.pane)) map.set(snapshot.pane, snapshot.paneState)
    const live = new Set([identity.id, ...st.covered.map(layer => layer.id)])
    for (const id of st.gates.keys()) if (!live.has(id)) st.gates.delete(id)
  }
  const overlay = buildOverlay(ctx)
  st.latestOnPaneState = ctx.onPaneState
  const gateFor = (id) => {
    let gate = st.gates.get(id)
    if (!gate) {
      gate = { covered: false, wasCovered: false, state: {}, send: null }
      // Pane state sent by a covered view is kept and replayed when it is on screen again, so a
      // hidden list never overwrites the footer/count of the view that is showing.
      const g = gate
      g.send = (partial) => { Object.assign(g.state, partial); if (!g.covered) st.latestOnPaneState(partial) }
      st.gates.set(id, gate)
    }
    return gate
  }
  const gate = gateFor(identity.id)
  if (!overlay || !st.active.element) {
    st.active.element = buildBaseLayer(ctx, gate.send)
    st.active.meta = { pane: ctx.pane, view: ctx.view, itemNumber: ctx.selectedItem?.number ?? null }
  }
  for (const layer of st.covered) gateFor(layer.id).covered = true
  gate.covered = Boolean(overlay)

  useEffect(() => {
    for (const g of st.gates.values()) {
      if (g.wasCovered && !g.covered && Object.keys(g.state).length > 0) st.latestOnPaneState({ ...g.state })
      g.wasCovered = g.covered
    }
  })

  const layers = [
    ...st.covered.map(layer => <Layer key={layer.id} covered>{layer.element}</Layer>),
    <Layer key={identity.id} covered={Boolean(overlay)}>{st.active.element}</Layer>,
  ]
  if (overlay) layers.push(<Layer key={overlay.id} covered={false}>{overlay.element}</Layer>)
  return <>{layers}</>
}

/**
 * The app's view tree (the Shell frame per view, overlays as layers, keep-alive navigation).
 * @param {object} ctx the App's view context
 * @returns {React.ReactElement} the tree
 */
export function renderAppView(ctx) {
  return <AppViews ctx={ctx} />
}
