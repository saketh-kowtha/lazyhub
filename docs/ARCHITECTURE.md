# lazyhub — Architecture & Point of Truth

> **Purpose of this file:** how the code is organized today: layers, state ownership, key routing, data flow, process model and invariants (§1 to §6), the target structure (§7), plus the frozen bug-fix log (§21). Cross-cutting decisions, and what is shipped versus planned, are in `docs/ARCHITECT_DECISIONS.md`; newer bug fixes are in `docs/bugs/`.

---

## 1. Layers

lazyhub is a pure-ESM Node program: an Ink (React) terminal UI over the official `gh` CLI. This section and the next five describe the code as it is today; the target structure and what is still planned are in the "Structure decisions" section of `docs/ARCHITECT_DECISIONS.md` (D13 to D16). Where the two differ, that section says which is which.

| Layer | Where | Owns |
|---|---|---|
| Entry | `bin/lazyhub.js` | argument fast paths (`--version`, `--debug-state`, `perf report`, `--mcp`, `doctor`, `feedback`, `watch-only`, `serve`), crash handlers, config load, the editor socket, `renderApp()` |
| Bootstrap | `src/bootstrap.js` | before any UI: is `gh` installed and signed in, which repository, onboarding |
| Shell | `src/app.jsx`, `app-views.jsx`, `app-panels.jsx`, `app-keys.js` | the root component, the view tree (list, detail, diff, comments, conflict, settings, logs, overlays), global keys, footer and help text |
| Features | `src/features/{prs,issues,branches,actions,notifications,tabs,settings,logs,onboarding}/` | one pane each: list, detail and dialogs; controllers hold state, `*-view.jsx` / `render.jsx` files draw |
| Shared UI | `src/components/`, `src/ui/` | dialogs (`components/dialogs/`), status bar, footer, error boundary, popover, which-key; the action registry for the palette (`ui/actions.js`) |
| Hooks | `src/hooks/` | `useGh` (reads), `useGhHealth`, `usePendingWrite`, `useLayout` / `useTerminalSize`, `useVirtualList`, `useSafeInput` |
| Config and theme | `src/config/`, `src/theme/`, `src/themes/` | TOML config, the action and keymap registry, theme tokens (`useTheme()`) |
| Services | `src/services/` | the only way UI code reaches the OS: `platform.js` (browser, clipboard, configured pane commands), `editor.js`, `git.js` (local git, always given the checkout directory) |
| Executor | `src/executor.js` (barrel), `src/executor/` | `runGh()` and `runGit()`: classification, audit of writes, timeouts, concurrency, error typing; the typed GitHub calls (`prs.js`, `issues.js`, ...); `classify.js` turns a failure into a plain-language message |
| Background | `src/daemon/`, `src/ipc.js`, `src/cli/`, `src/watch-only/`, `src/mcp.js` | the optional helper process and its protocol, the editor socket, the non-TUI commands |
| AI | `src/ai/` | provider abstraction; `providers/anthropic-api.js` is the only Anthropic HTTP caller |

The intended direction is `components/features -> hooks -> services -> executor -> gh/git`. What is enforced today: UI directories cannot import `execa` or `child_process` (lint and a source scan), spawn sites exist only in `services/`, `executor/`, `bootstrap.js`, `daemon/` and `ai/providers/` (test), and `useTheme()` is required over a static theme import. What is only convention: features and components import `executor.js` directly, and hooks do not go through services.

CI, branch protection and release flow are documented in `docs/CI_SIMPLIFICATION.md` and `docs/RELEASING.md`; the workflow files under `.github/workflows/` are the source of truth.

---

## 2. State ownership

| State | Owner | Lifetime |
|---|---|---|
| Active pane, view (list, detail, diff, comments, conflict, settings, logs), selected item, overlays (help, palette, AI), toasts, the app mode | `App` in `src/app.jsx` | the session |
| Per-pane report for the shell (`count`, `loading`, `error`, `dialogHint`, `actionCtx`) | each pane calls `onPaneState`; `App` keeps `paneState` | while the pane is mounted |
| Cursor, scroll offset, filters, search text, open dialog | the pane's controller (`list.jsx`, `detail.jsx`, ...) | while mounted; `usePaneState` keeps list state across a detail round trip and `App` clears it on an explicit pane switch |
| Dashboard section and row selection | `selectionMemory` in `features/tabs/view.jsx`, so a detail round trip restores it | the session |
| Fetched data | `useGh` caches: an in-memory LRU (200 entries, 64 MB), then the disk cache under `~/.cache/lazyhub/data/` mirrored in memory at startup | memory for the session, disk across runs |
| Key scope stack | `KeyScopeProvider` in `src/keyscope.js` | the session |
| A dialog is open (suppresses global keys) | `dialogActiveRef` in `App`, set through `notifyDialog(true/false)`; every component that opens a dialog must call it | planned for removal (D13) |
| gh health (failing calls) and the daemon-fallback notice | module state behind `useGhHealth` and `src/daemon/fallback.js`, shown by the status bar | the session |
| In-flight write | `usePendingWrite` in the view that started it | until it settles |
| Contained handler errors and absorbed errors | `src/contain.js` (toast; `logSwallowed` ring) | six seconds / the session |
| Config | `~/.config/lazyhub/lazyhub.toml`, loaded by `src/config/loader.js`; the registry in `src/config/actions.js` | read at start, saved from Settings |
| Theme | `ThemeProvider`; switched hot | the session |

Rule of thumb: a pane owns what only it shows; `App` owns what changes the whole screen; nothing outside the executor and `useGh` owns GitHub data.

---

## 3. Key routing

1. Ink delivers a key to every `useInput` handler. App code imports `useInput` only from `src/hooks/useSafeInput.js`, which wraps the handler in `containHandler`: a throw (or a rejected promise) becomes a toast in the status bar and the app keeps running.
2. Components that own keys claim a scope with `useKeyScope` (`global < pane < view < overlay < dialog < input`). The root handler in `app.jsx` returns early when the active scope is above `pane` or when `dialogActiveRef` is set, so a dialog or text field never also triggers a global key. A few keys always fire (`Ctrl+A` AI assistant, the debug dump).
3. A key is resolved through the registry, not by letter: `[actions.*]` in `src/config/defaultConfig.toml` (rebindable through `[keymaps.*]`) is read by `src/config/actions.js` (`matchesAction`, `hintLine`) and `src/config/keymap.js` (`useActionResolver`, `useKeymapInput`). `useKeymapInput` first lets an armed prefix (`g`) consume the key. Panes resolve in their own scope (`pr-list`, `pr-detail`, `tab-list`, `pr-checks`, ...).
4. The footer, the `?` help, the command palette and the which-key popup are generated from the same registry (`ui/actions.js`, `app-keys.js`), so a rebind changes what they show. A key advertised in a hint must have a handler, and the reverse (`src/config/key-ownership.test.js`).
5. Digits jump to the Nth pane from list views only; `g` followed by `h`, `p`, `i`, `b`, `a`, `n` jumps by name; `<Space>` is the leader. Details are in `docs/mockups/keymap-canonical.md`.
6. A view branch is wrapped in an `ErrorBoundary` (render crashes show a reset screen, not an exit); the sidebar and pane header have their own one-line boundaries.

