# lazyhub.nvim — Deep Editor Integration Spec

> **Status:** Proposed
> **Owner:** integrations/nvim
> **Related:** `src/ipc.js`, `integrations/nvim/`, `ARCHITECTURE.md`
> **Audience:** Any contributor (human or AI) implementing the editor surface.

---

## 1. Vision

> User edits code in nvim → stages with **lazygit** → manages GitHub collaboration with **lazyhub** — all keyboard-driven, all in one terminal session.
>
> **Three keys, three tools:**
> - `<leader>gg` → lazygit (file changes, commits, branches)
> - `<leader>gh` → lazyhub (PRs, issues, reviews, CI, notifications)
> - `<leader>gr` → review overlay (inline PR comments in the current buffer)

Goal: a LazyVim/AstroNvim user installs lazyhub, gets a native-feeling GitHub workflow, never opens a browser, never alt-tabs.

### Non-goals

- Replacing `octo.nvim`'s buffer-native PR rendering. We keep the float TUI as the primary GitHub surface; nvim is the *editor-side* glue.
- Reimplementing GitHub features in Lua. All GitHub state lives in the lazyhub TUI; the plugin is a thin client over IPC + `gh`.
- Authoring/editing issues from nvim (low frequency — the float is fine).

---

## 2. Current state (baseline)

Already shipped in `integrations/nvim/`:

| Command | Behavior |
|---|---|
| `:LazyHub` | Opens lazyhub in a floating terminal |
| `:LazyHubPR` | Opens lazyhub, passes current branch via env |
| `:LazyHubBlame` | `git blame` line → finds PR by commit SHA → opens lazyhub navigated to it |
| `:LazyHubDiag` | Pulls PR review comments via `gh api`, sets them as `vim.diagnostic` entries |
| `:LazyHubState` | Shows current lazyhub pane/view/PR from IPC |

IPC server (`src/ipc.js`) supports:
- Requests: `ping`, `state`, `navigate`, `open-file`
- Events broadcast to all clients: `cursor-changed`, `view-changed`, `pr-merged`

Discovery via `~/.lazyhub-socket` pointer file.

---

## 3. Architecture

### 3.1 Layered design

```
┌──────────────────────────────────────────────────────────┐
│  User-facing commands & keymaps   (plugin/lazyhub.lua)   │
├──────────────────────────────────────────────────────────┤
│  Feature modules (lua/lazyhub/*.lua)                     │
│    ├ float.lua        floating-terminal management        │
│    ├ statusline.lua   status component for lualine etc.   │
│    ├ review.lua       virtual text + reply UI             │
│    ├ pickers.lua      snacks/telescope/fzf-lua shim       │
│    ├ ipc.lua          NDJSON client + reconnect           │
│    └ health.lua       :checkhealth lazyhub                │
├──────────────────────────────────────────────────────────┤
│  IPC transport (Unix socket)  ←→  lazyhub TUI process    │
└──────────────────────────────────────────────────────────┘
```

### 3.2 Invariants

