# lazyhub Polish Plan

## Vision

lazyhub should feel like the keyboard-native GitHub client a power user reaches for instead of the web UI — fast, dense-but-scannable, and resilient when the network or `gh` misbehaves. The next iteration closes the gap between "works" and "trusted daily driver" by fixing state-loss bugs, surfacing review/CI signal at a glance, and giving power users multi-state search and bulk ops without leaving the keyboard.

---

## Phase 1 — Critical UX Fixes (ship this week)

### Multi-state filter for PRs and Issues
**What:** Allow filterState to hold a Set of states (Open + Merged + Closed) instead of a single string.
**Why:** #1 user complaint. Every triage workflow needs Open+Merged side-by-side.
**How:**
- Change `filterState: string` → `filterState: Set<string>` in `src/hooks/usePaneState.js` and consumers
- Update predicate in `src/features/prs/list.jsx` and `src/features/issues/list.jsx` to `states.has(pr.state)`
- Bind `o`/`m`/`c`/`a` to toggle each state; chip row in header reflects active set
- Persist as array in `~/.config/lazyhub/config.json` last-session block
- Migrate legacy single-string config on load in `src/config.js`

**Effort:** M  
**Priority:** P0

---

### Fix state persistence across Tab switches
**What:** Preserve filter/cursor/scroll when leaving a pane via Tab and returning, not just on Esc-from-detail.
**Why:** Current behavior silently resets — feels broken and erodes trust in every other state-preserving feature.
**How:**
- In `src/hooks/usePaneState.js`, hoist state into a module-level keyed store (`Map<paneId, state>`) instead of component-local refs
- Hydrate on mount from the store; flush on unmount and on every state mutation
- Add a `__paneStateVersion` bump to invalidate on explicit refresh
- Cover with a snapshot test that mounts pane A, switches to B, returns, asserts cursor

**Effort:** S  
**Priority:** P0

---

### Global fuzzy PR search modal (`P`)
**What:** Press `P` anywhere to open an 80%-wide modal that searches PRs across all states with a scope filter (author/assignee/repo).
**Why:** Explicit user request; current per-pane search is scoped to current filter and pane, which is too narrow.
**How:**
- New `src/features/prs/searchModal.jsx`; register `P` in global keyscope in `src/keyscope.js`
- Backend: new `searchPullRequests(query, scope)` in `src/executor.js` calling `gh search prs --json ...`
- Modal: input row + scope chips (mine / review-requested / mentions / all) + result list reusing list-row component
- Enter on result deep-links to PR detail; Esc returns to caller pane intact
- Debounce input 200ms; cache last 10 query results in-memory

**Effort:** M  
**Priority:** P0

---

### Review status glyph in PR list
**What:** Show review state (approved / changes-requested / pending / none) as a single colored glyph in each PR row.
**Why:** Highest-value at-a-glance signal users currently have to open detail to see.
**How:**
- Extend list JSON fields with `reviewDecision` and `latestReviews` in `src/executor.js`
- In `src/features/prs/list.jsx`, render a 1-char column: `✓` approved, `✗` changes-requested, `●` pending, ` ` none
- Add `reviewApproved`, `reviewChanges`, `reviewPending` to all theme files in `src/themes/*.js`
- Width-budget check: must still fit at 80 cols (drop labels column first if needed)

**Effort:** S  
**Priority:** P0

---

### Status bar: rate limit + last refresh
**What:** Right-align rate-limit remaining and `last refreshed Xs ago` in `StatusBar.jsx`.
**Why:** Users have no way to know if data is stale or if `gh` is rate-limited.
**How:**
- Add `getRateLimit()` to `src/executor.js` — call once per minute via a hook
- Track `lastRefreshAt` per pane; pass active pane's value to `src/components/StatusBar.jsx`
- Format: `repo · pane · 42 PRs   ·   gh: 4823/5000   ·   refreshed 12s ago`
- Truncate gracefully under 80 cols (drop refresh time first, then rate limit)

**Effort:** S  
**Priority:** P1

---