---

## 4. Data flow

Reads: a pane calls `useGh(fetchFn, deps)`. The hook seeds synchronously from memory or the disk-cache mirror (stale-while-revalidate), then calls the executor function. That calls `runGh(args)`:

1. `classifyGh(args)` labels the argv `read`, `write` or `unknown`; `unknown` is refused (fail closed).
2. A typed read may be served by the daemon when one is reachable (`toTypedRead`); on any daemon failure it falls back to a direct `gh` and the status bar says so.
3. Otherwise `gh` runs with an array argv, a timeout (30 s by default) and a bounded number of concurrent children (4). Output is parsed; a failure is a typed `GhError` with redacted stderr.
4. `useGh` stores the result in both caches and reports success or failure to `useGhHealth`; a failure is also turned into a plain-language `Failure` by `executor/classify.js`.

Detail views are seeded from the list: opening a PR puts the list row under the detail's key (marked `partial` and stale), so the detail renders at once while `getPR`, checks and branch protection load in parallel.

Lists are fetched page by page with cursors and appended; every fixed-size call is listed with its reason in `src/paging-audit.test.js`.

Writes: the UI asks for confirmation (default No for destructive ones), then runs the mutation through `usePendingWrite` (one in flight, a pending status). `runGh` writes an `intent` audit entry first (and blocks the write if it cannot), runs `gh`, drops the repository's cached reads, invalidates the daemon cache, announces the finished write (`src/data/invalidation.js`) and writes a `result` entry. The query client marks every cached read for that repository stale (data kept) and every mounted view revalidates in the background, so no pane needs a "remember to refetch" call (R3, #481). Local git follows the same path through `runGit()` in `executor/git.js`. There is no fallback to a direct `gh` call for a write.

Rendering: every string that came from GitHub passes through `sanitize()` before it is drawn; colors come from `useTheme()` tokens; widths come from `useLayout()` (minimum 40 x 10, below which one "terminal too small" message replaces the screen).

---

## 5. Process model

- **One TUI process.** `bin/lazyhub.js` installs the crash handlers (`src/crash.js` leaves the alternate screen, shows the cursor, disables mouse and raw mode, prints the bug-report pointer), loads config, runs `bootstrap`, starts the editor socket, and calls `renderApp()`. Quitting exits there and leaves nothing behind.
- **Children, always with array argv and never a shell:** `gh` (through `runGh`), `git` (through `runGit`), the browser, clipboard and editor (through `services/`), AI CLI providers (in an empty temp directory with a throwaway HOME and a curated environment), and the optional helper.
- **The helper (daemon).** Started lazily and detached by `scheduleDaemon()` about 100 ms after the first frame, only in a trusted interactive session, never awaited, switched off by `LAZYHUB_NO_DAEMON=1` or `agent.auto_spawn_daemon = false`. It serves typed reads from a cache and takes authenticated control messages. Its socket and the editor socket share one wire module (`src/daemon/wire.js`): newline-delimited JSON, a protocol version, a size limit, a per-run secret in a 0600 file beside the socket.
- **The editor socket** (`src/ipc.js`) lets an editor ask for state, navigate and (only when `[ipc].allow_writes` is true) reply to and resolve review threads.
- **Other entry points** reuse the executor: `lazyhub --mcp` (an MCP server on stdio; the default agent capability is read-only), `watch-only`, `doctor`, `feedback`, `serve`.
- **Resilience.** A failed call raises a banner with a retry hint instead of an empty screen; cached data is shown stale while a refresh runs; `LAZYHUB_PERF=1` records `runGh()` duration and keypress-to-render latency to `~/.cache/lazyhub/perf.ndjson` (`lazyhub perf report`); there is no telemetry.
- **Acceptance of the built binary:** `npm run test:pty` drives `dist/lazyhub.js` on a pseudo-terminal against a fixture `gh` (navigation, crash restoration, degraded recovery, resize, Focus round trips, cold start, failed-log viewer).

---

## 6. Invariants

The full, numbered list is "Hard invariants" in `AGENTS.md`; `docs/ARCHITECT_DECISIONS.md` has the rationale. The ones this document relies on:

1. Every `gh` call goes through `runGh()` in `src/executor/core.js` and every local `git` call through `runGit()` in `src/executor/git.js`; writes are classified, audited and fail closed. Imports use the `src/executor.js` barrel.
2. UI code never spawns a process; it uses `src/services/`.
3. `sanitize()` every string that came from GitHub before it is rendered or put in dialog text.
4. Colors and spacing come from `useTheme()`; components never import the static theme constant.
5. Input goes through `useSafeInput`; keys are registry actions; a dialog calls `notifyDialog(true/false)` until the focus manager replaces it.
6. `ErrorBoundary` wraps every view branch in `app.jsx`.
7. Config is TOML only (`~/.config/lazyhub/lazyhub.toml`).
8. Fast and complete: windowed rendering, page-by-page fetching, no silent truncation (D16).
9. No telemetry. Default agent capability is read-only; there is no ungoverned write fallback.
10. Pinned: React 18, ESLint 8, Vitest 3 (with the matching coverage plugin).

---

## 7. Target (R2-R14), not built yet

Everything above is the code as it is. This section is the destination, so every refactor PR builds the same thing. Nothing here is true of the code until its ticket merges, and the ticket's PR updates the matching section above in the same change. Decisions: D13 to D16 in `docs/ARCHITECT_DECISIONS.md` ("Structure decisions"). The refactor is strangler-style: the new module lands beside the old one, callers migrate in later PRs, the old code is deleted last.

| Area | Target | Replaces today | Tickets |
|---|---|---|---|
| Layer rule | `components/features -> hooks -> services -> executor -> gh/git`, enforced by lint, not convention | features and components import `executor.js` directly | R1 #479 (services), R11 #489 (lint ratchet) |
| Query layer (D14) | `useQuery(key, fetcher)` for all reads and `useMutation(fn, {invalidates})` for all writes; structured keys, in-flight dedupe, cancellation, synchronous cache seed, invalidation by key prefix | `useGh(fetchFn, deps)` with coarse `invalidateRepoCache`; no dedupe or cancellation | R2 #480, R3 #481 (invalidation, list-to-detail seeding, async disk cache), R8 #486 |
| Diff open | the diff is fetched first, the rest deferred, and the likely next view prefetched when the cursor rests | detail and diff load independently | R4 #482 |
| Focus manager (D13) | one root `useInput`; an explicit stack of focus entries; only the top entry gets keys, then registry-resolved globals; claims are synchronous | scope stack in `keyscope.js` plus `dialogActiveRef` / `notifyDialog` and per-pane `if (dialog) return` | R5 #483 (core), R6 #484 (migrate App, dialogs, overlays; delete `notifyDialog`) |
| Key ownership | tests generated from the registry; every hint derived from it | hand-written key-ownership tests | R7 #485 |
| Shared pane primitives | `useListController`, `QueryBoundary`, `useMutation`; one pane per PR | Notifications uses them (`src/hooks/useListController.js`, `src/components/QueryBoundary.jsx`, `src/hooks/useMutation.js`, `src/ui/ListRow.jsx`); the other panes still own their list, loading and error code. `useMutation`'s `invalidates` is the seam for R3 write invalidation | R8 #486 (Notifications first), R9 #487 (the rest) |
| Shell | one app shell and one width contract; overlays layer instead of swapping the tree | view branches swap the tree | R10 #488 |
| Tooling | the invariants machine-checked | partly convention | R11 #489 |
| Errors | handler exceptions never kill the app; `ErrorBoundary` can reset | largely done (`containHandler`) | R12 #490 |
| Process | lazy daemon spawn, one IPC auth model, visible fallback | largely done (`scheduleDaemon`, `wire.js`, status notice) | R13 #491 |
| Performance | large-repo budgets as a CI gate (D16) | `paging-audit.test.js`, PTY cold start, `test:memory` | R14 #510 |

