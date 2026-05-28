# File Map — concept → owning files

> Generated crosswalk so a fresh Claude session knows where things live.
> When in doubt, this doc points you at the right file; then read that file's JSDoc header for full context.
> Regenerate after any major refactor (add/remove/rename file).

## Top-level entry points

| File | Purpose |
|---|---|
| `src/app.jsx` | Root Ink layout + renderApp() entry point |
| `src/bootstrap.js` | Pre-UI setup: detect gh CLI, auth status, repo context |

## GitHub interface (the gh chokepoint)

| File | Purpose |
|---|---|
| `src/executor.js` | The ONLY place `gh` CLI is invoked; all calls go through run(args) |

## AI provider abstraction

| File | Purpose |
|---|---|
| `src/ai-assistant.js` | Claude tool-use loop with navigation markers and action confirmation |
| `src/ai/detect.js` | Provider auto-detection and selection (Phase 1: claude-code → anthropic-api) |
| `src/ai/error.js` | AIError class definition (standalone to avoid circular imports) |
| `src/ai/index.js` | Public API for AI-powered code review (ONLY entry point callers should use) |
| `src/ai/parse.js` | Response parsing for AI code review (JSON extraction, suggestion normalization) |
| `src/ai/prompt.js` | Pure prompt-building helpers with research-backed techniques |
| `src/ai/providers/_base.js` | Shared spawn helper for CLI-based AI providers (security-hardened) |
| `src/ai/providers/anthropic-api.js` | Anthropic HTTP API provider (ONLY file making Anthropic HTTP calls) |
| `src/ai/providers/claude-code.js` | Claude Code CLI provider using `claude` CLI in non-interactive mode |
| `src/ai/providers/codex.js` | Codex CLI provider filtering NDJSON agent_message events |
| `src/ai/providers/gemini-cli.js` | Gemini CLI provider using `gemini` CLI |
| `src/ai/usage.js` | AI usage logging wrapper (telemetry / debugging) |

## Theme system

| File | Purpose |
|---|---|
| `src/theme.js` | Resolves the active theme from config and exports t |
| `src/theme/bg-detect.js` | Terminal background brightness detection (light vs. dark) |
| `src/theme/index.js` | Public API for lazyhub theme system (ThemeProvider, useTheme hook) |
| `src/theme/schemes/lazyhub-dark.js` | Default dark color scheme (GitHub Dark Dimmed inspired) |
| `src/theme/schemes/lazyhub-light.js` | Light color scheme (daylight counterpart to lazyhub-dark) |
| `src/theme/tokens.js` | Token taxonomy schema for design system (shape definition, no values) |
| `src/themes/ansi-16.js` | Standard 16-color ANSI theme for maximum compatibility |
| `src/themes/aurora-dark.js` | Aurora Dark — cool navy/slate, lavender+cyan accents |
| `src/themes/aurora-light.js` | Aurora Light — cream surface, navy ink, periwinkle accents |
| `src/themes/catppuccin-latte.js` | Catppuccin Latte color scheme |
| `src/themes/catppuccin-mocha.js` | Catppuccin Mocha color scheme |
| `src/themes/github-dark.js` | GitHub Dark color scheme |
| `src/themes/github-light.js` | GitHub Light color scheme |
| `src/themes/tokyo-night.js` | Tokyo Night color scheme |

## Features — Pull Requests

| File | Purpose |
|---|---|
| `src/features/prs/comments.jsx` | PR comments/threads view (reply, edit, delete per comment) |
| `src/features/prs/ConflictView.jsx` | GitHub PR merge-conflict resolution (checkout, merge, edit, push) |
| `src/features/prs/detail.jsx` | PR detail pane (scrollable: j/k scroll, gg/G top/bottom, / search) |
| `src/features/prs/diff-parser.js` | Pure diff-parsing logic (unit-testable, no React/Ink deps) |
| `src/features/prs/diff.jsx` | PR diff view with syntax highlighting + line comments |
| `src/features/prs/list.jsx` | PR list pane with virtual scrolling and filtering |
| `src/features/prs/NewPRDialog.jsx` | Smart New PR creation (auto-detect branch, validate, offer push) |

## Features — Issues

| File | Purpose |
|---|---|
| `src/features/issues/detail.jsx` | Issue detail pane |
| `src/features/issues/list.jsx` | Issue list pane |