### Offline / gh-failure indicator
**What:** When a `gh` call errors or times out, show a red banner in the status bar with last error and a hint to press `r` to retry.
**Why:** Silent failures are the worst class of TUI bug — users blame themselves instead of the tool.
**How:**
- Wrap all calls in `src/executor.js` with a uniform error envelope `{ok, data, error}`
- New `useGhHealth()` hook tracking last error per call site
- `src/components/StatusBar.jsx` renders degraded state when health is bad
- Auto-clear on next successful call from the same call site

**Effort:** S  
**Priority:** P0

---

### Footer key hints — context-aware
**What:** Make `FooterKeys.jsx` show the 5–7 most relevant keys for the current scope, not a static list.
**Why:** Footer is currently too terse and doesn't update with context (e.g. inside a dialog).
**How:**
- Each pane/view exports a `keyHints` array of `{key, label, when}`
- `src/keyscope.js` aggregates active scope's hints
- `FooterKeys.jsx` truncates to width budget, `?` always last

**Effort:** S  
**Priority:** P1

---

## Phase 2 — Power User Features (2–3 weeks)

### Bulk-select PRs for labels/assignees/close
**What:** Space toggles selection in PR list; `B` opens a bulk-action menu (label, assignee, milestone, close).
**Why:** Triage workflows currently force one-PR-at-a-time roundtrips.
**How:**
- Add `selection: Set<number>` to PR list pane state
- Render selection marker (`*`) in left gutter of `src/features/prs/list.jsx`
- New `src/features/prs/bulkMenu.jsx` overlay; calls `gh pr edit` per selected PR via a queue with per-item progress
- Show partial-failure summary in StatusBar; do not clear selection on failure
- Confirmation dialog for destructive actions (close)

**Effort:** M  
**Priority:** P1

---

### PR detail visual hierarchy refresh
**What:** Restructure PR detail into clear sections: title bar → meta strip (CI/review/labels) → body → activity timeline.
**Why:** Currently too dense to skim; first-time users bounce off it.
**How:**
- Refactor `src/features/prs/detail.jsx` into `<TitleBar/>`, `<MetaStrip/>`, `<Body/>`, `<Timeline/>` subcomponents
- Use box `borderStyle="single"` between sections, theme `dim` color
- Collapse body to 12 lines by default; Space to expand
- Timeline shows last 8 events; `g` jumps to full activity view

**Effort:** M  
**Priority:** P1

---

### Notification deep-linking
**What:** Enter on a notification opens the corresponding PR/issue/discussion in detail view.
**Why:** Notifications are unusable without routing — just a list of titles with nowhere to go.
**How:**
- In `src/features/notifications/index.jsx`, parse `subject.url` to derive type + number + repo
- Add `navigateTo(target)` helper in app-level nav; supports cross-pane jump
- Mark-as-read via `gh api` on Enter; optimistic UI update
- `O` opens in browser as fallback for unsupported subject types

**Effort:** M  
**Priority:** P1

---

### Branches pane: CI status + last commit
**What:** Show CI conclusion glyph and last commit subject for each branch.
**Why:** The branches pane is currently a name list — nearly unusable for anything beyond `checkout`.
**How:**
- Extend branch fetch in `src/executor.js` to batch `gh api` for `commits/{sha}/check-runs` and last commit
- Render two new columns in `src/features/branches/index.jsx`
- Cache per-sha results in a Map for the session
- Skip CI fetch for branches older than 30 days to bound API cost

**Effort:** M  
**Priority:** P1

---

### Trigger workflow runs from Actions pane
**What:** `R` on a workflow row triggers `workflow_dispatch` with a modal that collects inputs.
**Why:** Read-only Actions pane is half a feature; can't run or re-run from here today.
**How:**
- Detect `workflow_dispatch` inputs from `gh api repos/:owner/:repo/actions/workflows/:id`
- Modal collects required inputs in `src/features/actions/dispatchModal.jsx`
- Call `gh workflow run` with `-f` flags for each input
- Refresh runs list after 2s; show toast on success

**Effort:** M  
**Priority:** P2

---

