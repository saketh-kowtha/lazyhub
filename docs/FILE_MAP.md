# File Map — concept → owning files

> Generated crosswalk so a fresh Claude session knows where things live.
> When in doubt, this doc points you at the right file; then read that file's JSDoc header for full context.
> Regenerate after any major refactor (add/remove/rename file) with `npm run docs:refresh`.

## Top-level entry points

| File | Purpose |
|---|---|
| `src/app.jsx` | Root Ink layout and application entry point. |
| `src/bootstrap.js` | runs BEFORE any Ink UI is rendered. Steps: 1. Detect gh CLI 2. Detect gh auth status 3. Detect repo context 4. Hand off to renderApp() |

## GitHub interface (the gh chokepoint)

| File | Purpose |
|---|---|
| `src/executor.js` | the ONLY place `gh` CLI is invoked in lazyhub. All calls go through run(args), which handles JSON parsing and error typing. |

## AI provider abstraction

| File | Purpose |
|---|---|
| `src/ai-assistant.js` | assistant.js — AI assistant brain Exposes a Claude tool-use loop that: - Executes read-only tools freely (up to MAX_TOOL_ROUNDS) - Intercepts mutating tools and returns them to the UI for confirmation - Parses <<NAVIGATE:pane[:key=val]*>> markers for app navigation Direct fetch pattern (same as ai.js). No SDK dependency. |
| `src/ai.js` | DEPRECATED re-export shim. @deprecated Import from './ai/index.js' directly. This shim is kept for one release per the migration plan (spec §11). It will be removed in the next release. |
| `src/ai/detect.js` | AI provider auto-detection and selection logic. |
| `src/ai/error.js` | AIError class definition. Standalone module to avoid circular imports between index.js, parse.js, detect.js, and the provider modules. |
| `src/ai/index.js` | Public API for AI code review and provider management. |
| `src/ai/parse.js` | Response parsing for AI code review. Extracted unchanged from src/ai.js. Handles JSON extraction, markdown fence stripping, and suggestion shape normalization. |
| `src/ai/prompt.js` | Pure prompt-building helpers and system templates for AI. |
| `src/ai/providers/_base.js` | Shared spawn helper for CLI-based AI providers. Security requirements (mirroring executor.js): - execFile only — no exec, no shell interpretation - Prompt piped via stdin — never as argv (diffs exceed ARG_MAX; injection risk) - Curated env — PATH/HOME/USER only; no secret leakage - 60s hard timeout + SIGTERM → SIGKILL after 5s grace - 256KB output cap — larger responses truncated and treated as malformed |
| `src/ai/providers/anthropic-api.js` | api.js — Anthropic HTTP API provider. This is the ONLY file that makes Anthropic HTTP calls. HTTP logic extracted unchanged from src/ai.js. Preserves the cache_control ephemeral header on the system prompt. |
| `src/ai/providers/claude-code.js` | code.js — Claude Code CLI provider. Uses the `claude` CLI in non-interactive (-p) mode. Prompt is piped via stdin — never argv (diffs exceed ARG_MAX). Auth is managed by the user's Claude Code installation (~/.claude/). |
| `src/ai/providers/codex.js` | Codex CLI provider. Uses the `codex` CLI for executing agent tasks. Prompt is piped via stdin — never argv (diffs exceed ARG_MAX). Auth is managed by the user's Codex installation (~/.codex/). Note: Codex outputs NDJSON event stream (one JSON object per line). We filter for 'agent_message' events and concatenate their text. |
| `src/ai/providers/gemini-cli.js` | cli.js — Gemini CLI provider. Uses the `gemini` CLI for executing agent tasks. Prompt is piped via stdin — never argv (diffs exceed ARG_MAX). Auth is managed by the user's Gemini CLI installation (~/.gemini/). |
| `src/ai/usage.js` | AI usage logging wrapper. Centralizes usage recording for all AI providers. Mirrors the project's existing logAiUsage() pattern. tokens{In,Out} may be null for CLI providers — that is expected. |

## Theme system

