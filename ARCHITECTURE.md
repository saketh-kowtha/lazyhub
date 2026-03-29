# lazyhub — Architecture & Point of Truth

> **Purpose of this file:** Single source of truth for any AI coding assistant or human contributor. Read this before touching any file. It documents every architectural decision, every known bug fix, every invariant, and every pattern used in the codebase. Following this document precisely will prevent regression and token waste.

---

## 1. What this project is

**lazyhub** is a lazygit-style keyboard-driven terminal UI over the `gh` CLI. It surfaces every GitHub action (PRs, issues, labels, reviewers, merge strategies, diff + line comments, Actions logs, notifications) without leaving the terminal.

- **npm package name:** `lazyhub`
- **Binary:** `lazyhub` (via `dist/lazyhub.js`, built with esbuild)
- **GitHub:** `saketh-kowtha/lazyhub`
- **Homebrew tap:** `saketh-kowtha/homebrew-tap` → `Formula/lazyhub.rb`

---

## 2. Stack

| Layer | Library | Version |
|-------|---------|---------|
| Runtime | Node.js ESM | ≥20 |
| TUI framework | Ink | ^4.4.1 |
| UI components | React | ^18.2.0 |
| CLI executor | execa | ^8.0.1 |
| Syntax highlight | highlight.js | ^11.9.0 |
| Time format | timeago.js | ^4.0.2 |
| Colors (terminal) | chalk | ^5.3.0 |
| Tests | vitest | ^1.4.0 |
| Build | esbuild (custom `build.js`) | ^0.27.4 |

All source is **ESM** (`"type": "module"` in package.json). No CommonJS.

---

## 3. Directory structure

```
lazyhub/
├── bin/ghui.js              ← entry: bootstrap() then renderApp()
├── build.js                 ← esbuild config (bundles src/ → dist/lazyhub.js)
├── src/
│   ├── app.jsx              ← root Ink layout, global key handler, view router
│   ├── bootstrap.js         ← pre-Ink: gh detect, auth, repo picker
│   ├── context.js           ← AppContext (notifyDialog, openHelp, setMouseEnabled)
│   ├── config.js            ← loads/saves ~/.config/lazyhub/config.json
│   ├── executor.js          ← ALL gh CLI calls live here — never call gh elsewhere
│   ├── ai.js                ← Anthropic API client — NOT in executor.js (no gh). getAICodeReview()
│   ├── theme.js             ← ThemeProvider, useTheme() hook, resolveTheme()
│   ├── utils.js             ← sanitize, copyToClipboard, TextInput, getMarkdownRows,
│   │                           colorChalk, bgColorChalk, applyThemeStyle, logger, getLogs
│   ├── themes/              ← github-dark, github-light, catppuccin-mocha,
│   │                           catppuccin-latte, tokyo-night, ansi-16
│   ├── components/
│   │   ├── ErrorBoundary.jsx   ← React class, catches render crashes, logs+shows title
│   │   ├── AIReviewPane.jsx    ← overlay component for AI review results (j/k/Enter/p/q)
│   │   ├── Sidebar.jsx
│   │   ├── StatusBar.jsx
│   │   ├── FooterKeys.jsx
│   │   ├── CustomPane.jsx
│   │   └── dialogs/
│   │       ├── FuzzySearch.jsx    ← items must be OBJECTS (see §8)
│   │       ├── MultiSelect.jsx
│   │       ├── OptionPicker.jsx
│   │       ├── ConfirmDialog.jsx
│   │       ├── FormCompose.jsx
│   │       └── LogViewer.jsx
│   ├── features/
│   │   ├── prs/
│   │   │   ├── list.jsx
│   │   │   ├── detail.jsx
│   │   │   ├── diff.jsx
│   │   │   ├── comments.jsx
│   │   │   └── NewPRDialog.jsx
│   │   ├── issues/
│   │   │   ├── list.jsx
│   │   │   └── detail.jsx
│   │   ├── branches/index.jsx
│   │   ├── actions/index.jsx
│   │   ├── notifications/index.jsx
│   │   ├── releases/index.jsx
│   │   ├── gists/index.jsx
│   │   ├── settings/index.jsx
│   │   └── logs/index.jsx
│   └── hooks/
│       ├── useGh.js         ← wraps executor with loading/error/data + 30s TTL cache
│       ├── useNav.js
│       └── useDialog.js
├── .github/
│   ├── workflows/release.yml
│   └── scripts/prepare-release.mjs
├── docs/                    ← gh-pages site
├── ARCHITECTURE.md          ← THIS FILE
└── package.json
```

