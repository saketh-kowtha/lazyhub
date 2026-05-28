# lazyhub — Design Revamp Manifesto

**Status:** Draft v1 — architect (Opus) deliverable
**Owner:** product/design direction set by user; implementation orchestrated by Sonnet, executed by Sonnet + Haiku
**Scope:** Phase B (design system) + Phase C (screen migration) of the broader plan

This document is the **design contract** for the lazyhub v2 visual + interaction layer. It is not implementation. Anything not specified here is left to implementer judgment, but anything *contradicting* this document needs to come back to Opus before merging.

---

## 1. Why a revamp

The current UI is functional but reads as "lazygit-clone, basic." User wants a TUI that feels **deliberate, dense, and modern** — not minimal, not noisy. The driving complaints:

- "Basic UI/UX, that's it."
- Layout shifts when selecting a row (focus pull) → disorienting.
- Borders break mid-row on some content → looks broken.
- Diff view confusing for deletions.
- App feels like "app-inside-app" when launched from Neovim — no awareness of the host editor.

Revamp goals, in priority order:

1. **No layout shift on focus.** Selection → overlay/popover, not reflow.
2. **Information density without noise.** Dense rows, peripheral detail.
3. **Themed, tokenized, swappable color schemes.** No hardcoded ANSI codes anywhere.
4. **Width-correct rendering.** Wide chars / emoji / CJK must never break a border.
5. **Embedded mode** for Neovim launch — no double chrome.
6. **Keyboard-first.** Mouse is never required. Hint bar tells you everything.

---

## 2. Design principles

| # | Principle | Rule of thumb |
|---|---|---|
| 1 | Density first | Every row earns its height. No empty lines as separators — use subtle border tokens. |
| 2 | Overlay > reflow | If new info appears on focus, it floats above, not beside. Closes on ESC. |
| 3 | One affordance per row | Don't pack 5 indicators into a PR row. Pick the 3 most load-bearing. |
| 4 | Discoverable keys | Bottom hint bar shows what's available *here, now*. View-aware. |
| 5 | Width-correct | Every padding/truncate goes through `string-width` (or equivalent). No `.length` for display math. |
| 6 | Tokenized color | Components consume tokens (`accent.primary`, `diff.add`) — never raw ANSI / hex. |
| 7 | Surfaces have depth | Three z-layers: base, surface (panels), overlay (popovers). Distinct bg tokens. |
| 8 | Embed-aware | Layout collapses chrome when `mode = embedded` (Neovim host). |

---

## 3. Theme system

### 3.1 Token taxonomy

```
bg/
  default     # window background
  surface     # panel/card behind primary content
  overlay     # popover/modal background

fg/
  default     # primary text
  muted       # secondary text (timestamps, repo paths)
  subtle      # tertiary (separators, placeholders)
  inverse     # text on accent backgrounds

accent/
  primary     # focused row, active tab, primary CTA
  secondary   # interactive highlight (links, refs)

status/
  success     # ci pass, approval given
  warning     # ci pending, review-requested
  error       # ci fail, conflict, alert
  info        # neutral notice

diff/
  add         # +line bg + fg
  del         # -line bg + fg
  context     # unchanged
  hunk        # @@ header
  add_emph    # within-line add highlight
  del_emph    # within-line del highlight

pr/
  open        # green dot
  draft       # gray dot
  merged      # purple dot
  closed      # red dot

ci/
  pass        # green check
  fail        # red x
  pending     # yellow dot
  skipped     # gray slash

border/
  default     # panel border
  focused     # focused panel border (uses accent.primary)
  subtle      # divider between dense rows
```

### 3.2 Built-in schemes (shipped)

- **`mocha`** (default) — Catppuccin Mocha-inspired; dark, jewel-toned, warm contrast.
- **`tokyo-night`** — cool, cyan/violet, popular with nvim crowd.
- **`gruvbox-dark`** — retro, warm, earth tones.
- **`github-dark`** — matches github.com dark; familiar to PR reviewers.
- **`github-light`** — for daylight terminals.

