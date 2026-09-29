# Architecture Decisions

> Single source of truth for cross-cutting decisions that affect multiple issues.
> If an issue body conflicts with this doc, **this doc wins** unless the issue body
> explicitly says "overrides ARCHITECT_DECISIONS §X".
>
> **Fresh session checklist:** read this file, then the issue body, then any other
> doc the issue body links to. That triad is your full context.

## Agent Gateway decisions (2026-09-28)

These decisions supersede older issue comments and Decisions 3-7 wherever they
conflict. Alpha targets solo maintainers and pilot repositories. Slice 1 is
watch-only observation plus immediate safety and release hardening. Slice 2
records an exact approval and updates `lazyhub/approval`; Lazyhub does not
execute merges in Alpha.

### D1 — GitHub-enforced approval check

Every pull request targeting an enrolled protected branch requires a check named
`lazyhub/approval`, with the expected source pinned to the user's Lazyhub GitHub
App integration. There is no human-authored-PR exemption: author/agent
classification is audit metadata only.

The check binds repository and PR node IDs, head SHA, observed base SHA, request
ID, policy/evidence versions, expiry, and nonce. Missing approval and stale,
expired, or revoked approval are non-passing; never use `neutral` or `skipped`
for denial. A changed head always needs a new approval.

The checks-only credential helper is the only component that can turn this
check green. Alpha does not yet have trusted payload-bound native human-presence
signing. Therefore local-agent merges are `managed_gateway`. A cloud agent with
no access to the local helper may be `github_enforced` after App-source and
ruleset verification. Native presence signing is tracked separately and does
not block Alpha.

### D2 — User-owned checks-only App

Each user or organization owns and installs its own App. The App has repository
metadata/read access plus Checks write for explicitly selected repositories. It
has no PR-review, merge, administration, secrets, workflows, organization, or
ruleset-bypass authority.

For each approval, the helper mints a fresh installation token restricted to
one repository and `checks:write`, uses it internally for one check operation,
then discards it. Tokens are never cached, persisted, returned over IPC, placed
in process environments, or exposed to the daemon, TUI, agents, logs, audit, or
diagnostics.

### D3 — Layered identity with one Alpha App

Alpha uses one shared GitHub App identity for check publication. Lazyhub still
records a stable enrolled agent identity, short-lived session identity, and
separate authenticated human approver identity. Self-declared MCP client names,
process names, and PR classification are metadata, never authorization inputs.
Every App action carries the canonical request ID in the check `external_id`.
The App never submits PR reviews.

### D4 — Exact approval, not execution

Policy classifies future operations as `auto_allow`, `ask`, or `always_deny`,
but Alpha only records approve, deny, revoke, expire, and inspect decisions. An
approval binds one canonical request and its preconditions. Material deviation
requires a new approval. Alpha has no batch approval and no mutation execution,
retry, or reconciliation lifecycle.

### D5 — Watch-only is the default

New installs use the existing read-only `gh` session to observe GitHub-side PR
timelines, commits, reviews, check runs, and known actor identities. No agent,
webhook, App, or MCP configuration is required. Unknown attribution remains
`unknown`; reports stay local and never grant authority.

### D6 — Private-read to public-write rule

After a session reads a private repository, any proposed public-repository write
is at least `ask`. This remains a policy requirement for Beta execution; Alpha
does not execute the write.

### D7 — Honest operation-level coverage

Coverage is reported per operation as exactly one of `github_enforced`,
`managed_gateway`, `advisory`, or `ungoverned`, with evidence and downgrade
reasons. A repository-level protected badge is insufficient. Doctor reports
alternate credentials, SSH, direct clients, other MCP servers, incomplete
observation, and ruleset bypasses.

### D8 — Fail closed

Gateway, policy, identity, approval-store, audit, or classification failure
blocks writes. A missing approval check leaves a merge pending. No governed
write falls back to direct `gh`, and no unknown operation is treated as a read.

### D9 — Policy and approval service

`lazyhub serve` is a typed policy, approval, and event service, not a general
GitHub command proxy and not an impenetrable same-OS-user vault. Local isolation
is defense-in-depth hygiene. Privileged daemons are never auto-spawned from an
untrusted agent context.