---

## 4. Startup sequence (bootstrap.js → app.jsx)

1. `bin/ghui.js` calls `bootstrap()` first — no Ink yet
2. **bootstrap step 1** — detect `gh`: if missing, print platform-specific install instructions and `process.exit(1)`. Never throw.
3. **bootstrap step 2** — `gh auth status`: if fails, run interactive login (browser or PAT via stdin). Re-check; exit(1) on second failure.
4. **bootstrap step 3** — `gh repo view --json name,owner,defaultBranchRef`: if fails (not in git repo), show raw readline repo picker from `gh repo list`. Store chosen repo in `process.env.GHUI_REPO`.
5. **bootstrap step 4** — call `renderApp()` from `app.jsx`. Ink starts here.

`renderApp()` enters the alternate screen buffer (`\x1b[?1049h`), registers SIGINT/SIGTERM/exit hooks to restore it, then calls `render(<ThemeProvider><App /></ThemeProvider>)`.

---

## 5. app.jsx — layout, routing, global keys

### View states
`view` is a string: `'list' | 'detail' | 'diff' | 'comments' | 'settings' | 'logs'`

Views are full-screen renders returned early from `App`. Precedence (top = highest):
1. `showHelp` → `HelpOverlay`
2. `view === 'diff'` → `PRDiff`
3. `view === 'comments'` → `PRComments`
4. `view === 'logs'` → `LogPane`
5. `view === 'settings'` → `SettingsPane`
6. `view === 'detail'` → `PRDetail` or `IssueDetail`
7. default → list layout with sidebar + list pane + optional detail panel

### Layout breakpoints
- `columns >= 100`: sidebar (18) + list (flex) + detail panel (40)
- `columns >= 80`: sidebar + list only
- `columns < 80`: list only (sidebar replaced by tab headers)

### Global key handler
`useInput` in `App` fires ONLY when `dialogActiveRef.current === false`. Any component that opens a dialog calls `notifyDialog(true)` via `AppContext` to suppress global keys.

### AppContext shape
```js
{ notifyDialog: fn(bool), openHelp: fn(), setMouseEnabled: fn(bool) }
```

`setMouseEnabled` is needed by `SettingsPane` to activate/deactivate mouse at runtime without restart.

### ErrorBoundary wrapping
Every major view branch in `app.jsx` is wrapped in `<ErrorBoundary>`:
- `PRDiff`, `PRComments`, `LogPane`, `SettingsPane`, `PRDetail`/`IssueDetail`, and `renderListPane()` output.

---

## 6. executor.js — the only place `gh` is called

**Rule: never call `execa('gh', ...)` anywhere outside `executor.js`.**

Exceptions that use `execa` directly are local git operations (`getCurrentBranch`, `getUnpushedCommits`, `pushBranch`) which are not `gh` calls.

### run(args) contract
- `exitCode === 0` + JSON stdout → parsed object
- `exitCode === 0` + non-JSON stdout → raw string (diff output)
- `exitCode === 0` + empty stdout → `null`
- non-zero exit → throws `GhError { message, stderr, exitCode, args }`

Sensitive tokens/IDs ≥20 chars are redacted in error output with `[REDACTED]`.

### GH_HOST support
When `process.env.GH_HOST` is set, `run()` prepends `['--hostname', GH_HOST]` to all args. This is the only GitHub Enterprise hook.

### Critical GraphQL variable typing