Rules for every refactor PR: behaviour-preserving unless a linked bug says otherwise; one step per PR; no dependency upgrades (Ink, React, ESLint, Vitest stay pinned); update the relevant section above in the same PR.

---

## 21. Complete bug fix log (reference)

> **Frozen at B-91.** New bug-fix entries go in `docs/bugs/<issue-number>.md`,
> one file per bug (see `docs/bugs/README.md`), so parallel PRs never edit the
> same lines. Numbers B-89, B-90 and B-91 were each used twice on 2026-10-30
> by PRs written in parallel; both entries are kept.

### B-01 — comments.jsx: `useTheme` not imported
- **Symptom:** App crashes when navigating to PR comments view
- **Root cause:** `import { t } from '../../theme.js'` imports the static constant, but `const { t } = useTheme()` on the next line calls `useTheme` which was never imported → `ReferenceError`
- **Fix:** Changed import to `import { useTheme } from '../../theme.js'`

### B-02 — FuzzySearch: helper functions missing
- **Symptom:** `/` search in any list pane crashes; `f` file jump in diff crashes
- **Root cause:** `matchesQuery`, `getDisplayText`, `highlightMatch` were placeholder comments (`// ... (highlightMatch and matchesQuery)`), never implemented
- **Fix:** Implemented all three functions at the top of `FuzzySearch.jsx`

### B-03 — diff.jsx: `getLang` not defined
- **Symptom:** Diff view crashes on open
- **Root cause:** `getLang(f.filename)` called in `useMemo` for `langCache` but function was a placeholder comment
- **Fix:** Implemented `getLang(filename)` with extension→language map

### B-04 — diff.jsx: `openEditorSync` not defined
- **Symptom:** Pressing `e` in diff compose mode crashes
- **Root cause:** `openEditorSync(compose.body)` called but function was a placeholder comment
- **Fix:** Implemented `openEditorSync` using `spawnSync` + temp file

### B-05 — diff.jsx: `sanitize` not imported
- **Symptom:** Crash when a diff line has an inline comment thread
- **Root cause:** `sanitize()` used in `renderThreads()` but not in the import from `../../utils.js`
- **Fix:** Added `sanitize` to the utils import line

### B-06 — issues/detail.jsx: `IssueLabelDialog` uses `t` without `useTheme`
- **Symptom:** Crash when opening label edit dialog on an issue
- **Root cause:** `IssueLabelDialog` rendered `<Text color={t.ui.muted}>` but `t` was never in scope — no `const { t } = useTheme()` call in that function
- **Fix:** Added `const { t } = useTheme()` at the top of `IssueLabelDialog`

### B-07 — executor.js: GraphQL `number` variable wrong flag
- **Symptom:** `listPRComments` fails with GraphQL type error (`Int!` expected, got String)
- **Root cause:** `-f number=${number}` passes the value as a string. GraphQL schema declares `$number: Int!` which requires `-F` (non-string flag)
- **Fix:** Changed to `-F number=${number}`
- **Note:** This was a regression from commit `525cb32` which incorrectly changed `-F` back to `-f`

### B-08 — FuzzySearch: string items don't match
- **Symptom:** `f` key in diff view opens file search dialog but shows nothing and matches nothing
- **Root cause:** `items={files.map(f => f.filename)}` passes plain strings. `matchesQuery` reads `item.title`/`item.name` which are `undefined` on a string
- **Fix:** Changed to `items={files.map(f => ({ name: f.filename }))}` with `searchFields={['name']}`

### B-09 — Mouse: null character in keypress emit
- **Symptom:** Mouse scroll enabled (`LAZYHUB_MOUSE=1`) but scrolling does nothing
- **Root cause:** `process.stdin.emit('keypress', null, { name: 'k' })` — `null` as first arg means Ink's `useInput` receives `input = null`. Every handler checks `input === 'j'` / `input === 'k'` which always fails
- **Fix:** Changed to `process.stdin.emit('keypress', 'k', { name: 'k', sequence: 'k', ctrl: false, meta: false, shift: false })`

### B-10 — Mouse: settings toggle disconnected from App
- **Symptom:** Toggling Mouse Support in Settings saves to config but mouse remains inactive
- **Root cause:** `App` checked `process.env.LAZYHUB_MOUSE !== '1'` (env var only). Settings saved `config.mouse` to disk. The two systems never communicated
- **Fix:** `App` holds `mouseEnabled` in `useState` (seeded from `_config.mouse || env`). `setMouseEnabled` exposed via `AppContext`. Settings calls it on toggle

### B-11 — Mouse: listener order allows readline to parse mouse bytes
- **Symptom:** Mouse events sometimes trigger spurious Esc keypresses
- **Root cause:** `process.stdin.on('data', ...)` (appended) — our handler runs after readline's, which may attempt to parse the raw mouse escape sequence
- **Fix:** Changed to `process.stdin.prependListener('data', ...)` so we detect and handle mouse bytes first

### B-12 — settings/index.jsx: `logger` used but not imported
- **Symptom:** Crash on any settings save (`updateConfig` calls `logger.info`)
- **Root cause:** `logger` called in `updateConfig` but never imported
- **Fix:** Added `import { logger } from '../../utils.js'`

### B-13 — release.yml: curl retry doesn't cover HTTP errors
- **Symptom:** Pipeline fails or commits SHA256 of empty string (`e3b0c44...`) to Homebrew tap during npm CDN propagation
- **Root cause:** `sleep 5` unreliable for CDN propagation (can take 30-120s). `--retry` alone only retries network-level failures, not HTTP 4xx/5xx. Under `-f`, a 404 causes curl to exit non-zero and pipes empty input to `sha256sum`
- **Fix:** Polling loop (18 × 10s), `--retry-all-errors`, empty SHA guard before writing `GITHUB_OUTPUT`

### B-14 — release.yml: getContent swallows all errors
- **Symptom:** TAP_TOKEN permission errors (403) silently swallowed, `createOrUpdateFileContents` called without `sha`, causing a confusing downstream error
- **Root cause:** `catch {}` swallows all exceptions including permission errors
- **Fix:** `catch (err) { if (err.status !== 404) throw err }`

**B-15 — CI checks missing `await` in `getCheckRunAnnotations`**
- Root cause: `return run([...])` without `await` inside `try/catch` — the promise rejection escaped the catch block.
- Fix: Changed to `return await run([...])` so errors are caught and `[]` is returned.