## Features — other

| File | Purpose |
|---|---|
| `src/features/actions/index.jsx` | Actions / workflow runs pane |
| `src/features/branches/index.jsx` | Branch list pane |
| `src/features/logs/index.jsx` | In-app structured log viewer |
| `src/features/notifications/index.jsx` | Notifications pane |
| `src/features/settings/index.jsx` | In-app settings and theme picker |

## UI primitives

| File | Purpose |
|---|---|
| `src/ui/Popover.jsx` | Floating popover primitive (absolutely-positioned overlay, no layout shift) |
| `src/ui/actions.js` | Central action registry for the command palette |

## Components (shared)

| File | Purpose |
|---|---|
| `src/components/AIAssistant.jsx` | AI assistant overlay (full-screen, Ctrl+A trigger) |
| `src/components/AIReviewPane.jsx` | Interactive step-through AI code review pane |
| `src/components/CommandPalette.jsx` | Fuzzy command palette overlay (: or <space><space> trigger) |
| `src/components/CommentThread.jsx` | Renders comments as a threaded discussion |
| `src/components/CustomPane.jsx` | Generic pane renderer for user-defined tabs |
| `src/components/dialogs/ConfirmDialog.jsx` | Confirmation dialog primitive |
| `src/components/dialogs/FormCompose.jsx` | Multi-field form dialog primitive |
| `src/components/dialogs/FuzzySearch.jsx` | Fuzzy search dialog with virtual scrolling |
| `src/components/dialogs/LogViewer.jsx` | Full-screen scrollable log viewer primitive |
| `src/components/dialogs/MultiSelect.jsx` | Multi-select checklist with virtual scrolling |
| `src/components/dialogs/OptionPicker.jsx` | Single-select option picker with virtual scrolling |
| `src/components/ErrorBoundary.jsx` | Catches render crashes, logs them, shows minimal error box |
| `src/components/FooterKeys.jsx` | Footer key hint bar |
| `src/components/Monogram.jsx` | [XX] author initial badge with hash-based color |
| `src/components/Sidebar.jsx` | (no header — inferred: sidebar navigation component) |
| `src/components/Skeleton.jsx` | Animated placeholder loaders for every list/detail pane |
| `src/components/Spinner.jsx` | Animated braille spinner for loading states |
| `src/components/StatusBar.jsx` | (no header — inferred: status bar component) |
| `src/components/TabStrip.jsx` | Horizontal pane tabs for compact mode (<80 cols) |
| `src/components/Toaster.jsx` | Transient notification stack (max 3, bottom-right) |

## Hooks

| File | Purpose |
|---|---|
| `src/hooks/useGh.js` | React hook wrapping executor calls with loading/error/data state and TTL cache |
| `src/hooks/useLayout.js` | Responsive layout breakpoints based on terminal dimensions |
| `src/hooks/usePaneState.js` | Preserve list/pane view state across navigation (Map on AppContext) |
| `src/hooks/useRecent.js` | Persist recently viewed items to ~/.config/lazyhub/recent.json |
| `src/hooks/useVirtualList.js` | Shared virtual-scroll hook used by every list/dialog (safe for thousands of items) |

## Configuration & Context

| File | Purpose |
|---|---|
| `src/config.js` | Loads ~/.config/lazyhub/config.json (theme, layout, editor, customPanes) |
| `src/context.js` | Shared React contexts (AppContext) |

## Utilities & Infrastructure

| File | Purpose |
|---|---|
| `src/editor.js` | Editor detection and file-open utility (vscode, nvim, vim, nano, emacs, etc.) |
| `src/ipc.js` | IPC Unix-socket server for IDE integrations |
| `src/keyscope.js` | Keyboard scope isolation for Ink TUI (priority levels: global < pane < dialog < input) |
| `src/mcp.js` | MCP (Model Context Protocol) server mode for AI assistants |
| `src/utils.js` | Shared utility functions (sanitize, shortAge, authorColor, logger, TextInput, etc.) |

## Tests

Test file counts by directory:

| Directory | Test files |
|---|---|
| `src/` | 3 |
| `src/ai/` | 3 |
| `src/ai/providers/` | 3 |
| `src/features/prs/` | 2 |
| `src/theme/` | 1 |
| `src/ui/` | 2 |

**Total non-test source files:** 89
**Total test files:** 16