`gh api graphql` uses two flag types:
- `-f key=value` → string field
- `-F key=value` → **non-string field (integer, boolean)**

GraphQL schema types must match:
- `$owner: String!` → `-f owner=...`
- `$name: String!` → `-f name=...`
- `$number: Int!` → **`-F number=...`** ← wrong flag causes GraphQL type error

**This was a regression introduced by a bad commit. Always use `-F` for integer GraphQL variables.**

### addPRLineComment — stdin pipe pattern
Uses `execa('gh', [...args])` with `proc.stdin.write(payload)` + `proc.stdin.end()` because `--input -` reads the JSON body from stdin. This is the only executor function that doesn't use `run()`.

### listPRComments — GraphQL structure
Fetches `reviewThreads` to get the thread node ID (needed for `resolveReviewThread` mutation). REST API does not expose thread IDs. The response is flattened into a flat array of comment objects, each carrying `threadId` and `threadResolved`.

`diffSide` is NOT available in the GraphQL schema — removed from the query. Always defaults to `'RIGHT'`.

---

## 7. useGh.js — data fetching hook

```js
const { data, loading, error, refetch } = useGh(fetchFn, [dep1, dep2], { ttl: 30000 })
```

- Cache key = `JSON.stringify([fetchFn.name, ...deps])`
- Default TTL = 30 seconds
- `refetch()` bypasses cache (bypass flag = true)
- `r` key in every pane calls `refetch()`
- Uses `mountedRef` to prevent state updates on unmounted components
- `invalidateCache(keyPrefix)` and `clearCache()` are exported for manual invalidation

---

## 8. FuzzySearch — items must be objects

**Critical invariant:** `FuzzySearch` always receives an array of **objects**, never plain strings.

The helper functions read `item.title`, `item.name`, `item.number`, `item[searchField]`. A plain string has none of these properties → nothing matches → nothing displays.

**Correct usage for file jump in diff.jsx:**
```jsx
<FuzzySearch
  items={files.map(f => ({ name: f.filename }))}
  searchFields={['name']}
  onSubmit={(item) => { /* use item.name */ }}
/>
```

**Wrong (breaks silently):**
```jsx
items={files.map(f => f.filename)}  // ← plain strings, never matches
```

For PR/Issue lists, items are already objects with `title`, `number`, `author` etc.

---

## 9. Theme system

### useTheme()
Returns `{ t, themeName, setTheme }`. Always call inside a component:
```js
const { t } = useTheme()
```

**Never import the static `t` constant directly** — use the hook for reactive theme support.

### t object shape (abridged)
```js
t.pr.open / merged / closed / draft
t.issue.open / closed
t.ci.pass / fail / pending / running
t.ui.selected / muted / dim / border / headerBg
t.diff.addBg / addFg / delBg / delFg / ctxFg / hunkFg / hunkBg
t.diff.threadBg / threadBorder / cursorBg / addSign / delSign / cursorBg
t.syntax.keyword / string / number / comment / fn / type / ...
```

### Theme config formats (all resolved in theme.js)
- `"github-dark"` — built-in name string
- `"/absolute/path.json"` or `"~/path.json"` — custom JSON file
- `{ name: "tokyo-night", overrides: { ui: { selected: "#ff0" } } }` — named + deep merge
- `{ ui: { selected: "#ff0" } }` — legacy plain overrides on top of github-dark

---

## 10. ErrorBoundary — `src/components/ErrorBoundary.jsx`

React class component. Catches render crashes that would otherwise unmount the entire app.

**Behaviour:**
1. `componentDidCatch` → calls `logger.error(...)` → writes to `~/.config/lazyhub/debug.log`
2. Renders a red bordered box showing only the error message (no stack trace)
3. `[Enter / Esc]` calls `handleDismiss()` → resets `hasError` to false → re-renders children

**Usage — always wrap view-level branches:**
```jsx
<ErrorBoundary>
  <PRDiff ... />
</ErrorBoundary>
```

**Do not wrap at the component-definition level** (wrapping in app.jsx keeps each pane independently recoverable).