1. **No GitHub HTTP calls in Lua.** All `gh` calls happen either in lazyhub (preferred) or via `vim.fn.jobstart({'gh', ...})` (when lazyhub isn't running). Never `curl`, never raw API tokens in Lua.
2. **IPC is best-effort.** Every feature must degrade gracefully when lazyhub isn't running. If IPC is unavailable, fall back to spawning `gh` directly or showing a "lazyhub not running" notification.
3. **No blocking calls in the main loop.** All `gh` and IPC calls use `vim.fn.jobstart` or `uv.new_pipe`. Never `vim.fn.system` for slow operations.
4. **One installation, all distros.** Distro-specific code lives in `lua/lazyhub/distro/*.lua` and is loaded only when the distro is detected. The core works on plain nvim.
5. **No keymap pollution.** The plugin registers `<Plug>(lazyhub-*)` mappings only. Users (or LazyExtras) bind them to `<leader>gh*`.

---

## 4. Phased delivery

### Phase 1 — Ambient presence (1–2 days)

Goal: lazyhub is *present* in the editor without opening the float.

**1.1 Status line component** (`lua/lazyhub/statusline.lua`)

Exports:
```lua
require('lazyhub.statusline').component()  -- returns string for lualine
require('lazyhub.statusline').heirline()   -- returns component table for heirline
```

Displays for current branch:
```
 PR #123  ✓ CI  💬 2
```

- `` icon = no PR; ` PR #123` = PR linked
- `✓/✗/●` for CI: passing / failing / running
- `💬 N` = unresolved review threads (omitted if 0)
- Pollable every 30s OR pushed via IPC `pr-state-changed` event (added below)

Data source: IPC `state` request with `{ branch }` param. Lazyhub answers `{ prNumber, ciStatus, unresolvedThreads }`. If IPC down, fall back to `gh pr status --json ...` debounced to 60s.

**1.2 Smart `:LazyHubPR`**

If a PR exists for current branch:
1. If lazyhub is running → IPC `navigate { prNumber: N, view: "diff" }`, then float
2. If not running → spawn lazyhub with `GHUI_PR=N` env (requires new env handling in lazyhub bootstrap)

If no PR: open lazyhub on the branch list.

**1.3 LazyExtras module**

Ship `integrations/nvim/lazyextras/init.lua` (separate from the plugin) that LazyVim users can enable via `:LazyExtras` → `tool.lazyhub`. It:
- Imports `lazyhub`
- Registers `<leader>gh*` keymaps under the `gh` which-key group
- Configures lualine if installed

**Acceptance:**
- [ ] Status line component renders in lualine, heirline, and as a plain string
- [ ] Component updates within 1s of `gh pr merge` completing
- [ ] `:LazyHubPR` on a PR branch jumps to that PR's diff view
- [ ] `:LazyExtras` shows `tool.lazyhub` as installable in LazyVim
- [ ] All work degrades gracefully on plain nvim with no distro

### Phase 2 — Inline reviews (3–5 days, the killer feature)

Goal: review comments appear *next to the code being reviewed*, in the buffer, with reply-from-buffer.

**2.1 Comment overlay** (`lua/lazyhub/review.lua`)

When user runs `:LazyHubReview` (or `<leader>grr`):
1. Resolve current PR via IPC `state` or `gh pr view --json`
2. Fetch comments via `gh api repos/{r}/pulls/{n}/comments --jq '...'`
3. For each comment whose `path` matches an open buffer:
   - Set an extmark with virtual text on the comment's `line`
   - Style: faded foreground, prefixed with `▎ @user:` and truncated to window width
   - Add sign column marker (configurable: `█` default)
4. Save `(bufnr, line) → comment` map for reply actions

Multiple comments on the same line stack as virtual lines below the code line.

**2.2 Reply / resolve from buffer**

| Mapping | Action |
|---|---|
| `<leader>grr` | Refresh overlay |
| `<leader>grR` | Reply to thread under cursor |
| `<leader>grx` | Resolve thread under cursor |
| `]r` / `[r` | Jump to next/prev review comment in buffer |

Reply flow:
1. Floating input prompt (`vim.ui.input` with multi-line via snacks.input if available)
2. POST via `gh api graphql -F threadId=... -f body=...` (uses `addPullRequestReviewThreadReply` mutation)
3. On success: re-fetch that thread, update the extmark, toast "Reply posted"
4. On failure: keep buffer state, toast error

**2.3 Live updates**

Subscribe to IPC `review-comment-added` and `review-thread-resolved` events (added below). On event, patch the affected extmark without re-fetching everything.

**2.4 Highlight groups**

Define and expose:
- `LazyhubReviewComment` (virtual text)
- `LazyhubReviewSign` (sign column)
- `LazyhubReviewAuthor` (author prefix)
- `LazyhubReviewResolved` (resolved threads, dimmer)

Link to sensible defaults (`Comment`, `DiagnosticInfo`) so themes work without configuration.

**Acceptance:**
- [ ] Open a PR's branch, run `:LazyHubReview` → review comments appear as virtual text on the right lines
- [ ] Reply with `<leader>grR` → comment posts and overlay refreshes
- [ ] Resolve with `<leader>grx` → thread dims, sign updates
- [ ] `]r` / `[r` jump through comments in correct order
- [ ] Comments survive `:e` (re-attached on `BufEnter`)
- [ ] Live IPC events update overlays in <1s

### Phase 3 — Pickers (2–3 days)

Goal: fast list operations without opening the float.

**3.1 Picker shim** (`lua/lazyhub/pickers.lua`)

Auto-detect in priority order:
1. `snacks.picker` (LazyVim 11+ default)
2. `telescope.nvim`
3. `fzf-lua`
4. Fallback to `vim.ui.select`

Exports `pick(items, opts)` returning the chosen item via callback.

**3.2 Pickers shipped**

| Command | Source | Default action | Alt actions |
|---|---|---|---|
| `:LazyHubPRs` | `gh pr list --json ...` | Open in float | `<C-o>` browser, `<C-y>` yank URL |
| `:LazyHubIssues` | `gh issue list --json ...` | Open in float | same |
| `:LazyHubChecks` | `gh pr checks` for current branch | Open log in split | `<C-r>` re-run check |
| `:LazyHubNotifs` | `gh api notifications` | Open thread in float | `<C-d>` mark read |
| `:LazyHubReviewers` | `gh api repos/{r}/collaborators` | Request reviewer for current PR | multi-select |

Each list cached for 30s per repo to avoid spam during fuzzy typing.

**Acceptance:**
- [ ] All five pickers work on snacks, telescope, fzf-lua, and `vim.ui.select`
- [ ] Default action opens the right pane in lazyhub
- [ ] Cache invalidates on relevant IPC events (`pr-merged`, `pr-state-changed`)

### Phase 4 — Distro packaging (1 day each)

**4.1 LazyVim** — `LazyExtras` module submitted to `LazyVim/LazyVim` as `lua/lazyvim/plugins/extras/tool/lazyhub.lua`. Adds:
- Plugin spec
- `<leader>gh*` keymaps with which-key group
- Lualine component if `lualine` loaded
- Health check entry

**4.2 AstroNvim** — PR to `AstroNvim/astrocommunity` under `lua/astrocommunity/git/lazyhub-nvim/`. Same surface adapted to AstroCore's `mappings` table.

**4.3 NvChad** — README snippet only. NvChad users copy a chadrc.lua block. No upstream PR (NvChad's plugin model doesn't have a community repo equivalent).

### Phase 5 — Polish

- **snacks.terminal detection**: when `Snacks.terminal` exists, use it instead of `vim.fn.termopen` so float borders, win-options, and `q` behavior match the rest of LazyVim.
- **which-key registration**: auto-register `<leader>gh` as group "lazyhub" with descriptions for each mapping.
- **`:checkhealth lazyhub`**: verifies `gh` on PATH, `gh auth status` OK, lazyhub on PATH, socket reachable, detected picker/statusline backends, distro detection.
- **IPC reconnect**: client retries connection with exponential backoff (1s → 30s cap) when socket disappears. On reconnect, re-subscribe to events.
- **Configurable everything**: every keymap, sign character, highlight, and timeout overrideable via `setup({...})`.

---

## 5. IPC protocol additions

The current `src/ipc.js` covers `ping`/`state`/`navigate`/`open-file`. To support the spec we need:

### 5.1 New request types

| Request | Params | Response |
|---|---|---|
| `state` (extended) | `{ branch?: string }` | `{ state: { pane, view, prNumber, repo, ciStatus, unresolvedThreads, branch } }` |
| `pr-for-branch` | `{ branch }` | `{ prNumber, prState, ciStatus, unresolvedThreads }` or `{ prNumber: null }` |
| `review-comments` | `{ prNumber }` | `{ comments: [{ id, threadId, path, line, body, user, resolved }] }` |
| `reply-thread` | `{ threadId, body }` | `{ ok, commentId }` |
| `resolve-thread` | `{ threadId }` | `{ ok }` |

These are thin wrappers around existing executor calls so lazyhub's in-memory cache is reused (cheaper than nvim spawning `gh` again).

### 5.2 New events

| Event | Payload | Trigger |
|---|---|---|
| `pr-state-changed` | `{ branch, prNumber, ciStatus, unresolvedThreads }` | CI check refresh, PR open/merge/close |
| `review-comment-added` | `{ prNumber, comment }` | Local action or polled refresh |
| `review-thread-resolved` | `{ prNumber, threadId }` | Local action or polled refresh |
| `branch-changed` | `{ repo, branch }` | User switches branch inside lazyhub |

### 5.3 Constraints

- All new handlers go through `executor.js` (project invariant — no `gh` outside executor)
- Events are fire-and-forget; clients re-fetch on reconnect
- Backwards compatible: unknown request types still return `{ error: "unknown type" }` — existing nvim plugin keeps working

---

## 6. File layout

```
integrations/nvim/
├── plugin/
│   └── lazyhub.lua              (existing, extended with new commands)
├── lua/lazyhub/
│   ├── init.lua                 (existing — setup(), config merging)
│   ├── float.lua                (extracted from init.lua)
│   ├── ipc.lua                  (extracted from init.lua, + reconnect)
│   ├── statusline.lua           NEW — Phase 1
│   ├── review.lua               NEW — Phase 2
│   ├── pickers.lua              NEW — Phase 3
│   ├── health.lua               NEW — Phase 5
│   └── distro/
│       ├── lazyvim.lua          NEW — detection + integration hooks
│       ├── astronvim.lua        NEW
│       └── nvchad.lua           NEW
├── lazyextras/
│   └── lazyhub.lua              NEW — copyable into LazyVim/LazyVim PR
└── README.md                    UPDATE — install per distro, all commands
```

---

## 7. Test plan

### Unit (busted, in `integrations/nvim/tests/`)

- `ipc_spec.lua` — NDJSON framing, reconnect, request/response correlation
- `statusline_spec.lua` — component renders for each PR state
- `review_spec.lua` — comment-to-extmark mapping, reply payload shape
- `pickers_spec.lua` — backend detection priority

### Integration (manual, captured in `MANUAL_TEST_PLAN.md`)

- Plain nvim install (no distro) — all commands work
- LazyVim with `tool.lazyhub` extra — keymaps appear in which-key
- AstroNvim with astrocommunity entry — same surface
- IPC disconnect mid-review → reconnects, comments still visible

### CI

- Add `nvim --headless -c "PlenaryBustedDirectory tests/" -c "qa!"` to existing test workflow
- Matrix: nvim 0.9, 0.10, nightly

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Each distro's API shifts (LazyExtras path, snacks.picker) | Distro detection in `lua/lazyhub/distro/`; one file per distro, easy to patch |
| Heavy `gh api` polling drains rate limit | Cache 30s per repo; prefer IPC state from lazyhub; respect `X-RateLimit-Remaining` header |
| Virtual text conflicts with other plugins (gitsigns, lsp) | Dedicated namespace `lazyhub.review`; only set on `BufEnter` after user opt-in; never auto-attach |
| IPC socket race when user runs two lazyhub instances | Pointer file stores newest; old instance's socket still works for already-connected clients |
| `vim.fn.system` blocking the UI | Code review: forbid `vim.fn.system` for any call slower than 50ms; lint via grep in CI |

---

## 9. Out of scope (explicitly)

- PRs as nvim buffers (octo.nvim's model) — duplicates the TUI
- Issue creation/edit from nvim — low frequency
- Self-hosted GHE auth flow (works automatically via `gh auth`, no plugin work needed)
- Telemetry / opt-in metrics
- AI review actions in nvim (handled by `AI_PROVIDERS_SPEC.md`)

---

## 10. Open questions

1. **Snacks integration depth.** Should the float *require* snacks when LazyVim is detected, or always remain optional? Recommendation: optional with auto-upgrade.
2. **GHE / self-hosted.** Confirm IPC events fire correctly when `GH_HOST` is set (existing test failure noted in memory may matter).
3. **Reply UX on monitor-narrow setups.** `vim.ui.input` is single-line. Multi-line replies via `snacks.input` or a scratch buffer? Recommendation: scratch buffer with `<C-s>` to send, `q` to cancel.
