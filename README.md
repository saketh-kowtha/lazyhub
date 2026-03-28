# ghui

> A **lazygit-style** GitHub TUI — every GitHub action available without leaving your terminal.

[![CI](https://github.com/saketh-kowtha/lgh/actions/workflows/ci.yml/badge.svg)](https://github.com/saketh-kowtha/lgh/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/ghui.svg)](https://www.npmjs.com/package/ghui)
[![Node.js ≥20](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

```
┌── Pull Requests ──────┬── #142 fix: memory leak in cache ────────────────────┐
│                       │                                                       │
│  ⎇  PRs               │  Author   saketh-kowtha   2 hours ago                │
│  ○  Issues            │  Branch   fix/cache-leak → main                      │
│  ⎇  Branches          │  Checks   ✓ passing                                   │
│  ▶  Actions           │                                                       │
│  ●  Notifications     │  Description                                          │
│                       │  Fixes the unbounded growth of the in-memory TTL      │
│  ──────────────────── │  cache introduced in #138.                            │
│                       │                                                       │
│  ✓ #142 fix: memory…  │  ─────────────────────────────────────────────────── │
│  ⎇ #141 feat: log-vi… │  Files changed  3   +47  −12                         │
│  ! #140 feat: branch… │                                                       │
│  ✓ #139 chore: bump…  │  [d] diff  [a] approve  [m] merge  [l] labels        │
│                       │                                                       │
└───────────────────────┴───────────────────────────────────────────────────────┘
  saketh-kowtha/lgh   main   ✓ 3/3 checks   Rate limit: 4823/5000
  Tab panes  j/k nav  Enter detail  d diff  m merge  q back  ? help
```

---

## Why ghui?

Most GitHub workflows force you to context-switch to the browser. `gh` CLI is
great but its output is flat text — no side-by-side layout, no live diffs, no
interactive merge strategies.  **ghui** brings the full GitHub web UI into your
terminal as a keyboard-driven TUI, so you never have to leave your editor
session.

| Feature | Browser | gh CLI | **ghui** |
|---------|---------|--------|----------|
| PR list + filters | ✓ | ✓ | ✓ |
| Inline diff with syntax highlight | ✓ | ✓ | ✓ |
| Line-level comments | ✓ | ✗ | ✓ |
| Approve / request-changes | ✓ | ✓ | ✓ |
| Merge strategy picker | ✓ | ✗ | ✓ |
| Actions logs streaming | ✓ | ✓ | ✓ |
| Fuzzy search every list | ✗ | ✗ | ✓ |
| Keyboard-only, no mouse needed | ✗ | ✓ | ✓ |

---

## Install

### npm (recommended)

```bash
npm install -g ghui
```

### npx (no install)

```bash
npx ghui
```

### Homebrew (coming soon)

```bash
brew install saketh-kowtha/tap/ghui
```

**Prerequisites:** [Node.js ≥ 20](https://nodejs.org) and the [GitHub CLI (`gh`)](https://cli.github.com).
`ghui` will detect missing tools and print platform-specific install instructions on first run.

---

## Usage

```bash
# From any git repo cloned from GitHub
cd my-project
ghui

# Or pick a repo interactively (works outside any git directory)
ghui
```

`ghui` handles the rest:
- Detects `gh` — prints install instructions if missing
- Detects `gh auth` — runs interactive login (browser or PAT) if needed
- Detects repo context — shows an arrow-key picker if run outside a git directory

---

## Panes

| Pane | Key | What you can do |
|------|-----|-----------------|
| Pull Requests | `Tab` | list, detail, diff, line comments, approve, merge, labels, reviewers |
| Issues | `Tab` | list, detail, create, close, labels, assignees |
| Branches | `Tab` | list, checkout, create, delete, push |
| Actions | `Tab` | list runs, view logs, re-run, cancel |
| Notifications | `Tab` | list, open, mark read / all read |

---

## Keybindings

### Global
| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Cycle panes |
| `j` / `k` or `↑↓` | Navigate list |
| `Enter` | Open detail |
| `r` | Refresh (force re-fetch) |
| `o` | Open in browser |
| `/` | Fuzzy search |
| `?` | Help overlay |
| `q` | Back / quit |

### Pull Requests
| Key | Action |
|-----|--------|
| `d` | Open diff view |
| `m` | Merge (pick --merge / --squash / --rebase) |
| `a` | Approve |
| `x` | Request changes |
| `c` | Checkout branch |
| `l` | Edit labels |
| `A` | Edit assignees |
| `rv` | Request reviewers |

### Diff view
| Key | Action |
|-----|--------|
| `j` / `k` | Scroll lines |
| `[` / `]` | Previous / next file |
| `n` / `N` | Previous / next comment thread |
| `c` | Comment on cursor line |
| `v` | View all comments |
| `s` | Toggle split / unified |

### Issues
| Key | Action |
|-----|--------|
| `n` | New issue |
| `x` | Close issue |
| `l` | Edit labels |
| `A` | Edit assignees |

### Actions
| Key | Action |
|-----|--------|
| `l` | View logs |
| `R` | Re-run failed jobs |
| `X` | Cancel run |

---

## Architecture

```
ghui/
├── bin/ghui.js          ← entry: bootstrap() → renderApp()
├── src/
│   ├── bootstrap.js     ← gh detect, auth, repo pick (runs before Ink)
│   ├── executor.js      ← single place all gh CLI calls live
│   ├── theme.js         ← color tokens (never inline hex)
│   ├── app.jsx          ← root Ink layout + responsive breakpoints
│   ├── components/      ← Sidebar, StatusBar, FooterKeys, ListPane, DetailPane
│   │   └── dialogs/     ← 6 reusable primitives (FuzzySearch → LogViewer)
│   ├── features/        ← prs, issues, branches, actions, notifications…
│   └── hooks/           ← useGh (cache+TTL), useNav, useDialog
└── build.js             ← esbuild bundler
```

**Stack:** Node.js 20+ · [Ink 4](https://github.com/vadimdemedes/ink) · React 18 · [execa](https://github.com/sindresorhus/execa) · [highlight.js](https://highlightjs.org) · [timeago.js](https://timeago.org) · [vitest](https://vitest.dev)

---

## Development

```bash
git clone https://github.com/saketh-kowtha/lgh
cd lgh
npm install
npm run dev      # watch mode: rebuilds + restarts on save
npm test         # vitest
npm run lint     # eslint
```

---

## Roadmap

See the [project board](https://github.com/users/saketh-kowtha/projects) and [open issues](https://github.com/saketh-kowtha/lgh/issues) for what's planned next.

Highlights coming up:
- Homebrew tap
- Split-pane diff view
- GitHub Enterprise (`GH_HOST`) support
- Config file + custom themes
- Mouse support (opt-in)

---

## Contributing

PRs welcome! Please open an issue first for large changes.

```bash
npm test && npm run lint   # must pass before submitting a PR
```

---

## License

[MIT](LICENSE) © saketh-kowtha
