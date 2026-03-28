# lazyhub

> A **lazygit-style** GitHub TUI — every GitHub action available without leaving your terminal.

[![CI](https://github.com/saketh-kowtha/lazyhub/actions/workflows/ci.yml/badge.svg)](https://github.com/saketh-kowtha/lazyhub/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/lazyhub.svg)](https://www.npmjs.com/package/lazyhub)
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
  saketh-kowtha/lazyhub   main   ✓ 3/3 checks   Rate limit: 4823/5000
  Tab panes  j/k nav  Enter detail  d diff  m merge  q back  ? help
```

---

## Why lazyhub?

Most GitHub workflows force you to context-switch to the browser. `gh` CLI is
great but its output is flat text — no side-by-side layout, no live diffs, no
interactive merge strategies.  **lazyhub** brings the full GitHub web UI into your
terminal as a keyboard-driven TUI, so you never have to leave your editor
session.

| Feature | Browser | gh CLI | **lazyhub** |
|---------|---------|--------|----------|
| PR list + filters | ✓ | ✓ | ✓ |
| Inline diff with syntax highlight | ✓ | ✓ | ✓ |
| Line-level comments + threads | ✓ | ✗ | ✓ |
| Approve / request-changes | ✓ | ✓ | ✓ |
| Merge strategy picker | ✓ | ✗ | ✓ |
| Actions logs streaming | ✓ | ✓ | ✓ |
| Fuzzy search every list | ✗ | ✗ | ✓ |
| Find text in diff | ✗ | ✗ | ✓ |
| File tree navigation in diff | ✗ | ✗ | ✓ |
| Author filter for PR search | ✓ | ✗ | ✓ |
| Full config + custom themes | ✗ | ✗ | ✓ |
| Keyboard-only, no mouse needed | ✗ | ✓ | ✓ |

---

## Install

### npm (recommended)

```bash
npm install -g lazyhub
```

### npx (no install)

```bash
npx lazyhub
```

### Homebrew (coming soon)

```bash
brew install saketh-kowtha/tap/lazyhub
```

**Prerequisites:** [Node.js ≥ 20](https://nodejs.org) and the [GitHub CLI (`gh`)](https://cli.github.com).
`lazyhub` will detect missing tools and print platform-specific install instructions on first run.

---

## Usage

```bash
# From any git repo cloned from GitHub
cd my-project
lazyhub

# Or pick a repo interactively (works outside any git directory)
lazyhub
```

`lazyhub` handles the rest:
- Detects `gh` — prints install instructions if missing
- Detects `gh auth` — runs interactive login (browser or PAT) if needed
- Detects repo context — shows an arrow-key picker if run outside a git directory

---

## Panes

| Pane | What you can do |
|------|-----------------|
| Pull Requests | list, filter (open/closed/merged), fuzzy search, author filter, detail, diff, line comments, approve, merge, labels, reviewers, create PR |
| Issues | list, filter (open/closed), create, close, labels, assignees |
| Branches | list, checkout, create, delete, push |
| Actions | list runs, view logs, re-run, cancel |
| Notifications | list, open, mark read / all read |

---

## Keybindings

### Global
| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Cycle panes |
| `j` / `k` or `↑↓` | Navigate list |
| `gg` / `G` | Jump to top / bottom |
| `Enter` | Open detail |
| `r` | Refresh (force re-fetch) |
| `o` | Open in browser |
| `/` | Fuzzy search |
| `?` | Help overlay |
| `q` | Back / quit |

### Pull Requests
| Key | Action |
|-----|--------|
| `O` | Filter: open (configurable) |
| `C` | Filter: closed (configurable) |
| `M` | Filter: merged (configurable) |
| `f` | Cycle filter (fallback) |
| `s` | Cycle scope (all / own / reviewing) |
| `@` | Filter by author (any GitHub username) |
| `d` | Open diff view |
| `m` | Merge (pick --merge / --squash / --rebase) |
| `a` | Approve |
| `x` | Request changes |
| `c` | Checkout branch |
| `l` | Edit labels |
| `A` | Edit assignees |
| `rv` | Request reviewers |
| `N` | New PR (with branch validation) |
| `y` | Copy PR URL |

### PR Detail
| Key | Action |
|-----|--------|
| `j` / `k` | Scroll detail |
| `/` | Search within detail |
| `Esc` | Clear search / go back |
| `d` | Open diff view |

### Diff view
| Key | Action |
|-----|--------|
| `j` / `k` | Scroll lines |
| `[` / `]` | Previous / next file |
| `t` | Toggle file tree |
| `/` | Find text in diff |
| `n` / `N` | Next / prev match (or comment thread) |
| `c` | Comment on cursor line (inline compose) |
| `v` | View all comments |
| `s` | Toggle split / unified |
| `Esc` | Back to PR detail |

### Issues
| Key | Action |
|-----|--------|
| `O` | Filter: open (configurable) |
| `C` | Filter: closed (configurable) |
| `f` | Cycle filter (fallback) |
| `n` | New issue |
| `x` | Close issue |
| `l` | Edit labels |
| `A` | Edit assignees |
| `y` | Copy issue URL |

### Actions
| Key | Action |
|-----|--------|
| `l` | View logs |
| `R` | Re-run failed jobs |
| `X` | Cancel run |

### Notifications
| Key | Action |
|-----|--------|
| `Enter` | Open item (routes to correct pane) |
| `m` | Mark as read |
| `M` | Mark all as read |

---

## Configuration

On first run, `lazyhub` creates `~/.config/lazyhub/config.json` with defaults.
Edit this file to customize everything:

```json
{
  "panes": ["prs", "issues", "branches", "actions", "notifications"],
  "defaultPane": "prs",
  "theme": "github-dark",
  "pr": {
    "defaultFilter": "open",
    "defaultScope": "all",
    "pageSize": 100,
    "keys": {
      "filterOpen":   "O",
      "filterClosed": "C",
      "filterMerged": "M"
    }
  },
  "issues": {
    "defaultFilter": "open",
    "pageSize": 50,
    "keys": {
      "filterOpen":   "O",
      "filterClosed": "C"
    }
  },
  "actions": {
    "pageSize": 30
  },
  "diff": {
    "defaultView": "unified",
    "syntaxHighlight": true,
    "maxLines": 2000
  },
  "customPanes": {}
}
```

### Custom panes

Add your own panes backed by any `gh api` command:

```json
"customPanes": {
  "my-deploys": {
    "label": "Deployments",
    "icon": "▶",
    "command": "gh api repos/{repo}/deployments --jq '[.[] | {title:.environment,number:.id,state:.task,updatedAt:.created_at,url:.url}]'",
    "actions": { "o": "open" }
  }
}
```

Placeholders: `{repo}`, `{owner}`, `{name}`

---

## Themes

### Built-in themes

| Name | Style |
|------|-------|
| `github-dark` | Dark (default) — GitHub-inspired |
| `github-light` | Light — GitHub-inspired |
| `catppuccin-mocha` | Extra dark pastel |
| `catppuccin-latte` | Light pastel |
| `tokyo-night` | Dark blue/purple |

Set in config:

```json
{ "theme": "tokyo-night" }
```

### Custom themes from file

```json
{ "theme": "/absolute/path/to/my-theme.json" }
{ "theme": "~/my-theme.json" }
{ "theme": "my-theme.json" }
```

### Override specific colors

```json
{
  "theme": {
    "name": "github-dark",
    "overrides": {
      "ui": { "selected": "#ff9900" },
      "pr":  { "open": "#00ff88" }
    }
  }
}
```

Theme files use the same shape as built-in themes. All color values are hex strings.

---

## Architecture

```
lazyhub/
├── bin/lazyhub.js          ← entry: bootstrap() → renderApp()
├── src/
│   ├── bootstrap.js     ← gh detect, auth, repo pick (runs before Ink)
│   ├── executor.js      ← single place all gh CLI calls live
│   ├── theme.js         ← dynamic theme resolution (named/file/overrides)
│   ├── config.js        ← loads ~/.config/lazyhub/config.json with defaults
│   ├── app.jsx          ← root Ink layout + responsive breakpoints
│   ├── themes/          ← 5 built-in theme definitions
│   ├── components/      ← Sidebar, StatusBar, FooterKeys, ListPane, DetailPane
│   │   └── dialogs/     ← 6 reusable primitives (FuzzySearch → LogViewer)
│   ├── features/        ← prs, issues, branches, actions, notifications…
│   └── hooks/           ← useGh (cache+TTL), useNav, useDialog
└── build.js             ← esbuild bundler
```

**Stack:** Node.js 20+ · [Ink 4](https://github.com/vadimdemedes/ink) · React 18 · [execa](https://github.com/sindresorhus/execa) · [highlight.js](https://highlightjs.org) · [timeago.js](https://timeago.org) · [vitest](https://vitest.dev)

**Responsive layout:**
- ≥100 cols: sidebar + list + detail panel
- <100 cols: sidebar + list (Enter for full-screen detail)
- <80 cols: header tabs + list (no sidebar)

---

## Development

```bash
git clone https://github.com/saketh-kowtha/lazyhub
cd lazyhub
npm install
npm run dev      # watch mode: rebuilds + restarts on save
npm test         # vitest
npm run lint     # eslint
```

---

## Roadmap

See the [project board](https://github.com/users/saketh-kowtha/projects) and [open issues](https://github.com/saketh-kowtha/lazyhub/issues) for what's planned next.

Highlights coming up:
- Homebrew tap
- GitHub Enterprise (`GH_HOST`) support
- Mouse support (opt-in)
- Releases pane
- Gists pane

---

## Contributing

PRs welcome! Please open an issue first for large changes.

```bash
npm test && npm run lint   # must pass before submitting a PR
```

---

## License

[MIT](LICENSE) © saketh-kowtha
