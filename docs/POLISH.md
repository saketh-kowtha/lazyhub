# lazyhub Polish Plan

## Vision

lazyhub is the terminal where you **do the review work**, not just look at GitHub. Browsing lists of PRs/issues in the terminal is table stakes — the reason to reach for lazyhub is that you can read a diff, leave line comments, check CI, and merge without ever leaving the keyboard, and increasingly: **supervise a fleet of agent-authored PRs from one cockpit.** This roadmap leans into that moat instead of competing on the commodity list view.

---

## Strategic Positioning (the moat)

Research into how developers actually work in 2025–2026 surfaced two facts that shape this roadmap:

1. **The list/dashboard surface is commodity.** Plenty of tools browse PRs/issues in the terminal. Polishing the list harder does not create a reason to switch — it only has to be good enough to not embarrass us.
2. **The review *workspace* and *agent-PR supervision* are unclaimed.** Most terminal tools hand you off to `$EDITOR` or the browser to actually review code. lazyhub already reads diffs and takes line comments in-terminal — the hard, differentiated part. And with ~1 in 5 PRs now involving a coding agent (growing ~10x year-over-year), nobody owns the terminal experience for a human supervising agent-authored PRs at volume.

**Three things are why someone picks lazyhub. Everything else serves these:**

- **A — In-terminal diff review:** read, comment on lines, approve, merge. Agents act on review comments, so a terminal line comment *is* a control channel.
- **B — The Agent PR Cockpit:** a queue of agent-authored PRs with at-a-glance triage signals (CI status, CI-weakening, scope, tests, empty body) and the actions to clear it fast.
- **C — Embedded mode:** lives inside the editor (Neovim first), not a separate app.

Commodity work (list polish, filters, sections) is necessary but is explicitly *not* the headline. Lead every demo with A and B.

---

## Phase 1 — Critical UX Fixes (ship this week)

### Multi-state filter for PRs and Issues
**What:** Let the filter hold a set of states (Open + Merged + Closed) instead of a single string.
**Why:** Top user complaint. Triage workflows need Open+Merged side-by-side.
**How:**
- `filterState: string` → `Set<string>` in `src/hooks/usePaneState.js` and consumers
- Predicate `states.has(pr.state)` in `src/features/prs/list.jsx`, `src/features/issues/list.jsx`
- Toggle keys per state; header chip row reflects the active set
- Persist as array; migrate legacy single-string config in `src/config.js`

**Effort:** M | **Priority:** P0

### Fix state persistence across Tab switches
**What:** Preserve filter/cursor/scroll when leaving a pane via Tab and returning, not just on Esc-from-detail.
**Why:** Silent resets make every other state-preserving feature feel broken.
**How:**
- Hoist state into a module-level keyed store in `src/hooks/usePaneState.js`
- Hydrate on mount; flush on unmount and on mutation
- Snapshot test: mount A → switch to B → return → assert cursor

**Effort:** S | **Priority:** P0

### Global cross-status PR search modal (`P`)
**What:** Press `P` anywhere to open a wide modal that searches PRs across all states with a scope filter (mine / review-requested / mentions / all).
**Why:** Per-pane search is scoped to the current filter and pane — too narrow for "jump to any PR."
**How:**
- New `src/features/prs/search.jsx`; register `P` in global keyscope (`src/keyscope.js`)
- New `searchPullRequests(query, scope)` in `src/executor.js` via `gh search prs --json ...`
- Enter deep-links to PR detail; Esc returns to caller pane intact; debounce 200ms; cache last 10

**Effort:** M | **Priority:** P0

### Review-status glyph in PR list
**What:** One colored glyph per row: approved / changes-requested / pending / none.
**Why:** Highest-value at-a-glance signal users currently must open detail to see.
**How:**
- Add `reviewDecision` to list JSON fields in `src/executor.js`
- 1-char column in `src/features/prs/list.jsx`: `✓` approved, `✗` changes, `●` pending
- Add `reviewApproved`/`reviewChanges`/`reviewPending` to all `src/themes/*.js`
- Must still fit at 80 cols (drop labels column first if needed)

**Effort:** S | **Priority:** P0

### Degraded-state / gh-failure indicator
**What:** When a `gh` call errors or times out, show a status-bar banner with the last error + "press r to retry."
**Why:** Silent failures are the worst class of TUI bug — users blame themselves.
**How:**
- Uniform error envelope `{ok, data, error}` on calls in `src/executor.js`
- `useGhHealth()` hook tracks last error per call site; `StatusBar.jsx` renders degraded state; auto-clear on next success

**Effort:** S | **Priority:** P0

### Status bar: rate limit + last refresh
**What:** Right-align rate-limit remaining and "refreshed Xs ago."
**Why:** Users have no way to know if data is stale or rate-limited.
**How:** `getRateLimit()` in `src/executor.js` (once/min); track `lastRefreshAt` per pane; truncate gracefully under 80 cols.

**Effort:** S | **Priority:** P1

### Context-aware footer key hints
**What:** Footer shows the 5–7 most relevant keys for the current scope, not a static list.
**Why:** Footer is too terse and doesn't change inside dialogs/views.
**How:** Each pane/view exports `keyHints`; `src/keyscope.js` aggregates active scope; `FooterKeys.jsx` truncates to width, `?` last.

