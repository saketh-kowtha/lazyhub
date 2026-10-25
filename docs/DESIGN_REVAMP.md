# lazyhub — Design Revamp Manifesto

**Status:** Design reference. The token and layout contracts remain useful for UI work; screen and integration concepts are proposals, not a list of shipped features.

This document is a **design reference** for lazyhub's visual and interaction layer. It is not an implementation or release-status document. Confirm current behavior and supported configuration in source and `CONFIG_REFERENCE.md`; use committed screen mockups where the UI protocol requires them. Keep the token taxonomy and layout principles below when changing the design system.

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

### 3.2 Built-in schemes

- **`lazyhub-dark`** — default when terminal background detection is dark or uncertain.
- **`lazyhub-light`** — selected when terminal background detection reports a light background.

These are the schemes currently registered by `src/theme/index.js`.

### 3.3 Theme overrides

The runtime configuration is TOML at `~/.config/lazyhub/lazyhub.toml`. The current schema supports a theme name and partial token overrides:

```toml
[theme]
name = "lazyhub-dark"

[theme.overrides]
"accent.primary" = "#ff7eb6"
"diff.add" = { fg = "#a8e6a3", bg = "#1b2a1b" }
```

See `CONFIG_REFERENCE.md` and `src/config/defaultConfig.toml` for current keys and defaults.

### 3.4 Implementation contract

- `src/theme/index.js` exports the `useTheme()` hook and the active `scheme`.
- Theme-aware components read colors from `useTheme().scheme[...]`.
- No `chalk.green(...)`, no `<Text color="green">` literals in feature code. PR review check: `git grep -E "color=[\"']\\w+[\"']" src/features` should match nothing.
- A supported theme switch applies live, without relaunch.

---

## 4. Layout primitives (design vocabulary)

These are shared design concepts; check `src/ui/` before assuming that every primitive or behavior below exists in the current application.

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

## 7. Embedded mode (Neovim launch proposal)

When lazyhub is launched by the nvim plugin, the IPC handshake includes `mode: "embedded"`. In this mode:

- Hide `<StatusBar>` (nvim has its own).
- Suppress the lazyhub splash/welcome.
- Pre-load context from env: `LAZYHUB_BRANCH`, `LAZYHUB_FILE`, `LAZYHUB_LINE`, `LAZYHUB_COMMIT`.
- If `LAZYHUB_COMMIT` set → resolve commit → PR → land on PR diff scrolled to the file/line.
- If `LAZYHUB_FILE` + `LAZYHUB_LINE` set → land on diff view of current branch's PR scrolled there.
- `q` and `esc` from root view exit lazyhub and the plugin returns focus to nvim — no "are you sure?" prompt.

This kills the "app-inside-app" feel: opening lazyhub from nvim feels like opening a floating buffer.

---

## 8. Lua config surface (nvim plugin proposal)

This section describes an earlier integration concept, not a supported Lua configuration surface. For the implemented editor integration contract, see `NVIM_INTEGRATION_SPEC.md`. The lazyhub runtime's configuration source of truth is TOML (`~/.config/lazyhub/lazyhub.toml`); supported settings are documented in `CONFIG_REFERENCE.md`.

---

## 9. Interaction invariants (hard rules)

1. **`q`** quits the app from any view where text input is not focused. Always.
2. **`Esc`** closes the topmost overlay; if no overlay, goes up one view; at root, opens the quit confirmation popover (configurable to "just quit").
3. **`?`** opens contextual help popover for the current view's keymap.
4. **Hint bar always shows the 4–6 most useful keys for the current view.**
5. **No view ever shifts the layout when a row receives focus.** Detail appears as a popover.
6. **No raw color literals in feature code.** Tokens only.

---

## 10. Implementation sequencing

Implementation order, active stages and issue dependencies live in [ROADMAP.md](ROADMAP.md). This design reference does not maintain a second feature plan.

---

## 11. Design boundaries

- Mouse input may be supported, but no task should require it.
- Keep the primary experience in the terminal and preserve the existing Ink/React architecture.
- Keep rendering text-based and width-correct.
- Theme configuration uses TOML; do not introduce a separate theme marketplace or JSON configuration surface.

---

## 12. Visual contracts

Project-wide decisions belong in `ARCHITECT_DECISIONS.md`. The following visual constraints are retained because theme schemes and shared UI components depend on them.

| # | Contract | Requirement |
|---|---|---|
| 1 | Default dark palette | `lazyhub-dark` uses GitHub Dark Dimmed-inspired colors: foreground near `#adbac7`, background near `#22272e`, accent near `#539bf5`, added diff background near `#0f2f23`, and deleted diff background near `#3c1f1f`. Scheme files remain the source of exact values. Body text should retain readable contrast; subdued metadata may use lower contrast. |
| 2 | Theme token shape | Every theme implements the complete taxonomy in `src/theme/tokens.js`; diff add/delete tokens carry foreground and background values. |
| 3 | Theme consumption | Components use `useTheme()` tokens. Do not add raw color literals in feature components. |
| 4 | Layout and width | Shared primitives own positioning and terminal-width calculations. Use the project's width helpers for displayed text, padding and truncation. |
| 5 | Interaction | Every view remains keyboard operable; overlays close with the documented escape behavior and do not cause parent layout shifts. |
| 6 | States and accessibility | Async work shows what is loading and stays cancellable. Errors are one line of cause plus one line of action, never a stack trace. Respect `NO_COLOR`. |

### 12.1 Popover positioning

The shared popover prefers right of the anchor, then below, above and left. It flips to a side that fits the available terminal area and stays out of normal parent layout flow. See `src/ui/Popover.jsx` for the current implementation.

---

## 13. Current implementation reference

Use `src/theme/`, `src/ui/`, the current screen components and committed mockups to determine what is implemented. The screen concepts in §§4–8 are design intent; they do not promise that every component, key or layout shown there has shipped. UI work follows the mockup-first protocol in `AGENTS.md`.

---

## 14. Out of scope for this design reference

This document does not set product stage, release status, or a roadmap for AI, editor, approval or community features. Use [ROADMAP.md](ROADMAP.md) for those decisions. Theme changes remain governed by the TOML schema and the token contracts in §§3 and 12.