### D10 — One-way agent safe mode

Agents may engage safe mode but cannot disengage it, alter policy, revoke
containment, or change repository enforcement. Human recovery uses a separate
authenticated channel. Removing the App or tightening the ruleset is the
GitHub-side kill switch.

### D11 — Minimal durable audit

Audit stores identities, request IDs, hashes, state transitions, and GitHub
links rather than prompts, full diffs, or credentials. Sensitive files are
permission restricted, retention defaults to 90 days, and integrity-linked
entries fail closed for governed writes.

### D12 — Product focus

Until pilot evidence exists, support npm and Homebrew only, freeze editor
integrations and broad TUI expansion, and prioritize watch-only observation,
approval integrity, published-package security, and trustworthy diagnostics.

## How to read an issue body

Every V1/V2/V3 issue is intended to be **executed in a single Claude session**
without needing prior conversation context. The issue body contains:

1. **Goal** — one-sentence intent
2. **Files to touch** / **Files NOT to touch** — explicit lists
3. **Acceptance criteria** — testable bullets
4. **Constraints** — patterns to follow, things to avoid
5. **References** — links to this doc, DESIGN_REVAMP.md, CI_SIMPLIFICATION.md, MANUAL_TEST_PLAN.md, or POLISH.md as needed

If something is missing or ambiguous, open the issue thread and ask — don't guess.

---

## Decision 1 — License

**MIT.**

- **Why:** target audience is humans + AI agents + OSS community. MIT maximizes
  adoption and is what every comparable TUI (lazygit, gh, fzf) ships with.
- **Revisit:** when an enterprise tier (Phase M2 #158) ships, evaluate dual-license
  (MIT core + BSL for hosted server). Not before.
- **Files affected:** `LICENSE`, `package.json`, README footer.

## Decision 2 — Marketplace V1 stand-in

**Ship `lazyhub theme install <user>/<repo>` and `lazyhub theme list`.**

- **Why:** ~1 day of work; gives community a publishing path day-1 without
  building a real marketplace. The repo-as-package model (à la Vim plugins) is
  battle-tested and free hosting (GitHub) for us.
- **How:** Theme = a single `theme.toml` at the repo root. Installer clones into
  `~/.config/lazyhub/themes/<user>-<repo>/`. `useTheme()` resolves user themes
  by name.
- **Out of scope V1:** signing, reviews, ratings, central registry.
- **Tracked in:** #134 (polish bundle adds the command), Phase E1 #130 (config
  schema for installed themes).

## Decision 3 — Daemon spawn behavior (superseded by D9)

> Historical V1 decision. Do not implement this auto-spawn behavior for the
> privileged gateway. D9 and the current issue body control.

**Auto-spawn on first `lazyhub` call. Opt-out via `LAZYHUB_NO_DAEMON=1`.**

- **Why:** best DX for humans (zero config) and agents (deterministic — agent
  calls `lazyhub --json prs.list`, gets a fast warm response). Idempotent —
  if daemon already running, attach over IPC socket.
- **Lifecycle:** daemon writes PID to `~/.config/lazyhub/daemon.pid`. The daemon
  uses Node `net` with a platform-conditional endpoint: Unix systems listen on
  `~/.config/lazyhub/daemon.sock`; Windows listens on a same-user named pipe at
  `\\.\pipe\lazyhub-<user>`. On crash, stale Unix socket files are cleaned on
  next attach attempt.
- **Tracked in:** Phase K #145.

## Decision 4 — MCP server registration (superseded by D5 and D9)

> Historical V1 decision. MCP registration is not part of the Alpha onboarding
> path; D5 and D9 control.

**Manual via `lazyhub mcp install`. Never auto-edit `~/.claude/config`.**

- **Why:** editing the user's MCP client config without explicit consent is
  invasive. The command prints the exact JSON snippet to add, or — with
  `--write` flag — appends it after asking.
- **Tracked in:** Phase K #145.

## Decision 5 — Daemon idle timeout (superseded by D9)

> Historical V1 decision. Define lifecycle only after the Beta gateway design;
> D9 controls.

**30 minutes default. Configurable via `[daemon.idle_timeout_minutes]` in TOML.**