**Effort:** S | **Priority:** P1

---

## Phase 2 — The Moat (2–4 weeks)

> This is the differentiated work. Prioritize it over further list polish.

### EPIC: Agent PR Cockpit
**What:** A first-class view/section for agent-authored PRs (Copilot / Claude / Codex / `*[bot]`) presented as a review queue, sorted by CI status, with inline triage signals and one-key actions.
**Why:** ~1 in 5 PRs now involve an agent and the volume overwhelms reviewers — "a dozen agent sessions before lunch." No terminal tool owns this. It's lazyhub's clearest path to *not* being a commodity list browser.
**How:**
- Detect agent authorship in `src/executor.js` (author login matches known agents / `app/*` / `*[bot]`); add an `isAgent` flag to PR records
- New smart section in PR list: "Agent PRs" filter, sorted by CI then age
- Reuse the existing diff + line-comment workspace as the review surface (line comments are the agent control channel)
- Bulk-clear actions: approve / request-changes / comment across selected agent PRs

**Effort:** L | **Priority:** P0 (moat)

### Inline PR triage signals
**What:** Derived glyphs per row that make the agent-PR review checklist instant: CI pass/fail, ⚠ CI-weakened (tests removed / thresholds lowered / linting disabled in the diff), ∅ empty body, file-count, ✓/✗ tests-touched.
**Why:** Encodes the real reviewer loop ("did this weaken CI? does it have tests? is it scoped?") so triage is seconds, not minutes. Helps human *and* agent PRs.
**How:**
- Compute from already-fetched diff stats + body in `src/features/prs/list.jsx` / a small `src/utils/triage.js`
- "CI-weakened" heuristic scans the diff for removed test files, lowered coverage thresholds, disabled lint/CI gates
- Render as a compact glyph cluster; respect 80-col budget; theme-colored

**Effort:** M | **Priority:** P1