---

## 11. Mouse support

Mouse is **off by default** and controlled by two mechanisms:
1. `config.mouse === true` in `~/.config/lazyhub/config.json`
2. `LAZYHUB_MOUSE=1` environment variable (useful in CI/scripts)

The `App` component holds `mouseEnabled` in `useState` initialised from `_config.mouse || LAZYHUB_MOUSE`. The `SettingsPane` calls `setMouseEnabled(next)` from `AppContext` when the user toggles the setting, taking effect immediately without restart.

### How mouse events are injected
```js
// In app.jsx useEffect([mouseEnabled])
process.stdin.prependListener('data', handleData)  // prependListener so we run before readline
// SGR mouse: \x1b[<Btn;X;YM
// btn 64 = scroll up → 'k', btn 65 = scroll down → 'j'
process.stdin.emit('keypress', 'k', { name: 'k', sequence: 'k', ctrl: false, meta: false, shift: false })
```

**Critical:** the first argument to `process.stdin.emit('keypress', ...)` MUST be the character string (`'j'`/`'k'`), not `null`. Ink's `useInput` receives this as the `input` parameter. If `null`, then `input === 'j'` fails and scrolling silently does nothing.

**Critical:** use `prependListener` not `on` so the handler fires before readline parses the same bytes.

### Non-goal clarification
Mouse support is listed in CLAUDE.md Non-goals, but a minimal scroll-only implementation exists. The architecture deliberately keeps it opt-in and limited to scroll. Full click/hover mouse support remains out of scope.

---

## 12. Diff view (`src/features/prs/diff.jsx`)

### Key functions defined at module level
These were previously missing (placeholder comments) and caused crashes:

- **`getLang(filename)`** — maps file extension to highlight.js language ID. Returns `null` for unknown extensions (syntax highlighting skips gracefully).
- **`openEditorSync(initial)`** — spawns `$EDITOR`/`$VISUAL`/`vi` synchronously via `spawnSync`, writes body to a temp file, reads it back. Used when user presses `e` in compose mode.

### Import requirements
`sanitize` from `../../utils.js` is required in `renderThreads()`. It is imported alongside other utils:
```js
import { TextInput, colorChalk, bgColorChalk, applyThemeStyle, sanitize } from '../../utils.js'
```

### Compose mode state shape
```js
compose = null
  | { mode: 'new',    commentType: 'comment'|'suggestion'|'request-changes', body: '' }
  | { mode: 'reply',  rootCommentId: number, body: '' }
  | { mode: 'edit',   commentId: number, body: '' }
  | { mode: 'delete', commentId: number, commentBody: '' }
```

### Large diff guard
If `(additions + deletions) > 5000`, shows a warning screen before rendering. User must press Enter to proceed or `o` to open in browser.

### File jump (`f` key)
Opens `FuzzySearch` with file objects — see §8 for the correct call pattern.

---

## 13. PR Comments view (`src/features/prs/comments.jsx`)

**Import rule:** import `useTheme` (not the static `t`):
```js
import { useTheme } from '../../theme.js'  // ← correct
// NOT: import { t } from '../../theme.js'  // ← wrong, causes crash
```

The `useTheme()` hook is called at the top of `PRComments`. All theme access goes through `const { t } = useTheme()`.

### Flat comment list model
Comments from `listPRComments` are grouped into root + replies and flattened into a single navigable array. Each entry carries `_isRoot: bool` and `_rootId` (for replies). This drives the `r` (reply) key — which finds the root comment ID before calling `replyToComment`.

### `resolveThread` requires threadId
The `R` key resolves a thread by its GraphQL node ID (`threadId`, e.g. `PRRT_kwDO...`). This ID comes from the `reviewThreads` GraphQL query in `listPRComments`. If `threadId` is null, a flash message is shown and nothing happens.

---

## 14. Issue detail (`src/features/issues/detail.jsx`)