### 3.3 Custom schemes

User can override any token via Lua (nvim plugin) or JSON (`~/.config/lazyhub/theme.json`). Format:

```jsonc
{
  "extends": "mocha",
  "tokens": {
    "accent.primary": "#ff7eb6",
    "diff.add": { "fg": "#a8e6a3", "bg": "#1b2a1b" }
  }
}
```

### 3.4 Implementation contract

- Single `src/theme/` module exports a `useTheme()` hook (or context).
- Every Ink component takes color via `useTheme().tokens[...]`.
- No `chalk.green(...)`, no `<Text color="green">` literals in feature code. PR review check: `git grep -E "color=[\"']\\w+[\"']" src/features` should match nothing.
- Theme switch is hot — `<Settings>` view applies live, no relaunch.

---

## 4. Layout primitives (new components)

These live in `src/ui/`. All other feature code consumes them.

| Component | Purpose |
|---|---|
| `<Surface>` | Themed background panel. Optional border. Takes `level: base \| surface \| overlay`. |
| `<Popover anchor target>` | Renders absolutely positioned above current view. Auto-positions (above/below/right of anchor). ESC closes. Returns focus to anchor on close. |
| `<HintBar>` | Bottom-pinned single-line keymap hint. Reads current view's keymap registry. Renders as `q quit · / search · f filter · ? help · …`. |
| `<StatusBar>` | Top breadcrumb: `repo · branch · PR#42 · ci-pass`. Hidden in embedded mode (Neovim has its own statusline). |
| `<DenseRow>` | A single content row with explicit columns. Handles truncate-with-ellipsis using `string-width`. Slots: leading icon, primary text, trailing meta. |
| `<Pane split="vertical \| horizontal" sizes={[60, 40]}>` | Replaces ad-hoc Box trees. Tracks focus. |
| `<DiffView>` | First-class diff component. See §6. |
| `<Toast>` | Transient status message, top-right; auto-dismiss 3s; ESC dismisses. |
| `<CommandPalette>` | `:`-triggered fuzzy command runner. (Optional Phase C+.) |

All primitives are width-correct, theme-driven, and have a `data-testid`-style prop for snapshot tests.

---

## 5. Information architecture per screen

### 5.1 Home (PR list)

**Before:** dense list + side panel that pushes when something gets selected; some rows have inline expanded info; borders break.

**After:**
- **Left:** scrollable PR list. Each row = `<DenseRow>` with:
  - leading: PR status dot (token `pr.open` etc.)
  - primary: `#42 fix: rename foo to bar`  (truncated, width-correct)
  - trailing: `ci-icon · author · 2h`
- **Focus on row → `<Popover>`** anchored right of the row (or below if no right room). Popover shows:
  - PR title + meta (state, author, branch, base)
  - Body excerpt (first 6 lines)
  - CI status (per check)
  - Unresolved review threads count
  - Action hint bar: `enter open · a approve · m merge · …`
- ESC closes popover, focus returns to list. **No reflow.**

**Default filter:** "Mine" (`--author @me`). Hint bar shows `f filter:Mine`. Toggle cycles Mine → Assigned → All.

### 5.2 PR detail (when entered, not previewed)

Full-screen view (over home). Top: meta. Middle: tabs — `Overview · Diff · Conversation · Checks · Files`. Inline action bar always visible bottom-right of the meta block.

### 5.3 Diff view

See §6.

### 5.4 Issues

Mirror of PR list. Same `<DenseRow>` + popover-on-focus pattern.

### 5.5 Settings

Live theme switcher (cycle through built-ins, see live), filter defaults, nvim integration toggle, AI provider picker (already partly built). Reachable via `,` or `?` → settings.

---

## 6. Diff view redesign

Current diff view has confused deletion rendering and no in-view approve. Spec:

