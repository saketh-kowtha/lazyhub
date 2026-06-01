# Glossary

> Single-page definitions for every domain term used across `ARCHITECT_DECISIONS.md`, `DESIGN_REVAMP.md`, issue bodies, and the codebase. If a term appears here, this is the authoritative meaning — issue bodies should not redefine it. If a term is missing, add it.

Alphabetical. Cross-references in **bold**.

---

## A

**Agent mode** — A way of invoking lazyhub where the caller is an LLM/automation rather than a human: typically via `--json` output, **NDJSON streaming**, or the **MCP** server. Behavior must be deterministic, idempotent, and machine-parseable. Opposite of **interactive mode**.

**AI budget** — A user-defined ceiling on AI spend, configured under `[ai.budget]` in **user config**. Honored by every AI call routed through `logAiUsage()`. Two knobs: `monthly_usd_cap` and `per_call_usd_cap`. Enforcement lives in Phase L8 (V2).

**AI provider** — A pluggable backend for AI features. Four shipped today: `claude-code`, `codex`, `gemini-cli`, `anthropic-api`. Selected via `[defaults].ai_provider` in **user config** or `--provider` flag. Lives in `src/ai/providers/`. The `anthropic-api` provider is the only one allowed to make Anthropic HTTP calls directly; the other three shell out to vendor CLIs. **openai-compatible** ships in V2 (#168) and full **LiteLLM** is V3-gated (#170).

**Audit log** — Append-only NDJSON record of every state-changing operation, written to `~/.config/lazyhub/audit.log` per **ARCHITECT_DECISIONS §6**. Size-capped at 10 MB with 3-file rotation. Owned by the **daemon**.

---

## B

**Bring Your Own AI (BYO AI)** — The lazyhub differentiator: users plug in whichever AI provider they already pay for (Claude Code, Codex, Gemini CLI) or their own API key. lazyhub does not ship a hosted AI service. See also: **AI provider**, **BYO LLM**.

**Bring Your Own LLM (BYO LLM / BYOLLM)** — The narrower extension of **BYO AI**: users point lazyhub at any LLM, including self-hosted (Ollama, vLLM, LM Studio), low-cost API (Groq, Together), enterprise (Azure OpenAI, Bedrock), or aggregator (OpenRouter). Implemented via the **openai-compatible** provider in V2 (#168) for ~80% of cases; the V3-gated **LiteLLM** provider (#170) is the escape hatch for the long tail of native non-OpenAI APIs.

---

## C

**Command palette** — A `<space><space>` (or `:`) triggered overlay listing every available action by name. Implementation in `src/components/CommandPalette.jsx` + action registry in `src/ui/actions.js`. Shipped in Phase C step 5a.

**Config_url** — Optional URL under `[meta].config_url` in user TOML config. When set, lazyhub fetches config from the URL (HTTPS only) and treats the local file as a cache. Lets teams centralize config for their developers. Phase E1.

**Contract test** — A test that pins the public output shape of an external dependency (gh CLI version X.Y, AI provider API). When the dependency changes incompatibly, the contract test fails. Lives in `src/contract-tests/` (planned Phase J4/J6).

**Curated env** — The minimal environment passed to AI subprocesses: only `PATH`, `HOME`, `USER`. Never the parent process's full env. Prevents leaking `ANTHROPIC_API_KEY` or `GH_TOKEN` to non-Anthropic CLIs. Enforced in `src/ai/providers/`.

---

## D

**Daemon** — The long-running background process spawned by `lazyhub serve` (Phase K #145). Owns: gh API cache, **MCP** server protocol endpoint, IPC socket for the TUI/nvim/VSCode clients, **audit log**, AI subprocess pool, push event bus. Auto-spawns on first `lazyhub` call (overridable via `LAZYHUB_NO_DAEMON=1`).

**Dialog** — A modal overlay in the TUI that blocks the underlying view until dismissed (merge confirm, base-branch edit, etc.). Coexists with **popover** which is non-blocking and auto-dismissable.

**Diff view** — The screen that renders a PR's unified diff with side-by-side or unified layout. `src/features/prs/diff.jsx`. Redesign tracked in #127.

**Dry-run** — A `--dry-run` flag on destructive operations that returns the **plan** (what would happen) without executing. Mandatory before any state-changing agent call. Phase L4 #149.

---

## E

**Embedded mode** — Invocation style where lazyhub is hosted inside another tool (nvim split, VSCode webview, JetBrains tool window). Triggered by `--embedded` flag. Suppresses chrome that would conflict with the host (title bar, footer hints). Phase C step 7 #128.

**execFile** — The Node API used for every subprocess in lazyhub. **Never** `exec` (which shell-interpolates and is injection-prone). Prompts go via stdin, never argv. Hard rule; do not violate.

**Executor** — `src/executor.js`. The **only** file in the codebase that calls `gh`. Every GitHub interaction routes through `runGh()` here. Invariant 1.

---

## F

**Focus** — The currently-selected item in a list (PR, issue, file, check). Visually distinct from selection (which is plural). When a list item gains focus, its **popover** auto-shows after a debounce (PR list per `DESIGN_REVAMP §5.1`).

---

## G

**gh** — The GitHub CLI (`github.com/cli/cli`). The only GitHub interface lazyhub uses. No octokit, no raw HTTP. Pinned via **executor**.

**GHES** — GitHub Enterprise Server. Self-hosted GitHub. Supported via `GH_HOST` environment variable that gh already honors.

---

## H

**Headless mode** — See **Agent mode**. Often used in nvim plugin contexts where lazyhub runs without a TTY.

**Hint bar** — The footer line that lists currently-available keys (e.g. `j/k navigate • enter open • q quit`). Adapts per screen. Centralized in `src/components/FooterKeys.jsx`. Phase C step 8 #129 polishes formatting.

**Homebrew tap** — `saketh-kowtha/homebrew-tap`. Auto-updated by `.github/workflows/release.yml` on every tagged release.

---

## I

**Idempotency** — Property that a repeated operation with the same input produces the same outcome (and does not duplicate side effects). lazyhub achieves this for state-changing operations via an idempotency key cached in the **daemon**. Phase L2 #147.

**Interactive mode** — Default mode: full TUI with keyboard navigation. Opposite of **agent mode**.

**Invariant** — A property that must remain true across all changes. Six listed in `ARCHITECT_DECISIONS.md`: executor.js owns gh, anthropic-api.js owns Anthropic HTTP, execFile only, curated env, logAiUsage on every AI call, no telemetry.

---

## L

**logAiUsage()** — Helper that records every AI call's tokens, cost, provider, and outcome. Mandatory for every `src/ai/providers/*` call site. Feeds **AI budget** enforcement.

---

## M

**Marketplace** — Future community-publishing channel for themes, tabs, extensions. V3 (#159). V1 stand-in is **theme install**.

**MCP** (Model Context Protocol) — Anthropic's open standard for agent ↔ tool communication. lazyhub exposes its core operations as MCP tools via the **daemon** (Phase K #145). Registration with `~/.claude/config` is **manual** per ARCHITECT_DECISIONS §4.

---

## L

**LiteLLM** — A third-party abstraction layer that wraps 100+ LLM provider APIs behind one interface. lazyhub treats LiteLLM as the **last-resort escape hatch** for **BYO LLM**: ships only as a V3 issue (#170), gated on the **openai-compatible** provider (#168) proving insufficient. Reason: LiteLLM is a heavy dep that brings observability hooks lazyhub must explicitly disable to preserve the no-telemetry invariant.

---

## N

**NDJSON streaming** — Newline-delimited JSON used for long-running operations that emit progress events (large diff fetch, AI completion). Phase L6 #151 (V2).

**NLS** — Natural Language Search. Two variants — keep them straight:
- **NLS-A** (in-context Q&A): "Why does this PR change the auth flow?" → AI answers with citations from the current PR's files/diff/comments. Phase G #68 (V1).
- **NLS-B** (workspace search): "Show me PRs I commented on last week with failing CI" → AI translates to `gh search` query → results render as a normal PR list. Phase G2 #169 (V3). Same plumbing, different surface.

**No telemetry** — Hard rule. No analytics, no crash reporting, no phone-home. Ever. Do not propose adding it.

---

## O

**Onboarding tour** — 5-key first-launch overlay teaching the essential keymaps. `src/features/onboarding/`. Phase C step 5c #126.

**openai-compatible** — A single lazyhub AI provider that targets any HTTP endpoint speaking the OpenAI `/v1/chat/completions` shape. Covers ~80% of **BYO LLM** use cases (Ollama, Groq, LM Studio, Azure OpenAI, OpenRouter, vLLM, Together AI, Anyscale) with zero new dependencies. Lives in `src/ai/providers/openai-compatible.js` after Phase E6 #168 (V2). Preferred over **LiteLLM**.

**Opus / Sonnet / Haiku** — Model roles per the orchestration rules. Opus = architect (specs/decisions only, no code). Sonnet = senior engineer (complex logic, reviews Haiku). Haiku = junior (boilerplate, CRUD, tightly-scoped tasks).

---

## P

**Pane** — A sub-region of a **tab**. A tab can host multiple panes (e.g. the Focus tab has a "review requested" pane + a "drafts" pane).

**Phase** — A planning bucket: A (bug sweep), B (design manifesto), C (design system), D (CI), E (config — E1 #130 loader, E2 #131 writer, E3 #132 keymaps, E4 #66 custom tabs, E5 #133 doctor, **E6 #168 openai-compatible**, **E7 #170 LiteLLM**), F (CLI args), G (AI Q&A — **G2 #169 NLS-B**), H (V1 polish), I (editor integrations), J (testing), K (daemon), L (agent contract L1–L11), M (enterprise/marketplace). Each phase = 1+ GitHub issues.

**Popover** — Absolute-positioned, non-blocking overlay attached to a focused list row. Auto-shows on focus, ESC-dismissible. `src/ui/Popover.jsx`. Distinct from **dialog**.

**PR scope** — The default filter for the PR list: `mine` / `reviewing` / `all`. Set via `[defaults].pr_scope`. Not to be confused with **scope** (permissions).

**Pre-publish smoke test** — Live `gh` call in CI immediately before `npm publish` to catch executor regressions that mocks miss. Phase J5 #141.

---

## R

**runGh** — The single chokepoint function in **executor.js** that every gh call goes through. Phase J2 #139 refactor lands this as the only public API of executor.

---

## S

**Scope (permission)** — A restriction profile applied to an agent invocation: `full` / `read-only` / `review-only` / `comment-only` / `no-merge` / `triage-only` per ARCHITECT_DECISIONS §7. Set via `--scope=<name>` or `[scopes.*]` TOML block. Distinct from **PR scope**.

**Settings screen** — `,`-triggered (or palette-invoked) screen where users adjust theme, AI provider, default scope. Round-trips to TOML config. Phase C step 5b #125, E2 #131.

**Smoke test** — Minimal end-to-end test that catches whether the published package can launch and execute the happy-path. See **pre-publish smoke test**.

---

## T

**Tab** — A top-level screen in the TUI (PR list, Issues, Diff, Settings, etc.). User-definable in TOML via `[[tabs]]` arrays. Phase E4 #66.

**Theme install** — `lazyhub theme install <user>/<repo>` subcommand. V1 **marketplace** stand-in per ARCHITECT_DECISIONS §2. Clones a GitHub repo containing a `theme.toml` into `~/.config/lazyhub/themes/`.

**Theme tokens** — The 30 named color/style slots that define a theme (e.g. `accent.primary`, `diff.add.fg`). Documented in `DESIGN_REVAMP.md §3.1`. Source: `src/theme/tokens.js`.

**TOML config** — `~/.config/lazyhub/lazyhub.toml`. The single user-facing customization surface (themes, keymaps, scopes, AI provider, custom tabs, budgets). Phase E1 #130 ships the loader.

---

## U

**useConfig() / useTheme() / useRecent()** — Custom React hooks. `useConfig` exposes merged TOML config; `useTheme` exposes resolved tokens for the active scheme; `useRecent` persists last-N visited items per type.

**Unified mode (TUI)** — Render mode for the diff view that shows added/removed lines in a single column (as opposed to side-by-side). Auto-selected on narrow terminals.

**User config** — See **TOML config**.

---

## V

**V1 / V2 / V3** — Release tiers. V1 = launch (humans + agent baseline). V2 = depth (full agent contract, team-server spike, distribution breadth). V3 = enterprise + marketplace (only if demand surfaces). Tracked via GitHub labels.

---

## X

**XDG-compliant** — Follows the XDG Base Directory specification. lazyhub writes user data under `~/.config/lazyhub/` (config + audit + cache). Hard-coded; not platform-dispatched.

---

## See also

- `ARCHITECT_DECISIONS.md` — locked cross-cutting decisions
- `ARCHITECTURE.md` — high-level codebase architecture
- `DESIGN_REVAMP.md` — visual design system
- `FILE_MAP.md` — concept → owning files
- `POLISH.md` — UX polish backlog
- `CI_SIMPLIFICATION.md` — CI design
- `MANUAL_TEST_PLAN.md` — release smoke test