### Sub-dialog `t` scope rule
Every sub-dialog function (`IssueLabelDialog`, `IssueAssigneeDialog`, etc.) that renders Ink `<Text color={t...}>` MUST call `const { t } = useTheme()` inside the function body. Forgetting this causes `ReferenceError: t is not defined` when the dialog opens.

**Correct pattern:**
```jsx
function IssueLabelDialog({ repo, issue, onClose }) {
  const { t } = useTheme()           // ← required
  const { data, loading } = useGh(listLabels, [repo])
  if (loading) return <Box><Text color={t.ui.muted}>Loading...</Text></Box>
  ...
}
```

This same pattern applies in `PRDetail` sub-dialogs and anywhere `useTheme` is needed in a nested function component.

---

## 15. Log viewer (`src/features/logs/index.jsx`)

### Log file location
`~/.config/lazyhub/debug.log` — append-only JSON lines. `getLogs()` reads, parses, and reverses (newest first).

### Log format
```json
{ "timestamp": "ISO8601", "level": "INFO|WARN|ERROR|DEBUG", "message": "...", ...meta }
```

### Clipboard copy (`y` key)
- In list view: `y` copies selected log entry as formatted JSON
- In detail view: `y` copies open entry
- Uses `copyToClipboard(text)` from `utils.js` (macOS: `pbcopy`, Windows: `clip`, Linux: `xclip -selection clipboard`)
- Copy status (`✓ Copied` / `✗ Copy failed`) displayed for 2 seconds

### Auto-refresh
`setInterval(refreshLogs, 5000)` — log list refreshes every 5 seconds while the pane is open.

---

## 16. Settings pane (`src/features/settings/index.jsx`)

### Required imports
```js
import { logger } from '../../utils.js'           // ← required, used in updateConfig
import { AppContext } from '../../context.js'      // ← for setMouseEnabled
```

### Mouse toggle flow
```
User presses Enter on "Mouse Support"
→ dialog === 'mouse'
→ updateConfig({ mouse: !config.mouse })   // saves to ~/.config/lazyhub/config.json
→ setMouseEnabled(next)                    // updates App useState → triggers useEffect
→ mouse tracking enabled/disabled immediately without restart
```

### Theme change flow
`updateConfig({ theme: name })` → `setTheme(name)` from `useTheme()` → `ThemeProvider` re-renders with new theme → entire app re-themes instantly.

---

## 17. utils.js — shared utilities

### copyToClipboard(text) → Promise
```js
import { copyToClipboard } from './utils.js'
copyToClipboard(someText)
  .then(() => showStatus('✓ Copied'))
  .catch(() => showStatus('✗ Copy failed'))
```
Platform detection: `darwin` → `pbcopy`, `win32` → `clip`, else → `xclip -selection clipboard`.

### TextInput component
Custom Ink text input with cursor, supporting:
- `Ctrl+A` / `Ctrl+E` — start/end of line
- `Ctrl+U` — clear line
- `Ctrl+K` — clear to end
- `←` / `→` — cursor movement
- `backspace` / `delete` — character deletion
- `mask` prop — password masking
- `onEnter` prop — callback on Enter key

Props: `value, onChange, placeholder, focus, mask, onEnter`

Always render with `focus={true}` when the input should be active.

### sanitize(str)
Strips ANSI escape codes from untrusted strings before rendering in `<Text>`. Use on all content from GitHub API responses that will appear in the TUI.

### applyThemeStyle(text, fg, bg)
Applies chalk fg+bg colors from hex strings or named chalk colors. Safe — won't throw for unknown color values.

### getMarkdownRows(text, maxWidth, t)
Converts markdown body text into an array of Ink `<Box>/<Text>` React elements. Handles: headers, lists, code blocks (syntax highlighted), bold, italic, inline code, paragraph wrap.

### logger
```js
logger.info(msg, meta)
logger.warn(msg, meta)
logger.error(msg, err, meta)   // err is an Error object
logger.debug(msg, meta)
```
Never throws. Failures to write the log file are silently swallowed.

---

## 18. Config file — `~/.config/lazyhub/config.json`