| File | Purpose |
|---|---|
| `src/theme.js` | resolves the active theme from config and exports t. |
| `src/theme/bg-detect.js` | detect.js — Terminal background brightness detection for theme selection. |
| `src/theme/index.js` | Public API for the theme system and React context. |
| `src/theme/schemes/lazyhub-dark.js` | dark.js — Default dark color scheme for terminal readability. |
| `src/theme/schemes/lazyhub-light.js` | light.js — Default light color scheme for terminal readability. |
| `src/theme/tokens.js` | Token taxonomy schema for the design system. |
| `src/themes/ansi-16.js` | 16.js — Standard 16-color ANSI theme for maximum compatibility. Works in any terminal (no hex support required). |
| `src/themes/aurora-dark.js` | cool navy/slate, lavender+cyan accents. |
| `src/themes/aurora-light.js` | cream surface, navy ink, periwinkle accents. |
| `src/themes/catppuccin-latte.js` | latte.js — Catppuccin Latte (light) color scheme. |
| `src/themes/catppuccin-mocha.js` | mocha.js — Catppuccin Mocha (dark) color scheme. |
| `src/themes/github-dark.js` | dark.js — GitHub Dark color scheme. |
| `src/themes/github-light.js` | light.js — GitHub Light color scheme. |
| `src/themes/tokyo-night.js` | night.js — Tokyo Night color scheme. |

## Features — Pull Requests

| File | Purpose |
|---|---|
| `src/features/prs/comments.jsx` | PR comments/threads view Supports: reply, edit, delete per comment |
| `src/features/prs/ConflictView.jsx` | Pull request merge-conflict resolution view. |
| `src/features/prs/detail.jsx` | PR detail pane Scrollable view: j/k to scroll, gg/G top/bottom, / to search body |
| `src/features/prs/diff-parser.js` | parser.js — pure diff-parsing logic, no React/Ink deps. Extracted from diff.jsx so it can be unit-tested without mocking the entire Ink/chalk/hljs stack. |
| `src/features/prs/diff.jsx` | PR diff view with syntax highlighting + line comments |
| `src/features/prs/list.jsx` | Pull request list pane with filtering and navigation. |
| `src/features/prs/NewPRDialog.jsx` | Smart New PR creation dialog. Features: - Auto-detects current branch and offers to use it as head - Validates head branch against remote (not pushed / has unpushed commits / no diff) - Validates base branch exists on GitHub - Offers to push branch to origin if needed - Shift+Tab for backward field navigation |

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
| `src/ui/actions.js` | Central action registry for the command palette. |
| `src/ui/Popover.jsx` | Floating popover primitive for overlays and tooltips. |

## Components (shared)