### 6.1 Layout

```
┌─ statusbar (PR #42 · feat/x · base/main · ci-pass) ─────────────┐
│ ┌─ files (left, ~25%) ─┐  ┌─ diff (right, ~75%) ─────────────┐ │
│ │ M src/a.js  +12 -3   │  │ @@ -10,4 +10,5 @@                │ │
│ │ A src/b.js  +40      │  │  10  10  context line            │ │
│ │ D src/c.js   -8      │  │  11  ··  ░░ deleted line ░░      │ │
│ │ ...                   │  │  ··  11  ▓▓ added line   ▓▓     │ │
│ └───────────────────────┘  └────────────────────────────────────┘│
│ q quit · a approve · c comment · r refresh · v split · ? help    │
└──────────────────────────────────────────────────────────────────┘
```

### 6.2 Deletion clarity

- Deleted lines: muted strikethrough fg + `diff.del` bg + `··` in the "after" gutter.
- Added lines: bold-ish fg + `diff.add` bg + `··` in the "before" gutter.
- Context lines: both gutters show line numbers.
- Within-line emphasis (word diff): `diff.add_emph` / `diff.del_emph` background highlight on the changed substring. Optional Phase C+, but spec it.

### 6.3 Side-by-side toggle

`v` toggles unified ↔ split. In split, two `<Pane>` columns with synced scroll. Useful for refactors.

### 6.4 Actions in diff view (all keybindings)

| Key | Action |
|---|---|
| `q` | quit app |
| `esc` | back to PR detail |
| `a` | approve PR (popover confirms, returns here on success) |
| `c` | comment on current line |
| `r` | refresh PR |
| `v` | toggle unified/split |
| `]r` / `[r` | next/prev review comment in this PR (already implemented in nvim integration; mirror here) |
| `]f` / `[f` | next/prev file |
| `o` | open this file's PR on github.com (already partially built — must use `prMeta.url`, not hardcoded) |

---

## 7. Embedded mode (Neovim launch)

When lazyhub is launched by the nvim plugin, the IPC handshake includes `mode: "embedded"`. In this mode:

- Hide `<StatusBar>` (nvim has its own).
- Suppress the lazyhub splash/welcome.
- Pre-load context from env: `LAZYHUB_BRANCH`, `LAZYHUB_FILE`, `LAZYHUB_LINE`, `LAZYHUB_COMMIT`.
- If `LAZYHUB_COMMIT` set → resolve commit → PR → land on PR diff scrolled to the file/line.
- If `LAZYHUB_FILE` + `LAZYHUB_LINE` set → land on diff view of current branch's PR scrolled there.
- `q` and `esc` from root view exit lazyhub and the plugin returns focus to nvim — no "are you sure?" prompt.

This kills the "app-inside-app" feel: opening lazyhub from nvim feels like opening a floating buffer.

---

## 8. Lua config surface (nvim plugin)

The Node TUI does **not** read Lua. The nvim plugin does, and it forwards config to the TUI via env vars + IPC.

```lua
require('lazyhub').setup({
  theme = 'tokyo-night',                    -- or 'mocha' | 'github-dark' | 'github-light' | 'gruvbox-dark'
  theme_overrides = {                       -- partial token override
    ['accent.primary'] = '#ff7eb6',
    ['diff.add'] = { fg = '#a8e6a3', bg = '#1b2a1b' },
  },
  default_filter = 'mine',                  -- 'mine' | 'assigned' | 'all'
  launch_mode = 'float',                    -- 'float' | 'split' | 'tab'
  float = { width = 0.9, height = 0.9, border = 'rounded' },
  keymaps = {
    prefix = '<leader>gh',
    pr     = '<leader>ghp',
    blame  = '<leader>ghb',
    -- ...
  },
  ipc = { timeout_ms = 3000, reconnect = true },
  ai  = { provider = 'claude-code' },       -- 'claude-code' | 'codex' | 'gemini-cli' | 'anthropic-api'
})
```