Full schema:
```json
{
  "panes": ["prs", "issues", "branches", "actions", "notifications"],
  "defaultPane": "prs",
  "theme": "github-dark",
  "mouse": false,
  "anthropicApiKey": "sk-ant-...",    // optional — enables A key AI review in diff view
  "customPanes": {
    "my-id": {
      "label": "Label",
      "icon": "◈",
      "command": "gh api ... --jq '...'",
      "actions": { "o": "open" }
    }
  },
  "pr":     { "defaultFilter": "open", "defaultScope": "all", "pageSize": 100,
               "keys": { "filterOpen": "O", "filterClosed": "C", "filterMerged": "M" } },
  "issues": { "defaultFilter": "open", "pageSize": 50,
               "keys": { "filterOpen": "O", "filterClosed": "C" } },
  "actions": { "pageSize": 30 },
  "diff":   { "defaultView": "unified", "syntaxHighlight": true, "maxLines": 2000 }
}
```

`loadConfig()` merges user values onto defaults section-by-section. Unknown keys are ignored. Validation: custom pane must have a `command` string.

---

## 19. CI/CD — `.github/workflows/release.yml`

Triggered on: merged PR to `main`.

### Steps
1. `prepare-release.mjs` — uses Claude API to decide version bump, writes `package.json` + `CHANGELOG.md` + release notes to `/tmp/release-notes.md`, outputs `version` step output.
2. Commit version bump + changelog (`[skip ci]`).
3. `gh release create`.
4. `npm publish --access public` (skips gracefully if `NPM_TOKEN` not set).
5. **Compute tarball SHA256** — polls npm CDN for HTTP 200 (18 × 10s = up to 3 minutes) before fetching. Uses `--retry-all-errors` so CDN 404s during propagation trigger retries. Guards against empty SHA before writing to `GITHUB_OUTPUT`.
6. **Push Homebrew formula** — getContent to read current file SHA (needed for update). Catches only HTTP 404 (file absent = first release). Rethrows 403/500/etc.

### SHA256 step — critical curl flags
```bash
SHA=$(curl -fsSL --retry 5 --retry-delay 5 --retry-all-errors "$URL" | sha256sum | awk '{print $1}')
[ -z "$SHA" ] && echo "ERROR: SHA256 is empty" && exit 1
```
- `--retry-all-errors` is **required** — without it `--retry` only fires on network errors, not HTTP 4xx/5xx. A CDN 404 under `-f` would pipe empty input to `sha256sum`, producing `e3b0c44...` (SHA256 of empty string) and committing a wrong checksum to the tap.
- The empty SHA guard prevents a silent bad commit.

### getContent error handling
```js
try {
  const { data } = await github.rest.repos.getContent({ owner, repo, path })
  sha = data.sha
} catch (err) {
  if (err.status !== 404) throw err  // only ignore "file not found"
}
```
403 (bad TAP_TOKEN) and 500 errors must propagate, not be swallowed.

---

## 20. AI Inline Code Review — `A` key in diff view

### What it does
Press `A` in the diff view → Claude analyzes the diff → suggestions appear as an overlay.
- `j/k` navigate suggestions
- `Enter` jumps to the relevant file+line in the diff
- `p` posts the suggestion as a real GitHub PR line comment
- `q` / Escape closes the overlay

### Module: `src/ai.js`
The ONLY place that calls the Anthropic API. Uses Node 20+ built-in `fetch()`.

**NOT in `executor.js`** — executor.js is gh-CLI-only. `ai.js` is a separate category.

```js
import { getAICodeReview, AIError } from './ai.js'
const { summary, suggestions } = await getAICodeReview({ diff, prTitle, prBody, apiKey })
// suggestions: [{ file, line, severity: 'bug'|'warning'|'suggestion', comment }]
```

**Error types:**
- HTTP 401 → `AIError('Invalid API key', { status: 401 })`
- HTTP 429 → `AIError('Rate limit exceeded — try again shortly', { status: 429 })`
- HTTP 5xx → `AIError('Anthropic service error — try again', { status })`
- Parse fail → `AIError('Could not parse AI response as JSON')`
- Bad shape → `AIError('AI response format was unexpected')`