### Live-apply settings without restart
**What:** Theme, mouse, refresh-interval, and column toggles take effect immediately.
**Why:** "Restart to apply" is jarring in a TUI and breaks the keyboard-first contract.
**How:**
- Hoist config into a React context in `src/app.jsx`; settings pane mutates context directly
- `src/config.js` debounces disk writes (500ms)
- Theme switch: change theme provider value; all components re-read tokens
- Refresh-interval: clear and re-arm interval timer in-place

**Effort:** M  
**Priority:** P2

---

### Comment composer: thread context pane
**What:** While composing a line comment, show the file path, line range, and existing thread above the input.
**Why:** Composing blind to context causes wrong-line replies and confused threads.
**How:**
- Split `src/features/prs/diff.jsx` composer into top context box + bottom input
- Context box shows `file:line` + last 3 messages in thread (truncated to 40 chars each)
- Use theme `accent` color for current line marker

**Effort:** S  
**Priority:** P2

---

## Phase 3 — Enterprise & Scale (1 month)

### Recently-viewed history (`H`)
**What:** `H` opens a list of recently viewed PRs/issues/branches; Enter jumps back.
**Why:** Common navigation pattern (lazygit has it for branches); low cost, high value.
**How:**
- Append to ring buffer (size 50) in `src/utils.js` whenever a detail view mounts
- Persist to config under `recent[]`
- Modal in `src/features/recent.jsx`, registered globally in keyscope

**Effort:** S  
**Priority:** P2

---

### Multi-repo support
**What:** Switch active repo via `:repo owner/name` or a repo picker (`Tab+R`).
**Why:** Power users juggle 5–20 repos; single-repo binding is the biggest scaling limit for enterprise adoption.
**How:**
- Move repo from constant to context in `src/app.jsx`
- Repo list seeded from `gh repo list` + manual config entries
- Per-repo pane state cache keyed by `owner/name` to prevent cross-repo state bleed
- Status bar shows current repo as leftmost segment (already partial)

**Effort:** L  
**Priority:** P1

---

### Saved searches / views
**What:** Name a (pane + filter + scope) combo and recall via `V`.
**Why:** Repeat queries like "my stale open PRs >14d" or "needs-review from team" are daily workflows.
**How:**
- Persist named views in config under `views[]`
- `:save <name>` in command palette captures current pane state
- View picker modal; Enter applies state to active pane

**Effort:** M  
**Priority:** P2

---

### Background refresh + event toasts
**What:** Periodic background poll; toast when a watched PR gets a new review/comment/CI result.
**Why:** Turns lazyhub into a passive monitor — differentiator vs. every other `gh`-based tool.
**How:**
- New `src/services/poller.js` with per-pane configurable TTL
- Diff against last snapshot; emit events to a notification ring
- Toast component anchored to status bar; throttle to 1 per 3s
- User can silence per-PR with `X`

**Effort:** L  
**Priority:** P2

---

### Plugin / external command hooks
**What:** Config-defined key bindings that run a shell command against the current selection.
**Why:** Lets users wire `gh pr checkout`, custom deploy scripts, or Slack notifications without forking.
**How:**
- `commands[]` in `src/config.js`: `{key, label, scope, exec, refreshAfter}`
- Variable interpolation: `{number}`, `{repo}`, `{branch}`, `{url}`
- Execute via `child_process.spawn` with TTY pause/resume (like checkout does today)

**Effort:** M  
**Priority:** P2

---

## Phase 4 — Ecosystem (future)

### Web companion via IPC socket
**What:** Optional local web view that mirrors lazyhub state via the existing IPC socket.
**Why:** Showing diffs to non-terminal teammates without leaving the keyboard workflow.
**How:** Reuse IPC socket; minimal Vite SPA reads pane state. Keep strictly optional.
**Effort:** L | **Priority:** P2

### Theme marketplace / sharing
**What:** `lazyhub theme install <gist-url>` fetches and validates a theme JSON.
**Why:** Community contribution loop; zero engineering cost once the schema is locked.
**How:** New CLI subcommand; schema-validate against theme token shape before writing to disk.
**Effort:** S | **Priority:** P2