| File | Purpose |
|---|---|
| `src/components/AIAssistant.jsx` | AI assistant overlay Full-screen content-area overlay triggered by Ctrl+A. Shows conversation history, a single-line prompt, and handles action confirmation + navigation prompts inline. |
| `src/components/AIReviewPane.jsx` | Interactive step-through UI for AI code reviews. |
| `src/components/CommandPalette.jsx` | fuzzy command palette overlay for executing actions. |
| `src/components/CommentThread.jsx` | renders a list of comments as a threaded discussion. Props: comments ([Comment]), t (theme object) Used in: diff.jsx inline threads, comments.jsx view |
| `src/components/CustomPane.jsx` | Generic pane renderer for user-defined tabs. |
| `src/components/dialogs/ConfirmDialog.jsx` | confirmation dialog primitive. Props: message, destructive (bool), onConfirm(), onCancel(), requireText? (string to type) |
| `src/components/dialogs/FormCompose.jsx` | multi-field form dialog primitive. Props: title, fields ([{name, label, type: 'text'|'multiline'|'select'}]) onSubmit(values), onCancel() |
| `src/components/dialogs/FuzzySearch.jsx` | fuzzy search dialog with virtual scrolling. Renders only as many items as fit in the terminal — safe for thousands of items. Props: items, onSubmit(item), onCancel(), searchFields |
| `src/components/dialogs/LogViewer.jsx` | full-screen scrollable log viewer primitive. Props: lines (string[]), onClose() |
| `src/components/dialogs/MultiSelect.jsx` | multi-select checklist with virtual scrolling. Renders only as many items as fit in the terminal — safe for large label/assignee lists. Props: items ([{id, name, color?, selected?}]), onSubmit(selectedIds[]), onCancel() |
| `src/components/dialogs/OptionPicker.jsx` | single-select option picker with virtual scrolling. Props: options ([{value, label, description?}]), onSubmit(value), onCancel(), title?, promptText? |
| `src/components/ErrorBoundary.jsx` | catches render crashes, logs them, shows a minimal error box. |
| `src/components/FooterKeys.jsx` | footer key hint bar. Keys shape: { key, label, group? } When group numbers present, renders groups separated by ┊ (U+250A). Falls back to plain │ separators when no groups defined. |
| `src/components/Monogram.jsx` | [XX] author initial badge with hash-based color. Props: login (string) |
| `src/components/Sidebar.jsx` | Navigation sidebar for switching between feature views. |
| `src/components/Skeleton.jsx` | animated placeholder loaders for every list/detail pane. Each exported component mirrors the exact column layout of its real counterpart so the UI doesn't shift when data arrives. Animation: a single 700ms interval per skeleton component pulses all bars between ░ and ▒ — one setInterval total, not one per bar. |
| `src/components/Spinner.jsx` | animated braille spinner for loading states |
| `src/components/StatusBar.jsx` | Application status bar showing context and global state. |
| `src/components/TabStrip.jsx` | horizontal pane tabs for compact mode (<80 cols). Props: panes (string[]), currentPane, paneLabels, paneIcons, onSelect |
| `src/components/Toaster.jsx` | transient notification stack, max 3, bottom-right. Variants: success (2.5s), info (3s), warning (4s), error (sticky). Usage: call useToast() hook to get { toast } function. toast({ message, variant: 'success'|'info'|'warning'|'error' }) |

## Hooks

| File | Purpose |
|---|---|
| `src/hooks/useGh.js` | React hook that wraps executor calls with loading/error/data state and an in-memory TTL cache. |
| `src/hooks/useLayout.js` | responsive layout breakpoints based on terminal dimensions. Config overrides always win over breakpoint defaults. |
| `src/hooks/usePaneState.js` | preserve list/pane view state across navigation. State is stored in a Map on AppContext (via paneStateRef). Survives PRList unmount (back-nav from detail/diff). Cleared on explicit pane-switch (Tab, number key) by the App. Usage: const [state, setState] = usePaneState('prs', { cursor: 0, scrollOffset: 0, filterState: 'open', ... }) |
| `src/hooks/useRecent.js` | persist recently viewed items to ~/.config/lazyhub/recent.json Max 10 entries per type. Entries: { type: 'pr'|'issue', repo, number, title, updatedAt } |
| `src/hooks/useVirtualList.js` | React hook for efficient virtualized rendering of long lists. |

## Configuration & Context

| File | Purpose |
|---|---|
| `src/config.js` | manages application configuration and user settings. |
| `src/context.js` | shared React contexts Kept separate from app.jsx so feature components don't create circular imports by reaching back into the root layout module. |

## Utilities & Infrastructure

| File | Purpose |
|---|---|
| `src/editor.js` | Editor detection and file-open utility Supports: vscode, cursor, nvim, vim, nano, emacs, and $EDITOR/$VISUAL fallback. Configured via config.editor.command ("auto" | "vscode" | "cursor" | "nvim" | etc.) openInEditor(file, line) — opens the file at the given line number in the detected/configured editor. Non-blocking; fires and returns immediately. |
| `src/ipc.js` | Inter-process communication for external editor integrations. |
| `src/keyscope.js` | Keyboard focus and input scope management for Ink TUI. |
| `src/mcp.js` | Model Context Protocol (MCP) server for AI tool-use. |
| `src/utils.js` | shared utility functions |

## Tests

Test file counts by directory:

| Directory | Test files |
|---|---|
| `src/` | 5 |
| `src/ai/` | 3 |
| `src/ai/providers/` | 3 |
| `src/features/prs/` | 2 |
| `src/theme/` | 1 |
| `src/ui/` | 2 |

**Total non-test source files:** 78
**Total test files:** 16