**F-12 — Interactive CI checks in PR detail**
- `[c]` key enters checks navigation mode; `j/k` move within checks; `[l]` shows annotations in LogViewer; `[R]` re-requests check run via GitHub API `POST /check-runs/{id}/rerequest`; `[Enter/o]` opens check URL in browser; `[Esc]` exits checks mode.
- Failing checks are sorted to the top of the checks section automatically.
- `CIBadge` in PR list now shows `✗ N/total` count format instead of a bare `✗`.
- `[C]` key on non-conflicting PR → switches to Actions pane pre-filtered to PR's branch.
- `ActionList` accepts `initialBranch` prop; `[x]` clears the branch filter.

**B-16 — IssueDetail used addPRComment for issue replies**
- Root cause: `addPRComment` calls `gh pr comment`, which requires a PR number. Issues use `gh issue comment`.
- Fix: Added `addIssueComment` to executor.js; IssueDetail now uses it.

**B-17 — Assignee dialogs only added, never removed assignees**
- Root cause: All 4 assignee dialogs (PR list, PR detail, Issue list, Issue detail) called `gh pr/issue edit --add-assignee` only; unselected assignees were never removed.
- Fix: Added `addPRAssignees`, `removePRAssignees`, `addIssueAssignees`, `removeIssueAssignees` to executor.js. All dialogs now compute `toAdd`/`toRemove` diff and call both endpoints.
- Also: dialogs were calling `execa` directly, violating the executor pattern. Now all calls go through executor.js.

**B-18 — FuzzySearch author field gave "[object Object]"**
- Root cause: PR/Issue `author` field is `{login: 'string'}`. `String(item.author)` = `"[object Object]"` so author search never matched.
- Fix: PR list and Issue list now pass `fuzzyItems = items.map(pr => ({...pr, authorLogin: pr.author?.login || ''}))` to FuzzySearch and use `'authorLogin'` in searchFields.

**B-19 — diff.jsx AI review read wrong config key**
- Root cause: `config.anthropicApiKey` (root level) is empty; the key lives at `config.ai.anthropicApiKey`.
- Fix: Changed to `config.ai?.anthropicApiKey`.

**B-20 — PR Detail missing v/a/x/o key handlers**
- Root cause: Help overlay advertised `[v]` (comments), `[a]` (approve), `[x]` (request changes), `[o]` (browser) for PR detail view but none were wired up.
- Fix: Added handlers and `approve-body`/`reqchanges-body` FormCompose dialogs to detail.jsx. Added `onViewComments` prop; app.jsx passes `goToComments`.

**B-21 — Issue list missing [o] open in browser**
- Root cause: Help overlay listed `[o]` for issues but no handler existed.
- Fix: Added `o` key handler to issues/list.jsx.

**B-22 — Notifications hardcoded background color**
- Root cause: `backgroundColor={'#1c2128'}` hardcoded; should use `t.ui.headerBg` from theme.
- Fix: Changed to `t.ui.headerBg`.

**B-23 — Issue Detail contentRows useMemo missing `t` dependency**
- Root cause: The `t` theme object was used inside the useMemo but not listed in deps, causing stale theme on theme change.
- Fix: Added `t` to the dependency array `[issue, termCols, t]`.

**B-24 — actionsBranch not cleared on Tab/number-key pane navigation**
- Root cause: Tab and number key handlers in app.jsx set pane/view but never called `setActionsBranch(null)`, so switching away from Actions and back kept the stale branch filter.
- Fix: Added `setActionsBranch(null)` to both Tab and number-key pane switch handlers.

**B-25 — gg/G jump not implemented in Branches, Actions, Notifications, Comments**
- Root cause: Help overlay listed `gg/G` for all panes but these components had no handler.
- Fix: Added `useRef` + `lastKeyRef`/`lastKeyTimer` gg pattern and `G` handler to all four components.

**B-26 — Branches [n] create new branch not implemented**
- Root cause: Help overlay listed `[n]` for create new branch but no handler existed.
- Fix: Added `n` key handler, `new-branch` dialog with `TextInput`, runs `git checkout -b <name>` via execa.

**B-27 — addPRLineComment bypassed GH_HOST (GHE users could not post line comments)**
- Root cause: `addPRLineComment` called `execa('gh', args)` directly without prepending `--hostname` as `run()` does.
- Fix: Prepend `['--hostname', process.env.GH_HOST]` to args when `GH_HOST` is set.

**B-28 — markAllNotificationsRead fired N concurrent API calls, triggering GitHub secondary rate limits**
- Root cause: `Promise.all(items.map(n => markNotificationRead(n.id)))` for potentially 100+ notifications.
- Fix: Added `markAllNotificationsRead()` to executor.js using `PUT /notifications`; notifications pane now calls it.

**B-29 — listBranches truncated at 30 (missing per_page parameter)**
- Root cause: `gh api repos/.../branches` defaults to 30 items; no `per_page` was set.
- Fix: Appended `?per_page=100` to the URL in `listBranches`.

**B-30 — admin merge from diff view skipped confirmation dialog**
- Root cause: `merge-admin` dialog in diff.jsx went directly to `mergePR()` after method selection; no confirm step.
- Fix: Added `merge-admin-confirm` ConfirmDialog step before executing the admin bypass merge.

**B-31 — G (jump to bottom) set cursor to -1 when list was empty**
- Root cause: `const last = items.length - 1` = -1 when empty; no guard.
- Fix: Added `if (items.length > 0)` guard in all list components (PRList, IssueList, BranchList, NotificationList, ActionList).

**B-32 — gg timer refs leaked on component unmount**
- Root cause: `lastKeyTimer.current = setTimeout(...)` had no cleanup in useEffect.
- Fix: Added `useEffect(() => () => { clearTimeout(lastKeyTimer.current) }, [])` to all components using the gg pattern.

**B-33 — IssueList and NotificationList rendered API strings without sanitize()**
- Root cause: `issue.title` and `notif.subject?.title` rendered directly; violates ARCHITECTURE §5 invariant.
- Fix: Added `sanitize()` calls; imported `sanitize` into issues/list.jsx and notifications/index.jsx.

**B-34 — Close-PR ConfirmDialog interpolated unsanitized PR/issue title into message**
- Root cause: Template literals in ConfirmDialog `message` prop used raw `selectedPR.title` / `selectedIssue.title`.
- Fix: Wrapped with `sanitize()` in both prs/list.jsx and issues/list.jsx.

**B-35 — IssueDetail doReply cleared UI and set statusMsg timeout before request completed**
- Root cause: `setTimeout(() => setStatusMsg(null), 3000)` and `setReplyMode(false)` were outside the promise chain.
- Fix: Moved `setReplyMode(false)` before await; moved `setTimeout` into `.then()`/`.catch()` closures with appropriate timeouts.

**B-36 — IssueDetail missing [o] key to open issue in browser**
- Root cause: Global help overlay lists `o: open current item in browser` but IssueDetail had no handler.
- Fix: Added `o` key handler to issues/detail.jsx.

**B-37 — C key in PR detail opened conflict view for UNKNOWN mergeable state**
- Root cause: `pr.mergeable === 'UNKNOWN'` was included in the conflict handler condition; UNKNOWN means GitHub hasn't computed mergeability yet.
- Fix: Removed `|| pr.mergeable === 'UNKNOWN'` from conflict handler and footer hint; only `CONFLICTING` triggers conflict view.