### AI summarization for long threads
**What:** `S` summarizes a long PR/issue thread in a side panel.
**Why:** Long compliance/feature threads are unreadable at 80 cols; AI can compress.
**How:** Reuse existing AI review plumbing in `src/ai.js`; cache summaries by node ID.
**Effort:** M | **Priority:** P2

### GitLab / Gitea adapters
**What:** Abstract `executor.js` behind a provider interface; ship a `glab` adapter.
**Why:** Broadens the audience beyond GitHub-only shops.
**How:** Refactor executor into provider modules; provider auto-detected from git remote host.
**Effort:** L | **Priority:** P2

---

## Non-Goals

- **Mouse-first UX.** Mouse stays optional; never required for any workflow.
- **Hover tooltips, popups, animations.** Terminal-incompatible or too noisy.
- **A web-only mode.** lazyhub is a TUI first; the web companion is a viewer, not a port.
- **Bundling our own GitHub auth.** `gh` remains the auth and data boundary — we don't handle tokens.
- **New runtime dependencies** without strong justification — keep `dist/lazyhub.js` small.
- **Custom layout engine.** Stick with yoga/Ink; do not work around overlay limits with hacks.
- **Sub-80-column support.** 80 cols is the floor; we will not optimize for narrower.
- **Editor-grade text editing in comment composer.** Multi-line + basic cursor keys is enough.

---

## Tech Debt to Address

### React anti-patterns
- **Stale closures in keyscope handlers.** Several handlers in `src/keyscope.js` capture state at registration time. Audit all `useKeyScope` callsites; switch to ref-based reads or pass a getter.
- **Pane-local state hidden in refs.** `usePaneState` mixes refs and state inconsistently — see Phase 1 fix. Same pattern likely exists in diff/detail; sweep and unify.
- **Effect-driven data fetching without abort.** `src/executor.js` calls aren't aborted on unmount; rapid Tab-switching can race. Add an `AbortController` per call.
- **Theme tokens via prop drilling.** Migrate to a `ThemeContext` so live theme switching (Phase 2) works without remounts.

### Build system
- `node build.js` has no incremental/watch mode. Add `--watch` flag using esbuild's watch API — current dev loop requires full rebuild on every change.
- No source maps in `dist/lazyhub.js`. Stack traces from user bug reports are nearly useless. Emit external sourcemaps in dev mode.
- Bundle size not tracked. Add a CI step that prints `dist/lazyhub.js` size and fails if it grows >10% without an explicit override.

### Test coverage
- Zero tests for `usePaneState`, keyscope precedence, or executor error envelopes — the three highest-bug-density modules.
- Add `vitest` (or `node:test`) with snapshot tests for list rows at 80/120/160 cols.
- Integration smoke test: spawn lazyhub against a fixture `gh` shim, drive key sequences, assert exit state.
- Add `eslint-plugin-react-hooks` with `exhaustive-deps` set to error.

### Terminal compatibility
- **Truecolor assumed.** Many enterprise terminals are 256-color. Theme tokens should degrade gracefully — add `colorDepth` detection and 256-color theme variants.
- **Wide-char (CJK, emoji) handling is inconsistent.** Column math in PR list assumes 1 cell per char. Use `string-width` or a local fallback in all width calculations.
- **Windows Terminal.** `gh` exits and stdin handoff are flaky on Windows. Document supported platforms or guard with feature flags.
- **Resize (SIGWINCH).** Some panes don't recompute scroll window on terminal resize. Audit all `useTerminalDimensions` consumers.
- **IPC socket path assumes Unix.** Add a Windows named-pipe path or feature-flag IPC off on Windows.

### Code organization
- `src/utils.js` is a junk drawer. Split into `src/utils/format.js`, `src/utils/time.js`, `src/utils/width.js`.
- `src/executor.js` is one large file (>1000 lines). Provider-abstract it now before Phase 4 doubles its size.
- Several feature folders mix list/detail/modal in one file. Standardize on `index.jsx` + sibling files per feature (e.g. `src/features/prs/search.jsx`, `src/features/prs/bulk.jsx`).