- **Why:** balances warm-cache benefit against background resource use. Agents
  on long jobs can override; idle humans don't pay forever.
- **Tracked in:** Phase E1 #130, Phase K #145.

## Decision 6 — Audit log location (superseded by D11)

> Historical V1 decision. D11 controls audit content, permissions, retention,
> integrity, and failure behavior.

**`~/.config/lazyhub/audit.log` (XDG-compliant). Configurable via `[audit.path]`.**

- **Format:** NDJSON, one line per state-changing operation.
- **Rotation:** size-based, 10 MB cap, keep last 3 files. Owned by Phase K #145.
- **Tracked in:** Phase L3 #148, Phase K #145.

## Decision 7 — Permission scope set (superseded by D4, D7, and D8)

> Historical scope names may remain for compatibility, but D4, D7, and D8
> control authority. Unknown clients and fresh configuration are read-only.

**Six built-in scopes:**

| Scope | Reads | Writes | Approves | Merges | Comments |
|---|---|---|---|---|---|
| `full` | ✓ | ✓ | ✓ | ✓ | ✓ |
| `read-only` | ✓ | | | | |
| `review-only` | ✓ | | ✓ | | ✓ |
| `comment-only` | ✓ | | | | ✓ |
| `no-merge` | ✓ | ✓ | ✓ | | ✓ |
| `triage-only` | ✓ | | | | ✓ (issues only) |

- **Configurable:** custom scopes definable in `[scopes.<name>]` TOML blocks.
- **Default:** `read-only`. Broader configured names do not grant authority until
  the typed server-side policy path exists.
- **Tracked in:** Phase L3 #148, Phase E1 #130.

## Decision 8 — BYO-LLM strategy

**Add one `openai-compatible` provider first. Treat LiteLLM as a last-resort escape hatch.**