**B-38 — PRSummaryPanel showed "Draft Draft" for draft PRs**
- Root cause: `stateBadge.label` = "Draft" AND `{pr.isDraft && <Text> Draft</Text>}` both rendered.
- Fix: Removed the duplicate `isDraft` conditional text.

**B-39 — HelpOverlay used fixed column widths (40+38+gap) overflowing on <90-column terminals**
- Root cause: Hardcoded `width={40}` and `width={38}` in a flex row with no responsive behaviour.
- Fix: Added `useStdout()` width check; global keys column hidden when `cols < 90`.

**B-40 — PRs and Branches panes shared the same ⎇ sidebar icon**
- Root cause: Both `BUILTIN_PANE_ICONS.prs` and `BUILTIN_PANE_ICONS.branches` were `'⎇'`.
- Fix: Changed branches icon to `'⊞'`.

**B-41 — CIBadge rendered ✗3/5 with no space between icon and count**
- Root cause: `<Text> ✗{failing}/{total}</Text>` — no space after icon character.
- Fix: Changed to `✗ {failing}/{total}` and `● {pending}/{total}`.

**B-42 — BranchList fetched PRs without TTL caching, refetching on every mount**
- Root cause: `useGh(listPRs, [repo])` passed no TTL option; also fetched all states instead of open-only.
- Fix: Added `{ state: 'open', limit: 100 }` filter and `{ ttl: 120_000 }` option.

**B-43 — deleteBranch confirmation did not warn user the operation is remote-only**
- Root cause: ConfirmDialog message said "Delete branch X?" with no indication local branch is unaffected.
- Fix: Updated messages to explicitly say "remote branch" and note local branch is unaffected.