Validation: invalid keys log a warning via `vim.notify` but don't crash.

---

## 9. Interaction invariants (hard rules)

1. **`q`** quits the app from any view where text input is not focused. Always.
2. **`Esc`** closes the topmost overlay; if no overlay, goes up one view; at root, opens the quit confirmation popover (configurable to "just quit").
3. **`?`** opens contextual help popover for the current view's keymap.
4. **Hint bar always shows the 4–6 most useful keys for the current view.**
5. **No view ever shifts the layout when a row receives focus.** Detail appears as a popover.
6. **No raw color literals in feature code.** Tokens only.

---

## 10. Implementation plan (sequencing for Sonnet)

| Step | Deliverable | Notes |
|---|---|---|
| 1 | `src/theme/` module with token shape + `mocha` scheme + `useTheme` hook | Foundation; no UI change yet |
| 2 | Add `string-width` dep + replace all display-math sites | Fixes border bug as a side effect (Phase A bug 6) |
| 3 | Migrate ONE existing screen (PR list) to consume tokens via `useTheme` | Validates the abstraction; no visual change yet |
| 4 | Build `<Popover>` primitive + wire to PR list focus → detail popover | First user-visible new behavior |
| 5 | Ship the other built-in schemes + settings switcher | Now there's a story to tell |
| 6 | Diff view redesign per §6 | Biggest win for daily use |
| 7 | Embedded mode (§7) + Lua config plumb (§8) | Resolves "app-in-app" complaint |
| 8 | Hint bar everywhere; remove ad-hoc inline help text | Polish |

Each step ships as its own PR. The user reviews after step 4 (first visible change) and step 6 (diff redesign) — those are the highest-risk visual calls.

---

## 11. Out of scope (explicitly)

- Mouse support. Keyboard-only.
- Web UI / web component / electron. Terminal only.
- Replacing Ink/React. Too much working code; abstraction layer in §4 is enough.
- Custom font rendering / pixel graphics. Pure cell rendering.
- A "marketplace" of community themes. Themes ship in-repo or as user JSON; nothing more.

---

## 12. Decisions (locked by Opus per user delegation)

User delegated all UX calls: "you take a call whatever gives best ui/ux and increases users and helps users." Decisions below are final unless explicitly reopened.

| # | Question | Decision | Reasoning |
|---|---|---|---|
| 1 | Default theme | Ship a **first-party** `lazyhub-dark` (default) and `lazyhub-light` (auto-switched if light terminal background detected via `$COLORFGBG` or OSC 11 query). Inspired by GitHub Dark Dimmed for visual continuity with github.com, but tuned for terminal readability. Other community themes (`mocha`, `tokyo-night`, `gruvbox-dark`, `github-light/dark`) ship as **opt-in presets** — not in default rotation. | Owning the default theme signals craft. Borrowing someone else's theme as your default = signals "not opinionated." FAANG-grade products have a house style. |
| 2 | `q` at root | **Immediate quit.** No confirm. Drafts (unsubmitted comments > 5 chars) auto-save to `~/.config/lazyhub/drafts/<repo>-<pr>-<ts>.txt` on quit. Restore prompt on next launch. | Confirm-to-quit is from 2005. Modern TUIs (k9s, lazygit, htop, btop) all quit immediately. Draft persistence covers the only legit "I didn't mean it" case. |
| 3 | Embedded-mode `q` | **Hides the float and returns focus to nvim. Process stays alive in background.** Auto-shutdown after 5 min of no IPC activity + no focus. Explicit kill via `:LazyHubQuit`. | nvim users open/close many times per review session. ~1s relaunch cost is noticeable; in-memory state (fetched PRs, scroll position, draft) is the actual value. Idle timeout caps resource cost. |
| 4 | CI nuke scope | **Strip all LLM/AI from CI**, full stop. No auto-changelogs, no AI review bots, no auto-PRs, no LLM commit messages. Reduce to 3 workflows total: `ci.yml` (lint+test on PR/push), `release.yml` (publish on tag), and **delete** anything else. Keep Dependabot for security-only (no auto-merge). | User said "I don't want overkill and too many pipeline." LLM-in-CI is a maintenance liability + cost center + non-deterministic. Standard FAANG-prod pattern is boring on purpose. |

