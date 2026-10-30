# lazyhub — Architecture & Point of Truth

> **Purpose of this file:** Single source of truth for any AI coding assistant or human contributor. Read this before touching any file. It documents every architectural decision, every known bug (with root cause + fix), and every invariant.

---

## 1. The Core Vision
lazyhub is a terminal-based UI for GitHub, heavily inspired by the keyboard-driven UX of `lazygit`.
- **Pure ESM**: Modern Node.js architecture.
- **Ink-Powered**: React-based TUI framework.
- **gh-CLI First**: All GitHub operations MUST happen via the official `gh` CLI.

---

## 2. Elite CI/CD & Staging Strategy

We use an **Enterprise Staging Model** to ensure 100% stable production releases.

| Branch | Action | Purpose |
| :--- | :--- | :--- |
| **Feature** | PR to `main` | Primary integration area. |
| **`main`** | **Release PR** | When ready to ship, `workflow_dispatch` opens a PR from `main` to a new release branch. |
| **`release`** | **Promotion** | Merging the release PR into `main` triggers production deploy. |

### The "Circular Sync" Pattern
To prevent merge conflicts and "branch drift":
1. **Prep**: Bot opens PR from `main` -> `release` with AI docs + version bump.
2. **Deploy**: Merging `release` -> `main` creates Tag + Publishes.
3. **Sync**: Bot automatically opens a **Sync PR** from `main` back to `release` to keep staging in sync with production.

---

## 3. Branch Protection (Ruleset enforced)

| Setting | `main` | `release` |
|---|---|---|
| Required checks | Test (Node 20/22), Dependency audit | same |
| strict (up-to-date) | `false` | `true` |
| Required reviews | 1 approval, dismiss stale | + admin review |
| Linear history | yes | yes |
| Force push | **BLOCKED** | **BLOCKED** |
| Deletions | blocked | blocked |
| enforce_admins | yes | yes |

---

## 4. Required Secrets

| Secret | Used by | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `release.yml`, `claude-review.yml` | AI Code Reviews & Release Notes |
| `GEMINI_API_KEY` | `release.yml`, `growth-engine.yml` | AI Architecture Docs & Marketing |
| `NPM_TOKEN` | `publish.yml` | `npm publish` authorization |
| `TAP_TOKEN` | `publish.yml` | Homebrew formula updates |
| `GITHUB_TOKEN` | all workflows | GitHub Actions built-in |

---

## 5. Development Invariants

1. **`src/executor/core.js` is the only implementation file that calls `gh`**. Public imports still go through `src/executor.js`, which is a barrel over the split executor modules.
2. **`useTheme()` not `import { t }`** — always use the hook in components.
3. **FuzzySearch always gets objects**, never strings.
4. **GraphQL integer variables use `-F`**, string variables use `-f`.
5. **`notifyDialog(true/false)`** must be called by any component that opens/closes a dialog.
6. **`ErrorBoundary` wraps every view branch** in `app.jsx`.
7. **`sanitize()`** every string from GitHub API before rendering in Ink components.
8. **`src/ai/providers/anthropic-api.js` is the only file that makes Anthropic HTTP calls. All AI calls (any provider) go through `src/ai/index.js`.**

---

## 6. Quality Control (Deterministic)

- **Dead Code:** Run `npx knip` to find unused files and exports.
- **Architectural Linting:** `npm run lint` enforces the "Executor Pattern".
- **Validation:** Always run `npm test` before any PR merge.
- **PTY Acceptance:** `npm run test:pty` exercises the built CLI in a real pseudo-terminal when `node-pty` can spawn. It covers smoke navigation plus crash restoration, degraded `gh` recovery, opt-in perf writes, and stale-while-revalidate cache first-frame behavior.

## 7. Runtime Resilience & Performance

- Fatal crashes install handlers before Ink renders. The shared `src/crash.js` restore path leaves the alternate screen, shows the cursor, disables mouse tracking/raw mode where possible, and prints the bug-report pointer.
- `useGh()` serves stale-while-revalidate data from `~/.cache/lazyhub/data/` when available, then refreshes in the background. Corrupt cache files are misses; mutation paths invalidate the affected repo cache coarsely.
- `useGhHealth()` tracks failed gh-backed calls globally. The status bar renders a sanitized degraded-state banner with retry guidance and clears automatically after successful refreshes.
- `LAZYHUB_PERF=1` records `runGh()` duration and keypress-to-render latency to `~/.cache/lazyhub/perf.ndjson`. `lazyhub perf report` summarizes count, p50, p95, and max per operation.

---

## 21. Complete bug fix log (reference)

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

**B-89 — Multiple PR state filters only fetched open PRs (#368)**
- Symptom: Open+Merged showed only open PRs; Closed+Merged showed no PRs.
- Root cause: the pane requested `state: 'all'`, but `prSearchQuery()` treated it as unknown and defaulted to `state:open`, excluding other states before client-side filtering.
- Fix: recognize `all` and omit the search state qualifier while retaining other filters and the open default for missing/unknown states. Regression coverage: `src/executor.test.js`. Sibling sweep: Issues passes states directly to `gh`; Branches requests open PRs intentionally; Actions and Notifications have no equivalent state conversion.

**B-90 — Issue editor tests intermittently lost the first key**
- Symptom: the assignee editor test stayed on the issue list instead of opening the dialog.
- Root cause: `sendInput()` took its handler snapshot before flushing pending mount effects; a visible frame or timer delay did not guarantee the input handler was registered.
- Fix: mount the issue test views inside awaited `act()` so effects finish before input. A regression test sends `A` immediately after mounting without a timer delay. Sibling pane flows use their existing input driver; the shared input helper is unchanged.

**B-91 — Debug Logs crashed with `useStdout is not defined` (#372)**
- Symptom: opening Debug Logs showed an error screen instead of the log list.
- Root cause: `LogPane` referenced `useStdout`, `Box`, and `Text` without importing them from Ink; existing tests mocked the pane.
- Fix: import the missing Ink symbols. `src/features/logs/index.test.jsx` renders the real pane and exercises level filtering, search, details, and back navigation. The test reproduced the ReferenceError before the fix. Sibling sweep: PRs, Issues, Branches, Actions, and Notifications already import the Ink symbols they use.