- **Why:** ~80% of "I want to use Ollama / Groq / LM Studio / Azure OpenAI / OpenRouter / vLLM" reduces to one HTTP shape — OpenAI `/v1/chat/completions` at a configurable URL + key. Adding one provider (~200 lines, no deps) covers the long tail. LiteLLM is a heavy abstraction that adds 100+ providers but pulls in telemetry hooks lazyhub would have to explicitly disable, plus its own dependency surface.
- **Order:** ship `openai-compatible` (#168, V2). If post-launch, 3+ users request a provider with a NON-OpenAI-compatible API (native Cohere v1, native Mistral, native PaLM), THEN evaluate LiteLLM (#170, V3-gated).
- **Never auto-enable LiteLLM's observability/telemetry features.** Lazyhub's "no telemetry, ever" invariant is non-negotiable. The LiteLLM provider's first job is to disable every built-in observability hook at config time.
- **Tracked in:** #168 (Phase E6, V2 — openai-compatible), #170 (Phase E7, V3-gated — LiteLLM).

## Decision 9 — Coverage gate in CI

**CI runs Vitest with V8 coverage enabled, enforces hard floors, uploads the HTML/JSON artifact, and comments the PR with a diff-aware report.**

- **Why:** this repo now has a meaningful mix of unit tests and mocked TUI interaction tests, but regressions still slip through when coverage is invisible. A hard floor makes "tests passed" less hollow, and the PR report gives reviewers a quick read on what changed.
- **How:** keep Vitest config in `vite.config.js`, use `@vitest/coverage-v8` pinned to the same major/minor line as Vitest 3, and emit `text`, `json-summary`, `json`, and `html` reports. CI runs the full Vitest suite with coverage enabled and compares PR coverage against the base branch with `davelosert/vitest-coverage-report-action@v2`.
- **Current floors:** statements `48`, branches `58`, functions `45`, lines `48`. They are set from the current cross-platform baseline, not from one local run. Raise them intentionally as coverage improves; don't quietly lower them to get a PR green.
- **Scope:** enforce thresholds against `src/**/*.{js,jsx}` with tests and support helpers excluded. Do not expand the gate to docs, build scripts, or editor integrations unless a future issue explicitly asks for that.
- **Tracked in:** #138.

---

## Other locked-in invariants (do not violate)

These are not decisions in flight — they are project rules. Listing here so fresh
sessions don't need conversation history to know them.

1. **Repository operations use the typed executor.** Ordinary GitHub calls go
   through `src/executor.js`. The sole raw-HTTPS exception is the minimal
   credential helper for allowlisted GitHub App authentication, token, and
   check endpoints. It uses only an explicitly configured proxy and ignores
   inherited proxy variables. No Octokit or generic HTTP GitHub client.
2. **`src/ai/providers/anthropic-api.js` is the only file that makes Anthropic HTTP calls.**
3. **Subprocess discipline:** `execa` only, args always as arrays. Never shell
   strings / shell interpolation. Prompts via stdin, never argv. All `gh` calls
   go through `runGh()` in `src/executor.js` (the single chokepoint).
4. **Curated env for AI subprocesses:** PATH / HOME / USER only. Never leak
   `ANTHROPIC_API_KEY` or `GH_TOKEN` to non-Anthropic CLIs.
5. **Every AI call goes through `logAiUsage()`** for cost tracking and audit.
6. **No telemetry, ever.** No analytics, no crash reporting, no phone-home.
   This is a hard line; do not propose adding it.
7. **React pinned to ^18.** Ink 4 is incompatible with React 19. Do not bump.
8. **ESLint pinned to ^8.** ESLint 9+ requires flat config migration; out of V1 scope.
9. **Vitest pinned to ^3.** Vitest 4.1.8 passes the suite but changes V8 coverage remapping enough to break the current coverage floors. Keep Vitest 3.x and use npm overrides for patched transitive Vite/esbuild until the coverage gate is intentionally recalibrated.
10. **Coverage plugin version must track Vitest's line.** If Vitest stays on 3.x, `@vitest/coverage-v8` stays on 3.x too.
11. **User config examples must use TOML.** The runtime source of truth is `~/.config/lazyhub/lazyhub.toml`; do not document `settings.json` or root-level JSON config snippets as current behavior.
12. **Default shell assumptions matter in docs/tests.** On default config, the app starts on `focus` and the active panes are `focus`, `prs`, `issues`, `branches`, `actions`, `notifications` unless a spec explicitly overrides them.

## Spec discipline for fresh sessions

Every issue body is a spec. If you are an AI agent (Claude, Gemini, Codex, Cursor, or otherwise) picking up an issue cold, treat these as **hard rules** alongside the issue's own acceptance criteria. They prevent the most common literal-executor failure modes that bit us in PR #162 (duplicate JSDoc blocks because the spec didn't say "don't duplicate").

### 1. Don't duplicate

If the file, section, JSDoc block, function, config key, route, or any other named thing **already exists in some form**, modify it in place. Do not add a parallel/duplicate copy.

- Adding a JSDoc header? Check if one already exists at the top of the file. If yes, edit its first line; don't add a second block.
- Adding a config key? Check the existing TOML schema. If a similar key exists, extend it; don't shadow it.
- Adding a CLI flag? Check the existing flag parser; don't register the same flag twice.
- Adding a test file? Check the existing test file alongside the source; extend it; don't create `foo.test2.js`.

When in doubt: read the current state, then decide. Never add without checking.

### 2. Verify the current state before assuming

Before modifying any file, read it. Don't assume "the spec says it has X" — confirm. Codebases drift. If the spec and the code disagree, the **code is the ground truth**; flag the spec discrepancy back in the issue thread.

### 3. Idempotency check

Whatever you ship, ask: "if a second person ran this same spec from scratch on the result of my work, would they produce zero diff?" If yes, you're idempotent. If no, you've made the spec unrepeatable — fix that before claiming done.

### 4. Explicit negative constraints win

If the issue body says "do X," also obey the implicit "don't do Y" rules for the file you're touching: don't reformat unrelated code, don't bump versions, don't rename adjacent symbols, don't add features the spec didn't ask for. Stay in scope.

### 5. Ask, don't guess

If the issue body is ambiguous on an "if X already exists" branch, or any other case that materially affects the result, **comment on the issue thread asking for clarification**. Do not pick the path that looks easier and hope. A guess that wastes 100 lines is more expensive than a question that delays an hour.

### 6. No optimistic claims