### 12.1 Additional senior-level decisions made by Opus

These were not in user's question list but are required for a FAANG-grade result:

| Topic | Decision |
|---|---|
| **Telemetry** | **None.** Zero outbound network calls except to GitHub/AI-provider as user-initiated. Document explicitly in README. Privacy is a feature. |
| **Command palette** | **Promoted into Phase B (step 5).** Trigger: `:` (vim-like) or `<space><space>` (nvim convention). Fuzzy-search every action in the app. This is the single highest-leverage discoverability feature — kept gated as "optional" was wrong. |
| **Loading states** | Every async op shows an inline spinner *with what's loading* ("loading PR #42… `c` to cancel"). Never freeze. Cancel key always wired. |
| **Error states** | Never show stack traces. Format: one-line cause + one-line actionable fix. Example: *"GitHub token expired — press `r` to re-auth, or run `gh auth login`."* All errors flow through one formatter. |
| **Accessibility** | Respect `NO_COLOR` env (mono mode). Ship a `lazyhub-high-contrast` theme variant. Every interactive element keyboard-reachable (already a hard rule). Document contrast ratios in theme files. |
| **Onboarding** | First-launch overlay: 5-step keyboard tour showing the 5 keys that unlock 80% of the app (`?`, `:`, `/`, `f`, `q`). Dismissable. Never shows again after dismiss. State in `~/.config/lazyhub/state.json`. |
| **Diff layout auto-pick** | Detect terminal width on entry: ≥180 cols → split, < 180 cols → unified. `v` overrides per-session. Setting in config overrides default. |
| **Popover positioning** | Priority: right of anchor → below → above → left. Auto-flip near edges. Never clips. Implementation owns this — never asked of feature code. |
| **Theme count shipped by default** | Two only (`lazyhub-dark`, `lazyhub-light`). All others available via `theme = '<name>'` config but not in the default settings cycler. Decision fatigue is a real cost. |

---

## 13. Revised implementation sequencing (supersedes §10)

| Step | Deliverable | Review gate |
|---|---|---|
| 1 | `src/theme/` module + `lazyhub-dark` + `lazyhub-light` + `useTheme` hook + bg-detection helper | — |
| 2 | `string-width` sweep across all row renderers (also closes Phase A bug 6) | — |
| 3 | Token migration of PR list to `useTheme` (no visual change yet) | — |
| 4 | `<Popover>` primitive + PR list focus → detail popover | **User reviews — first visible change** |
| 5 | **Command palette** (`<space><space>` trigger) + onboarding tour + settings switcher | — |
| 6 | Diff view redesign per §6 + auto-pick layout + in-view approve | **User reviews — biggest visual call** |
| 7 | Embedded mode + Lua config plumb + drafts persistence | — |
| 8 | Hint bars everywhere + error formatter + loading-state primitive + `NO_COLOR` + high-contrast theme | — |

Each step = one PR. Each PR must include screenshots/recordings (`agg` or `vhs` for cast-to-gif). PR descriptions include before/after.

---

## 14. Out of scope (explicit)

Mouse support. Web UI. Replacing Ink/React. Pixel graphics. Theme marketplace. Telemetry. Auto-update prompts (Homebrew handles it). LLM in the build pipeline.

---

*Opus signoff: this manifesto is the source of truth for Phase B+C. Sonnet, implement against the revised §13 sequencing. Decisions in §12 are locked — don't relitigate them in code review. If a constraint forces deviation, escalate.*