**B-44 — New branch dialog accepted git-invalid characters without validation**
- Root cause: Only `.trim()` was applied; no check for spaces, `~`, `^`, `:`, `?`, `*`, `[`, `\`, `..`, `.lock`, leading `-`, trailing `.`.
- Fix: Added regex validation in `onEnter`; shows error status and cancels if invalid.

**B-45 — Checkout of currently-checked-out branch showed confusing ConfirmDialog**
- Root cause: `ConfirmDialog` rendered with "already your current branch" message but still showed confirm/cancel buttons.
- Fix: Early-return with `showStatus()` instead of rendering a confirm dialog.

**B-46 — spawnSync editor open did not restore terminal, causing layout artifacts on return**
- Root cause: `spawnSync` with `stdio: 'inherit'` ran editor in the alternate screen, mixing editor output with Ink's render.
- Fix: Exit alternate screen before `spawnSync`; re-enter it after the editor closes.

**B-47 — Any-key dismiss of persistent errors swallowed the triggering key (e.g. r to retry required two presses)**
- Root cause: `if (statusMsg?.persist) { setStatusMsg(null); return }` — the `return` discarded the key.
- Fix: Removed `return` so the key falls through to its handler after clearing the error.

**B-48 — Knip and ESLint reported multiple unused exports, imports, and dead code**
- Root cause: Accumulation of unused helper functions, binaries (`which`), and missing devDependencies (`vite`).
- Fix: Added `vite` to `package.json`; ignored `which` in `knip.json`; removed or un-exported 10+ unused functions across `src/ai-assistant.js`, `src/executor.js`, `src/ipc.js`, and `src/utils.js`.

**B-49 — Maintenance scripts used outdated section references and CI included redundant Node versions**
- Root cause: `auto-docs.mjs` targeted incorrect section indices and used fragile splicing logic; CI matrix included Node 20 which is no longer the target runtime.
- Fix: Updated internal scripts to point to Section 21; simplified documentation auto-updates to append-only; restricted CI matrix to Node 22; updated LLM model string to stable `gemini-2.5-flash`.

**B-50 — Agent default scope was `full` and agent/AI tool inputs were not validated at runtime (#249, PR #264)**
- Superseded in part by B-64: the human-confirmed assistant write path that this entry kept was removed; assistant writes are now disabled.
- Symptom: a fresh config granted the broadest agent scope, and malformed or type-confused inputs (resource type, IDs, enums, lengths) reached MCP/AI dispatch.
- Root cause: schema default of `agent.default_scope` was not least-privilege; the MCP adapter and `executeMutatingTool` trusted input shape.
- Fix: default is `read-only` in `src/config/schema.js` and `defaultConfig.toml`; a broader requested scope produces a config warning. Shared validators in `src/input-validation.js` enforce tool name, repo, IDs, enums and length limits with stable `MCP_*` / `AI_*` error codes; client-supplied scope metadata is never read.

**B-51 — Daemon forwarded arbitrary `gh` argv and accepted unauthenticated control messages (#250, PR #266)**
- Symptom: any local process able to reach the daemon socket could have it run caller-chosen `gh` commands and stop or invalidate it.
- Root cause: `type: "gh"` passed caller argv to `runGh`; control messages had no authentication; the daemon inherited the launcher's environment.
- Fix: passthrough removed in favour of typed allowlisted reads (`src/daemon/protocol.js`); privileged messages require a per-daemon session token (0600 file, expiring, revocable; expired secret is rotated); versioned, size-limited protocol with stable error codes; minimal spawn env; no auto-spawn from agent or non-TTY contexts; callers with identity env (`GH_TOKEN`, `GH_HOST`, `GH_CONFIG_DIR`) bypass the daemon; cache key includes host and account.

**B-52 — Write-shaped `gh` invocations could bypass audit and cache invalidation; audit failure was swallowed (#251, PR #271)**
- Symptom: unrecognised write forms were treated as reads, so they skipped audit and invalidation, and a failed audit write did not block the operation.
- Root cause: `isGhMutation()` was a denylist of a few command names and flags; `writeAuditEntry` swallowed errors.
- Fix: allowlisted `classifyGh()` returns read/write/unknown; unknown is refused before spawn, writes are audit-first (failure blocks), never cached, never sent to the daemon, never retried, and invalidate the repo cache afterwards (added in review). Only typed `READ_OPS` are cacheable. Audit entries carry an args hash, not argv.

**B-53 — External AI CLI providers ran with the user's real HOME and the repo as cwd (#252, PR #268)**
- Symptom: Claude Code, Codex and Gemini CLI providers could load repo or user instructions, hooks, plugins and MCP config.
- Root cause: `spawnAndPipe` curated env but passed HOME through and set no cwd.
- Fix: per-call isolated sandbox (empty 0700 cwd, throwaway HOME/TMPDIR/XDG), minimal env, per-CLI hardening flags, guaranteed cleanup including signal paths, provider reported unavailable when isolation or credentials are missing. In review, credential-file copying was removed in favour of env-key-only auth, because a sandboxed token refresh could invalidate the user's real login. Claude CLI `is_error` results with exit 0 now map to error codes instead of assistant text.

**B-54 — Local files, sockets and debug exports were created with default permissions (#253, PR #269)**
- Symptom: config, logs, caches and debug exports were readable under default umask; the IPC socket lived at a predictable `/tmp` path with unchecked pre-existing paths; debug exports contained raw `gh` argv and error text.
- Root cause: raw `writeFileSync`/`appendFileSync`/`mkdirSync` at each writer, blind unlink-then-listen, ignored bind errors, unredacted debug state.
- Fix: shared `src/secure-fs.js` (0700 dirs, 0600 files, atomic and no-follow writes, ownership/symlink/type checks before chmod or unlink); IPC socket in a verified private directory with surfaced bind errors; debug export uses allowlist redaction. Windows named-pipe ACLs and the daemon pid file remain out of scope.

**B-55 — Default pane icons broke box borders (emoji-width and ambiguous-width glyphs)**
- Symptom: Borders shifted, a blank row appeared at the sidebar Actions row and Focus rows jumped onto the sidebar line in recordings.
- Root cause: Defaults used `⚡` (emoji presentation, 2 columns) and East Asian ambiguous `◎`/`◈` (plus the rarely-covered `⑂`), so Ink's layout width and the terminal's drawn width disagreed. Hard-coded copies in `Sidebar.jsx`, `StatusBar.jsx`, `ConflictView.jsx`, `list-row.jsx`, `issues/detail.jsx` had the same problem. `displayWidth()` (string-width) already counts `⚡` as 2 correctly, so no width-function change was needed for user-configured icons.
- Fix: Defaults are now `⎇ ⚑ ⌥ ↯ ✦` (East Asian Width N, one column, no emoji presentation) in `schema.js`, `defaultConfig.toml` and every fallback/status-line copy. Test asserts every default icon is one column under both ambiguous-width settings.

**B-56 — PR-list auto-popover bled the list rows through and overflowed its height**
- Root cause: (1) `Popover` is `position: absolute` and Ink only writes cells a `Text` occupies, so blank popover cells showed the rows beneath. (2) `PRDetailPopoverContent` dividers were `innerW + 2` wide inside a box whose inner width is `innerW`, so each wrapped to a second row (18 rows vs `POPOVER_HEIGHT` 15). Independent of B-55.
- Fix: `Popover` paints an opaque space-filled layer behind its children; dividers are `innerW` wide.

**B-57 — Diff header lines (`index`, `---`, `+++`) rendered as code rows**
- Root cause: `parseDiff` only special-cased `+++ `; every other pre-hunk line (`index …`, `--- a/…`, mode/rename lines) fell through to ctx/del rows with line numbers, and `+++ `/`--- ` lines inside a hunk body were misread as headers. `\ No newline at end of file` was also counted as a context line. The demo fixture was well-formed (real `gh pr diff` format).
- Fix: Track `inHunk`; everything between `diff --git` and the first `@@` is metadata (filename taken from the `diff --git` line, `+++ b/…` override, `/dev/null` ignored); `\` marker lines are skipped.

**B-58 — Esc at the root of a pane quit the app**
- Root cause: `app.back` handler fell through to `exit()` for any matching key, and Esc is bound to `app.back` alongside `q`.
- Fix: At the root only `q` exits; Esc is a no-op there and still steps back from detail/diff/comments/conflict/settings/logs/help. Action description updated.

**B-59 — Sidebar label ran into the pane number / unread count at the narrow width**
- Symptom: `Pull Reque2`, `Notificati6` on Focus at the 18-column `standard` sidebar.
- Root cause: (1) on Focus the wide card grid made Ink flex-shrink the sidebar below its configured 18 columns, so the fixed-width label row overflowed into the number; (2) `Sidebar.jsx` fixed the label width at `INNER - 5` with `.slice()`, ignoring the icon's display width, the optional ` [count]` suffix and the number, and cutting without an ellipsis.
- Fix: the sidebar box is `flexShrink={0}`; label width is derived from `INNER` minus marker, `displayWidth(icon)`, separators, number and count, and the label is cut with `truncateEllipsis()` (new in `utils.js`, built on `truncateToWidth`), leaving at least one space before the number. Sibling sweep: TabStrip/StatusBar labels are not right-aligned beside a number; no other pane renders a label next to a count.

**B-60 — PR-list popover left orphan title fragments beside it**
- Symptom: `.203` / `es` visible to the right of the popover; covered rows were half-hidden.
- Root cause: the popover is only 52 columns wide but the rows beneath it span the full list, so the part of each covered title beyond the popover's right edge stayed visible. (B-56 made the popover opaque, which exposed the problem.)
- Fix (mockup variant A, `docs/mockups/pr-list-popover-a-masked-titles.md`): `PRListView` computes the covered rows from `calcPopoverPosition()` and passes `maskTitle` to `PRRow`, which blanks the title cell and keeps CI/author/age. Sibling sweep: the popover is only used by the PR list.

**B-61 — Author logins cut mid-name (`@dev-agent[b`, `@dependabot[`)**
- Root cause: PR/issue/custom-pane author columns used `truncateToWidth` / `.slice` with no ellipsis, and bot logins carry a 5-column `[bot]` suffix that alone consumed the column.
- Fix: new `formatLogin()` in `utils.js` drops a trailing `[bot]` and truncates with an ellipsis; used in `PRRow`, the PR popover meta line, `IssueRow` and `CustomPane`. No separate bot marker was added (design docs define none; app account names such as `dependabot` are self-evident).

**B-62 — PR list and Focus PR panes fail with `Field 'statusCheckRollup' doesn't accept argument 'first'`**
- Symptom: the PR list and Focus PR panes showed `gh: Field 'statusCheckRollup' doesn't accept argument 'first'` and no PRs.
- Root cause: `listPRs()` queried `statusCheckRollup(first: 50) { nodes { ... } }`, but `PullRequest.statusCheckRollup` is a `StatusCheckRollup` object with no arguments; the checks are the `contexts(first:)` connection on it. Unit tests mocked the response, so the invalid query text was never exercised.
- Fix: query `statusCheckRollup { contexts(first: 50) { nodes { ... } } }` and normalize from `statusCheckRollup.contexts.nodes`; a test asserts the query text. Sibling sweep: `activity.js` and `pr-comments.js` GraphQL queries were run read-only against the live API and are valid; `branches.js`/`getPR` use `gh ... --json statusCheckRollup`, which gh resolves itself.

**B-63 — Existing users kept the broken double-width pane icons after #275 changed the defaults**
- Symptom: after B-55 (#275) swapped the pane icons to `⚑ ⌥ ↯ ✦`, existing installs still rendered `◎ ⑂ ⚡ ◈` and the broken layout.
- Root cause: `writeDefaultConfig()` copied the whole bundled `defaultConfig.toml` into the user's `lazyhub.toml` on first run, so every `[panes.<id>] icon` default was pinned as if the user had chosen it and later default changes never applied.
- Fix: `writeDefaultConfig()` now omits the `[panes.*]` tables from the fresh file; `migrateLegacyPaneIcons()` (`config/migrate.js`, run from `writeDefaultConfig()` on every start) deletes `icon = "<old default>"` only when it exactly equals that pane's previous default, leaving customised icons, comments and everything else untouched (no write when nothing changes). Sibling sweep: the same wholesale copy still pins every other default (labels, descriptions, `[layout]`, `[ui]`, keymaps, ...); deliberately out of scope here.

**B-64 — Model-proposed GitHub writes stayed reachable through the in-TUI assistant, behind a confirm dialog (#276, supersedes the assistant half of B-50)**
- Symptom: the AI assistant offered `merge_pr`, `close_pr`, `close_issue`, `add_pr_comment`, `add_labels`, `review_pr`, `rerun_run` and `cancel_run` to the model; a tool call surfaced a CONFIRM dialog and, on `y`, `executeMutatingTool` wrote to GitHub. A confirmation prompt plus input validation is not server-side authorization, so this contradicted "every agent-originated mutation is disabled until governed authorization exists" for review Alpha.
- Root cause: #264 (B-50) validated assistant mutation input but deliberately kept the human-confirmed write path.
- Fix: mutating tool definitions are no longer sent to any provider; `executeMutatingTool` always rejects with `AI_MUTATIONS_DISABLED` without touching the executor, and a mutating call that still arrives is answered with that error as the tool result (read-only tools unchanged). The `pending_action` result type, the `AIAssistant.jsx` confirm flow, `buildConfirmMessage` and `buildToolResultMessage` are removed. The MCP adapter was already disabled (`MCP_MUTATIONS_DISABLED`, mutating tools never listed) and is covered by tests. Human-initiated pane actions are unchanged. Verified on the built artifact: `tools/list` of the packed tarball lists no mutating tool.

**B-65 — The AI assistant ran its own provider transport and never recorded usage (#284)**
- Symptom: `src/ai-assistant.js` called `https://api.anthropic.com` and OpenAI-compatible endpoints with its own `fetch`, so assistant turns bypassed `src/ai/index.js`, the provider modules' auth/timeout/error handling and `logAiUsage()` (hard invariants 2 and 5), even read-only ones.
- Root cause: the assistant predates the provider facade and was never migrated; the facade only exposed one-shot `getAICodeReview()`.
- Fix: new `runAIChat()` in `src/ai/index.js` runs one tool-use round through `anthropic-api.js` / `openai-compatible.js` (new `chat()` + `toolResultMessages()` in each; Anthropic HTTP now lives in one `postMessages()` shared with `complete()`), honouring the explicit `[ai].provider` choice and existing local endpoints. It applies a timeout/cancellation signal and calls `logAiUsage()` once per round (tokens `null` when not reported; prompts, tool payloads and keys never logged). `ai-assistant.js` keeps only the loop, tools and history, which stay provider-native. A test asserts `api.anthropic.com` appears only in `anthropic-api.js`. Writes stay disabled (B-64). Every tool call of a round is now answered (parallel tool_use previously left all but the first without a result, a provider 400); mutating ones get the B-64 disabled error. Esc and unmount cancel an in-flight request.

**B-66 — GHES users hit "no known GitHub host" at startup or a login prompt for the wrong host (#327)**
- Symptom: GitHub Enterprise Server users got "none of the git remotes ... point to a known GitHub host" at startup, or a login prompt for the wrong host.
- Root cause: bootstrap/onboarding set `GH_HOST` from the raw `origin` host without checking gh logins or resolving SSH aliases, and `detectRepo()` required the literal `GH_HOST` in the remote URL.
- Fix: the remote host is resolved through `ssh -G`, `GH_HOST` is chosen from gh's authenticated hosts, repo parsing is host-agnostic, and a clear error is shown when nothing matches.

**B-67 — Test suite was not hermetic and e2e keys hit the previous screen (#309, #291)**
- Symptom: the suite failed intermittently and differed between machines: a developer's custom icons were baked into snapshots, config tests rewrote the real config, and keys sometimes reached the previous screen.
- Root cause: tests resolved `os.homedir()` to the real HOME, and the e2e driver used timers while the mocked `useInput` re-registered in a passive effect.
- Fix: global temp-HOME setup plus a real-config guard (`src/test/setup-hermetic.js`, `src/test/global-guard.js`), and act-based key delivery (`src/test/input-bus.js`, `src/test/input-driver.jsx`).

**B-68 — CI green did not imply the release graph built (#305, #282)**
- Symptom: a passing CI run did not mean the release workflow could install and build.
- Root cause: CI deleted `package-lock.json` and re-resolved (workaround for npm/cli#4828) while release ran `npm ci` against the committed lockfile.
- Fix: all workflows run `npm ci` against the committed lockfile, which already carries every platform binding; dependency identity is logged and enforced by `scripts/record-toolchain.mjs`.

**B-69 — Daemon files created with default permissions, predictable Windows pipe name, unsafe startup failure paths (#321, #253)**
- Symptom: the daemon pid file was created with the default umask; the Windows pipe name was predictable; a failed bind could delete a live daemon's socket/token; a chmod or token failure left a reachable socket.
- Root cause: `daemon/server.js` predated `secure-fs` and had no startup error path; `daemon/lifecycle.js` derived the pipe name from the username.
- Fix: the pid/token directory is created and asserted private, the pid file is written via `writePrivateFile`, `server.on('error')` and a try/catch around chmod/`issueSession`/pid write report to stderr and exit via `shutdown(1)`, and cleanup removes files only after a successful bind. The Windows pipe name is random, stored in `daemon.pipe` beside the pid file. Tests: `server.test.js` (pid dir tightened, 0600 files under umask 000, POSIX only), `lifecycle.test.js` (pipe name random, stable, not the username).

**B-70 — Ollama default sent AI requests to api.openai.com (#310)**
- Symptom: with `provider = "ollama"` and no base URL, AI requests (prompt, messages, repo, PR title/author, OpenAI key) went to `api.openai.com`.
- Root cause: `camelAi()`, the schema default and `defaultConfig.toml` all pinned `openai_base_url` to `api.openai.com`, so the Ollama localhost fallback was unreachable.
- Fix: the default is empty with a per-provider fallback, the API key is withheld from the default Ollama endpoint, and a legacy pinned value is ignored for Ollama. Regression test: `src/config.ai-defaults.test.js`.

**B-71 — Packaged installs never created `lazyhub.toml` (#310)**
- Symptom: packaged installs never wrote a default `lazyhub.toml`.
- Root cause: `config.js` resolved `<dir>/config/defaultConfig.toml`, but the flat `dist/` bundle ships `dist/defaultConfig.toml`; the resulting error was swallowed.
- Fix: reuse `DEFAULT_CONFIG_TOML_PATH` from `loader.js` and warn on failure. Regression test: `src/config/default-config-dist.test.js`.

**B-72 — Remote config could change any setting; editor argv mis-parsed paths (#319)**
- Symptom: a remote config (`[meta].config_url`) or its cached copy could change any setting, including the editor command, AI provider/endpoints, hosts and `config_url` itself; and the editor argv was built by substituting the file path into the command string before splitting it, so paths with spaces or a leading `-`/`+` were mis-parsed.
- Root cause: remote config was merged wholesale after type-only validation; `custom_command` was substituted before tokenizing; the file path was passed as given.
- Fix: remote config is allowlist-only (theme, layout, ui, diff, pane display text); the editor argv is tokenized first with placeholders substituted per token, and the file is passed as an absolute path in every branch.

**B-73 — First-run repo picker rendered 12 of 30 repos and forgot the choice (#308, #280, #290)**
- Symptom: the picker fetched 30 repos and moved the cursor through all of them but rendered only 12; repos past the page were unreachable; the chosen repo was forgotten next launch.
- Root cause: `repos.slice(0, 12)` for rendering versus `repos.length` for the cursor bound; no search or lookup; the pick was not persisted.
- Fix: rows are windowed from terminal height, selection is identity-keyed, search and a validated lookup were added, and `[defaults].repo` is saved on completion. Regression test: `src/bootstrap.repo.test.js`.

**B-74 — Bootstrap gh calls bypassed `runGh()` (#322, #288)**
- Symptom: bootstrap gh calls bypassed classification, call history and `GhError` typing.
- Root cause: bootstrap predates the `runGh()` chokepoint and used execa directly; nothing enforced the invariant.
- Fix: bootstrap routes through `runGh()` (new `interactive`/`combine` options, allowlist entries) and a static guard test, `src/gh-spawn-guard.test.js`, enforces it (`src/bootstrap.login.test.js` covers the login path).

**B-75 — Onboarding and report copy conflated attribution with coverage (#334, #281)**
- Symptom: onboarding said unattributed ("unknown") activity "counts as ungoverned", and the report implied "human" meant a verified person.
- Root cause: the copy conflated actor attribution with operation coverage, which `report.js` computes only from observation quality.
- Fix: a shared four-fact vocabulary; attribution is labelled as metadata, not identity or coverage (`docs/mockups/onboarding-report-attribution-separation.md`).

**B-76 — PR list never loaded beyond 100 PRs (#336, part of #311)**
- Symptom: scrolling to the bottom of a large repo's PR list never fetched more; a 1,200-PR fixture stayed at "100 items".
- Root cause: `listPRs` clamped `filter.limit` to the single-call 100-node GraphQL cap while `list.jsx` grew `limit` by 100.
- Fix: `listPRs` follows the GraphQL search cursor (at most 100 per call, sequential, capped at GitHub's 1,000-result search limit) and limit growth only happens after a full page. Regression test: cursor paging in `src/executor.test.js`.

**B-77 — PR list filter bar overlapped itself at 80 columns (#336, part of #311)**
- Symptom: at 80x24 the filter bar collapsed into overlapping text (`op/clos/merge· mine[O]open`).
- Root cause: every filter-bar child could shrink.
- Fix: children are `flexShrink={0}` and the key hint is shortened to `[s]scope [@]author` below 100 columns. Covered by the 80x24 journey in `test/pty/portability.js`.

**B-78 — `?` did nothing in detail views; comments advertised a missing retry; modified keys matched bare letters (#340, part of #312)**
- Symptom: `?` and the footer's "more keys" did nothing inside PR detail, diff and comments; the comments footer and error text advertised `r` (retry) with no handler; `Space` in Branches both started the leader window and checked out; Ctrl+R was read as `r`.
- Root cause: the root handler returned for every `view` scope; comments had no refresh handler; `branch.checkout` and `app.leader` shared `Space`; `eventToTokens` always added the raw character.
- Fix: the root handler lets `?`, `:` and `g` through at `view` scope; comments handle `list.refresh`; `branch.checkout` is `Enter`; modified keys match only their modified token. Tests: `src/config/keymap-registry.test.js`, `src/keystroke-budgets.e2e.test.jsx`.

**B-79 — Dependabot esbuild updates failed with an override conflict (#355)**
- Symptom: individual and grouped dependency updates failed with `EOVERRIDE` / `dependency_file_not_resolvable` when the direct esbuild specification changed.
- Root cause: `overrides.esbuild` duplicated the direct dependency's range; npm requires identical specifications for a direct dependency and its override, even when their ranges overlap.
- Fix: reference the direct specification with `$esbuild`, retaining the transitive override without changing dependency versions or the lockfile. Regression test: `src/dependency-overrides.test.js` runs npm's offline lockfile validation after individual and grouped specification changes.

**B-84 — TUI memory-budget CI jobs could not load node-pty in the container (#358)**
- Symptom: `TUI memory budget (512 MB)` and `... at scale` failed with `Failed to load native module: pty.node, checked: build/Release, build/Debug, prebuilds/linux-x64` before the journey ran.
- Root cause: the jobs installed on the `ubuntu-latest` runner (ubuntu-26.04), where node-pty compiles `pty.node` from source (1.1.0 ships no linux prebuilds), then bind-mounted that tree into `node:22-bookworm`; the host-built binary needs a newer glibc/libstdc++ than bookworm provides, so `dlopen` fails.
- Fix: a `npm rebuild node-pty` step runs inside `node:22-bookworm` (uncapped, as node-gyp needs more than 512 MB) before each capped journey run. No dependency or lockfile change.

**B-88 — Help overlay rendered duplicate React keys (#381)**
- Symptom: `?` in the PR list logged React's "two children with the same key, `M`" warning; duplicate keys can make rows duplicate or vanish on re-render.
- Root cause: `HelpOverlay` (`src/app-panels.jsx`) keyed rows by the key token alone, but `pr.auto-merge` and `pr.filter-merged` are both bound to `M` in the pr-list scope.
- Fix: rows are keyed by index plus key token (context and global columns). Test: `src/app.e2e.test.jsx` "help overlay rows have unique React keys".

**B-89 — Saving settings corrupted TOML without a trailing newline (#367)**
- Symptom: adding a setting after `mouse = true` without a final newline produced `mouse = truedefault_pane = "prs"`, making the user config invalid on the next launch. A final comment could silently swallow the new setting.
- Root cause: `upsertScalar` inserted a new assignment without terminating the preceding section line.
- Fix: ensure the preceding line ends in a newline before inserting a missing key. Regression tests in `src/config/writer.test.js` cover a final assignment, bare section header, comment, and existing newline, including reload and repeat-save checks.
**B-90 — Multiple PR state filters only fetched open PRs (#368)**
- Symptom: Open+Merged showed only open PRs; Closed+Merged showed no PRs.
- Root cause: the pane requested `state: 'all'`, but `prSearchQuery()` treated it as unknown and defaulted to `state:open`, excluding other states before client-side filtering.
- Fix: recognize `all` and omit the search state qualifier while retaining other filters and the open default for missing/unknown states. Regression coverage: `src/executor.test.js`. Sibling sweep: Issues passes states directly to `gh`; Branches requests open PRs intentionally; Actions and Notifications have no equivalent state conversion.

**B-91 — Issue editor tests intermittently lost the first key**
- Symptom: the assignee editor test stayed on the issue list instead of opening the dialog.
- Root cause: `sendInput()` took its handler snapshot before flushing pending mount effects; a visible frame or timer delay did not guarantee the input handler was registered.
- Fix: mount the issue test views inside awaited `act()` so effects finish before input. A regression test sends `A` immediately after mounting without a timer delay. Sibling pane flows use their existing input driver; the shared input helper is unchanged.

**B-91 — Debug Logs crashed with `useStdout is not defined` (#372)**
- Symptom: opening Debug Logs showed an error screen instead of the log list.
- Root cause: `LogPane` referenced `useStdout`, `Box`, and `Text` without importing them from Ink; existing tests mocked the pane.
- Fix: import the missing Ink symbols. `src/features/logs/index.test.jsx` renders the real pane and exercises level filtering, search, details, and back navigation. The test reproduced the ReferenceError before the fix. Sibling sweep: PRs, Issues, Branches, Actions, and Notifications already import the Ink symbols they use.