If a build or test or script doesn't run cleanly to completion, the work is not done. Don't write "✅ shipped" in the PR description if the verification step output a warning you didn't read. Don't claim a fix without re-running the failing reproduction.

### 7. No mock-implementations

If the spec says "implement X," ship the real thing or open a follow-up issue explaining what's missing. Do not ship a function that returns a hardcoded value, a UI that renders placeholder text, or a config layer that doesn't actually read the config — and then claim the issue is done.

### 8. Spec-first for UI (added 2026-06-10)

No UI change without a concrete visual spec or golden snapshot it implements.
If asked to "improve the design" with no spec, propose 2–3 variants for the
maintainer to choose from — do not freestyle visual design in code.

### 9. Repro-first for bugs (added 2026-06-10)

No bug-fix PR without a failing test written FIRST that reproduces the bug. If you
cannot reproduce it, the deliverable is the minimal repro question back on the
issue thread — not a speculative fix.

### 10. Verified-by-running (added 2026-06-10)

Every PR touching `src/features/` or `src/components/` states in its body the exact
manual steps run against the built binary (`npm run build && node dist/lazyhub.js`),
or the flow/PTY test that covers the change.

### 11. Sibling-surface sweep (added 2026-06-10)

A bug fixed in one pane (PRs / Issues / Branches / Actions / Notifications) must be
checked for and fixed in all sibling panes in the same PR. History shows defects
here always come in sibling sets.

## Issue spec template (mandatory for all new issues)

Every issue is a complete, self-contained prompt for a cold LLM session.
Required sections, in order:

```markdown
> **Spec for a cold session.** Read docs/ARCHITECT_DECISIONS.md first. This body +
> that doc = full context. Verify current code state before assuming; if code and
> spec disagree, code wins — flag the discrepancy in an issue comment.

## Goal            — one sentence
## Why             — 2–4 lines of context
## Preconditions   — verifiable checks (commands), not bare issue references
## Files to touch  — explicit list
## Files NOT to touch
## Acceptance criteria — testable bullets; machine-checkable (command + expected output) wherever possible
## Test plan       — exact commands/flows that prove it works, incl. the gate:
                     npm run lint && npm test && npm run build
## Constraints     — patterns to follow, things to avoid
```

Independence rule: issues must be executable in any order unless a precondition
says otherwise. Express dependencies as *verifiable preconditions*
("`grep -q runGh src/executor.js` must succeed") so a session can self-check
instead of needing conversation history.

## Doc map

| Doc | Purpose | Read when |
|---|---|---|
| `ARCHITECT_DECISIONS.md` (this file) | Locked cross-cutting decisions | Every fresh session |
| `ARCHITECTURE.md` | High-level codebase architecture | Onboarding to the codebase; before any cross-cutting refactor |
| `CONTRACT.md` | Current machine-facing CLI and MCP contract | Changing JSON, MCP, or agent-facing behavior |
| `COMPATIBILITY.md` | Stability promises and deprecation policy | Renaming/removing commands, config keys, or schemas |
| `GLOSSARY.md` | Authoritative definitions for every domain term | Whenever an unfamiliar term appears |
| `FILE_MAP.md` | Concept → owning files crosswalk | Before greping; answers "where is X?" |
| `DESIGN_REVAMP.md` | Visual design system, theme tokens, screen layouts | Any UI / theme issue |
| `CI_SIMPLIFICATION.md` | Phase D CI design | Touching `.github/workflows/` |
| `MANUAL_TEST_PLAN.md` | Pre-release smoke test steps | Before tagging a release |
| `POLISH.md` | UX polish backlog | Phase H, Phase C step 8 |

**Reading order for a cold session:** this file → `GLOSSARY.md` (skim) → `FILE_MAP.md` (skim) → the issue body → any doc the issue cites.

## Roles (orchestration rules)

- **Opus** — Sr. Architect. Writes specs, decisions, this doc, issue bodies.
  Never writes implementation code.
- **Sonnet** — Sr. Engineer. Complex logic, pipelines, hard bugs, reviews all
  Haiku output.
- **Haiku** — Junior. Boilerplate, CRUD, well-scoped components. Sonnet writes
  the spec, Haiku executes, Sonnet reviews.

Every Haiku output is reviewed by Sonnet before being considered done.