**Diff is truncated to 8000 chars** before sending to stay within token budget.

### Config: `anthropicApiKey`
Stored as a top-level key in `~/.config/lazyhub/config.json`. `loadConfig()` passes it through as-is (no default, no merging). Set via Settings pane (`s` → AI API Key).

```json
{ "anthropicApiKey": "sk-ant-..." }
```

### Component: `src/components/AIReviewPane.jsx`
Self-contained overlay component. Props: `suggestions, summary, onJumpTo, onPost, onClose, postStatus`.

Uses `useTheme()` for severity colors:
- `bug` → `t.ci.fail`
- `warning` → `t.ci.pending`
- `suggestion` → `t.ui.muted`

### Integration in `diff.jsx`
State added to `PRDiff`:
```js
const [aiReview, setAiReview]           = useState(null)
const [aiReviewLoading, setAiReviewLoading] = useState(false)
const [aiReviewError, setAiReviewError] = useState(null)
const [aiPostStatus, setAiPostStatus]   = useState(null)
```

`notifyDialog` condition includes `aiReview || aiReviewLoading`.

`useInput` guard: `if (aiReview) return` (after `fileJumpActive` guard).

`A` key handler calls `getAICodeReview` imperatively from useInput (not from useEffect).

### Critical invariants for AI feature
- `getAICodeReview` is called imperatively from `useInput`, never from `useEffect`
- `loadConfig().anthropicApiKey` is read at call time — not cached at module scope
- `ai.js` is the ONLY file that imports from Anthropic API — never duplicate this logic

---

## 21. Complete bug fix log (reference)

Every bug fixed in this codebase, with root cause and fix. Reference before touching related code.

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

---

## 22. Non-goals (hard scope limits)

These are explicitly out of scope. Do not implement, do not document as features:

- Full mouse support (click, hover) — only scroll is supported as opt-in
- GitHub Enterprise (placeholder: `GH_HOST` env var for later)
- Config file / multiple theme files (themes built-in only; custom path is supported)
- SSH key management
- Wiki editing
- Repo settings / branch protection rule editing
- Mouse support toggle advertised in README (removed — opt-in only, not a headline feature)

---

## 23. Key invariants — check before every change

1. **`executor.js` is the only file that calls `gh`** — enforced by `no-restricted-imports` in ESLint.
2. **`useTheme()` not `import { t }`** — always use the hook in components
3. **`useTheme()` in every nested function component** that renders themed text
4. **FuzzySearch always gets objects**, never strings
5. **GraphQL integer variables use `-F`**, string variables use `-f`
6. **`notifyDialog(true/false)`** must be called by any component that opens/closes a dialog, otherwise global keys fire through
7. **`ErrorBoundary` wraps every view branch** in `app.jsx` — don't remove them
8. **`sanitize()`** every string from GitHub API before rendering in `<Text>`
9. **`copyToClipboard`** from utils.js — never duplicate clipboard logic inline
10. **`process.stdin.prependListener`** for mouse data handler — never `on`
11. **`ai.js` is the only file for Anthropic API calls** — never call fetch/Anthropic elsewhere
12. **`getAICodeReview` called imperatively from `useInput`**, never from `useEffect` or module scope
13. **`loadConfig().anthropicApiKey` read at call time** — never cache it at module scope

---

## 23. Quality Control (Deterministic)

To maintain 100% accuracy with zero token cost, use these tools instead of AI for structural checks:

- **Dead Code Detection:** Run `npx knip`. It identifies unused files, exports, and dependencies.
- **Architectural Linting:** `npm run lint` enforces the "Executor Pattern" using `no-restricted-imports`. Direct imports of `execa` are blocked outside of `executor.js`, `bootstrap.js`, and tests.
- **Validation:** Always run `npm test` before committing to ensure no regressions in the core CLI logic.