### Default review-queue sections
**What:** First-class default sections — "Needs My Review", "Mine", "Involved" — selectable without hand-building filters. (Builds on custom tabs, #66.)
**Why:** The everyday PR-reviewer workflow is "what needs me right now," not "browse all open PRs."
**How:** Predefined section presets in `src/config.js`; section switcher in the PR pane header; reuse the multi-state filter + scope plumbing.

**Effort:** M | **Priority:** P1

### Assign issue/PR to a coding agent
**What:** From an issue or PR, hand the task to a coding agent (Copilot/Claude/Codex) via `gh`.
**Why:** Closes the loop — supervise *and* dispatch agents from the same cockpit.
**How:** New executor call wrapping `gh`'s agent-assignment; confirm dialog; optimistic toast; refresh after dispatch.

**Effort:** M | **Priority:** P2

### Bulk-select PRs for labels/assignees/close
**What:** Space toggles selection; `B` opens a bulk-action menu.
**Why:** Triage forces one-PR-at-a-time roundtrips today; pairs directly with the agent queue.
**How:** `selection: Set<number>` in pane state; `*` gutter marker; `src/features/prs/bulk.jsx` runs `gh pr edit` per item with progress + partial-failure summary; confirm destructive actions.

**Effort:** M | **Priority:** P1

### PR detail visual hierarchy refresh
**What:** Restructure into title bar → meta strip (CI/review/labels) → body → activity timeline.
**Why:** Currently too dense to skim; first-time users bounce.
**How:** Split `src/features/prs/detail.jsx` into subcomponents; subtle section dividers; collapse body to ~12 lines (Space to expand); timeline shows last 8 events.

**Effort:** M | **Priority:** P1

### Comment composer: thread context pane
**What:** While composing a line comment, show file path, line range, and existing thread above the input.
**Why:** Composing blind to context causes wrong-line replies — and this is the agent control channel, so accuracy matters more.
**How:** Split the composer in `src/features/prs/diff.jsx` into context box + input; show `file:line` + last 3 messages.

**Effort:** S | **Priority:** P1

### PR → base dependency / stack view
**What:** Visualize the head→base chain so dependent PRs read as a stack.
**Why:** Large changes are increasingly split into small dependent PRs; seeing the chain aids review order.
**How:** Group list rows by base branch; indent dependents; derive from `baseRefName` already in the payload. Visualization only — not a restructuring tool.

**Effort:** M | **Priority:** P2

---

## Phase 3 — Scale & Enterprise (1 month)

### Multi-repo support
**What:** Switch active repo via `:repo owner/name` or a picker.
**Why:** Single-repo binding is the biggest scaling limit for the agent-fleet and enterprise use cases.
**How:** Repo from constant → context in `src/app.jsx`; per-repo pane-state cache keyed by `owner/name`; status bar shows current repo.
**Effort:** L | **Priority:** P1

### Live CI streaming (`gh pr checks --watch`)
**What:** Watch CI for the current PR/branch live, in-pane.
**Why:** A core anti-context-switch workflow; complements interactive CI checks (#73) and watch mode (#63).
**How:** Stream `gh pr checks --watch`; render rows that update in place; cancel on view exit.
**Effort:** M | **Priority:** P1

### Saved searches / named views
**What:** Name a (pane + filter + scope) combo, recall via `V`.
**Why:** Repeat queries ("my stale open PRs >14d", "agent PRs failing CI") are daily.
**How:** Persist `views[]` in config; `:save <name>` in command palette; view picker modal.
**Effort:** M | **Priority:** P2

### Background refresh + event toasts
**What:** Periodic poll; toast when a watched PR gets a new review/comment/CI result.
**Why:** Turns lazyhub into a passive monitor — especially useful watching an agent fleet.
**How:** `src/services/poller.js` with per-pane TTL; diff vs last snapshot; throttled toasts. (Builds on #67.)
**Effort:** L | **Priority:** P2

### Merge-queue awareness
**What:** Show merge-queue position/state for PRs when a queue is configured.
**Why:** Merge queues are standard in 2026; blind spots cause confusion about "why isn't this merged."
**How:** Read queue state via `gh api`; render a queue glyph/column when present.
**Effort:** M | **Priority:** P2

### Recently-viewed history (`H`)
**What:** `H` opens recently viewed PRs/issues/branches; Enter jumps back.
**Why:** Common navigation pattern; low cost.
**How:** Ring buffer (size 50) in `src/utils.js`; persist under `recent[]`; modal in `src/features/recent.jsx`.
**Effort:** S | **Priority:** P2

### Plugin / external command hooks
**What:** Config-defined key bindings that run a shell command against the current selection.
**Why:** Lets users extend (checkout, deploy, notify) without forking.
**How:** `commands[]` in `src/config.js`; interpolate `{number}`/`{repo}`/`{branch}`/`{url}`; spawn with TTY pause/resume.
**Effort:** M | **Priority:** P2

---

## Phase 4 — Ecosystem (future)

### AI summarization for long threads
`S` summarizes a long PR/issue thread; reuse existing AI plumbing; cache by node ID. **Effort:** M | **Priority:** P2

### Theme sharing / install
`lazyhub theme install <gist-url>` — fetch + schema-validate a theme JSON. **Effort:** S | **Priority:** P2

### Web companion via IPC
Optional local web viewer mirroring pane state over the existing IPC socket — a viewer, not a port. **Effort:** L | **Priority:** P2

### Provider adapters (GitLab / Gitea)
Abstract `executor.js` behind a provider interface; auto-detect from remote host. **Effort:** L | **Priority:** P2

---

## Non-Goals

- **Mouse-first UX.** Mouse stays optional; never required.
- **Hover tooltips, popups, animations.** Terminal-incompatible or noisy.
- **A web-only mode.** TUI first; the web companion is a viewer.
- **Bundling our own GitHub auth.** `gh` remains the auth and data boundary.
- **New runtime dependencies** without strong justification.
- **Custom layout engine.** Stay on yoga/Ink; don't hack around overlay limits.
- **Sub-80-column support.** 80 cols is the floor.
- **Out-stacking dedicated stacked-diff tools.** We *visualize* dependency chains; we do not restructure git history.
- **Editor-grade text editing in the comment composer.** Multi-line + basic keys is enough.

---

## Tech Debt to Address

### React anti-patterns
- **Stale closures in keyscope handlers** (`src/keyscope.js`) — audit `useKeyScope` callsites; ref-based reads or getters.
- **Pane-local state split between refs and state** in `usePaneState` — unify (see Phase 1).
- **No abort on data fetches** — rapid Tab-switching races; add an `AbortController` per `src/executor.js` call.
- **Theme tokens prop-drilled** — migrate to a `ThemeContext` so live theme switching works without remounts.

### Build system
- `node build.js` has no watch/incremental mode — add `--watch` via esbuild.
- No source maps in `dist/lazyhub.js` — emit external sourcemaps in dev so user stack traces are usable.
- Bundle size untracked — CI step that prints size and fails on >10% growth without override.

### Test coverage
- Zero tests on `usePaneState`, keyscope precedence, executor error envelopes — the highest-bug-density modules.
- Snapshot tests for list rows at 80/120/160 cols.
- Integration smoke test against a fixture `gh` shim driving key sequences (overlaps #140/#141).
- Turn on `eslint-plugin-react-hooks` `exhaustive-deps` as error.

### Terminal compatibility
- **Truecolor assumed** — add `colorDepth` detection + 256-color degradation (overlaps #129 high-contrast/NO_COLOR).
- **Wide-char (CJK/emoji) column math** assumes 1 cell/char — use a width helper everywhere (overlaps #137 ZWJ flake).
- **Windows** — `gh`/stdin handoff is flaky; document supported platforms or feature-flag IPC.
- **Resize (SIGWINCH)** — audit panes that don't recompute scroll window.

### Code organization
- `src/utils.js` is a junk drawer — split into `format`/`time`/`width`/`triage`.
- `src/executor.js` (>1000 lines) — provider-abstract before Phase 4 doubles it.
- Standardize feature folders on `index.jsx` + siblings (`search.jsx`, `bulk.jsx`, `agentQueue.jsx`).
