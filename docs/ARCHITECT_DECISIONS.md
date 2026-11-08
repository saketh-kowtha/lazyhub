# Architecture Decisions

> Single source of truth for cross-cutting decisions that affect multiple issues.
> If an issue body conflicts with this doc, **this doc wins** unless the issue body
> explicitly says "overrides ARCHITECT_DECISIONS §X".
>
> **Fresh session checklist:** read this file, then the issue body, then any other
> doc the issue body links to. That triad is your full context.

## Agent Gateway decisions (2026-09-28)

These decisions supersede older issue comments and Decisions 3-7 wherever they
conflict. D1-D11 are security and enforcement contracts and are unchanged by the
2026-10-21 review-first amendment (see D12).

> **Superseded narrative (2026-10-21).** The earlier framing of this section,
> "Alpha is watch-only observation (Slice 1) plus approval recording (Slice 2)",
> and the gateway-first product story are superseded as *product narrative*.
> The delivery stages are now review Alpha, optional approval, and demand-gated
> expansion (D12, `docs/ROADMAP.md`). The unchanged parts: Lazyhub never
> executes merges, and Slice 2 content is the optional approval stage.

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

### D12 — Product focus (amended 2026-10-21, #293)

**Purpose.** Lazyhub helps maintainers understand changes, make informed
decisions, and stay accountable for what ships as coding agents produce more
work. **First audience:** terminal-oriented solo maintainers who regularly review
agent-produced PRs. **Core journey:** open, see work needing attention, inspect
changes and evidence, understand the next action, return with context preserved.
General GitHub management supports this job; it is not the headline.

**Scope amendment.** The narrow, read-only review journey (queue with explainable
attention reasons, evidence and diff, return-to-queue continuity: #177, #175,
#127, on the existing surfaces) is in scope. The freeze is otherwise unchanged:
no broad dashboards, no editor integrations, no broad TUI expansion, no packaging
beyond npm and Homebrew, no plugin marketplace, no generic coding-agent runtime,
no visual reskin, until pilot evidence exists. Superseded wording: the prior D12
text "prioritize watch-only observation, approval integrity..." as the product
focus, and any gateway-first narrative elsewhere.

**Stages.** Review Alpha (`stage:review-alpha`) uses the existing `gh` login with
no App, agent/MCP setup, or AI provider, and its core journey is read-only.
Optional approval (`stage:approval`) is separate and is never a dependency of
review Alpha; it must keep D1-D11 intact and requires #277 feasibility, #278
contracts, #245/#235/#244/#203, and #141 proof, and never executes merges.
Demand-gated work (`stage:demand-gated`: #294, #297, #145) activates only from
pilot evidence. Review Alpha success is not evidence for approval.

**Write boundary.** Model-proposed GitHub writes are disabled for review Alpha,
including writes a human confirms. Human-initiated management actions (typed by
the user, not proposed by a model) are preserved as legacy supporting
functionality and are kept outside the read-only review context. Agent
classification, unknown attribution, and review progress grant no authority.
This amendment changes no permission default and no enforcement guarantee.

**Distinct concepts.** Review progress, GitHub review, local decision, and Lazyhub
authorization are different things (GLOSSARY "Review concepts"); none implies
another.

**Prioritization.** Pick by active stage first, priority second
(`stage:review-alpha`, then `stage:approval`, then `stage:demand-gated`). Stage
order does not defer security defects in shipped or enabled functionality;
triage those by exposure and severity regardless of stage.

**Success signals.** Repeat usefulness, informed decisions, and observed saved
effort outrank stars or acquisition. No traction is claimed until pilots (#286)
produce evidence.

## Structure decisions (2026-10-31, R0 #478)

How the code is organized, and where it is going. Each decision says what **ships
today** and what is **planned**, so a fresh session never builds on a target as if it
were the current code. The sections of `docs/ARCHITECTURE.md` describe the code as it is.

### D13 - Focus manager: one key owner

**Date and status.** Partly shipped. Decision approved 2026-10-31. Focus manager proper planned (R5 #483, R6 #484).

**Decision.** One root `useInput`; an explicit stack of focus entries; only the top
entry receives keys, then registry-resolved globals. `notifyDialog`,
`dialogActiveRef` and per-pane `if (dialog) return` are retired.

**Shipped.** `src/keyscope.js` keeps a scope stack (`global < pane < view < overlay
< dialog < input`); components claim a scope with `useKeyScope` and the root handler
in `app.jsx` defers to anything above `pane`. Every handler is wrapped by
`useSafeInput` (`containHandler`, #490), so a throw becomes a toast. Keys resolve
through the action registry (`[actions.*]` in `defaultConfig.toml`,
`src/config/actions.js`, `useKeymapInput`).

**Planned (#483 R5, #484 R6).** The focus manager proper: synchronous claims, a
single owner per key, and removal of `notifyDialog` / `dialogActiveRef`, which still
exist in `app.jsx` and in every pane that opens a dialog. Until R6 lands,
a component that opens a dialog still calls `notifyDialog(true/false)`.

### D14 - Query layer

**Date and status.** Partly shipped under the name `useGh`. Decision approved 2026-10-31. `useQuery` / `useMutation` planned (R2 #480, R3 #481, R8 #486).

**Decision.** All reads go through `useQuery(key, fetcher)`; all writes through
`useMutation(fn, {invalidates})`. Structured keys, in-flight dedupe, cancellation,
a synchronous cache seed, invalidation by key prefix.

**Shipped (under the name `useGh`).** `src/hooks/useGh.js` is the read hook: a key
built from host, account, function name and arguments; a request generation so only
the latest request writes state; a synchronous seed from a bounded in-memory LRU
(200 entries, 48 MB) or the startup mirror of the disk cache; stale-while-revalidate;
health reporting (`useGhHealth`). `usePendingWrite` guards a write against a double
submit. Writes invalidate a repository's cached reads coarsely (`invalidateRepoCache`).

**Planned (#480 to #482, #486).** `useQuery` / `useMutation` with structured keys and
prefix invalidation, in-flight dedupe and cancellation, list-to-detail seeding, and
the shared list primitives. There is no in-flight dedupe or cancellation today.

### D15 - Services layer

**Date and status.** Mostly shipped (R1 #479). Decision approved 2026-10-31. Lint enforcement of the full layer rule is open.

**Decision.** UI code never spawns processes. Browser, clipboard, editor and git go
through `src/services/`; git writes get the executor's classifier and audit.
Layer rule: `components/features -> hooks -> services -> executor -> gh/git`.

**Shipped.** `src/services/platform.js` (`openUrl` with an http(s) allow-list,
clipboard, editor round-trips, configured pane commands), `src/services/editor.js`
and `src/services/git.js` (every function takes the checkout directory; the clone of
the viewed repo comes from `findLocalCheckout`). Local git runs through `runGit()`
(`src/executor/git.js`): `classifyGit` allowlists reads and writes, a write is audited
before and after and is blocked when the audit log is unavailable. `no-restricted-imports`
bans `execa` and `child_process` in `features/`, `components/` and `ui/`, a test scans
the whole tree (spawn sites exist only in `services/`, `executor/`, `bootstrap.js`,
`daemon/`, `ai/providers/`), and test workers put shims for `open`, `xdg-open`,
`git`, `pbcopy` and `xclip` at the front of PATH that fail the run when invoked.

**Planned.** The rest of the layer rule is convention, not lint: nothing yet stops a
component from importing `executor.js` directly (many do), and hooks do not go through
services. Enforcing `components/features -> hooks -> services -> executor` by lint is
open.

### D16 - Product principle: fast and complete, not a gh wrapper

(Maintainer, 2026-10-31.) lazyhub must feel instant and must never silently hide
data, on repositories with thousands of open PRs, 80K closed PRs, 400-comment
conversations and 100k-line diffs.

1. **Render only what is visible:** every list, diff, log and thread is windowed.
2. **Fetch only what is needed, page by page:** cursor pages that are appended and
   never refetched; slim list rows; details load for the selected item.
3. **Never block on the network for something we can predict:** a skeleton within one
   frame, seeding from cache, prefetch of the likely next view.
4. **Never silently truncate:** a list is complete, paged with "N of M / more", or
   capped by GitHub with a notice and a path to the rest.
5. **Measured, not claimed:** the budgets are a CI gate; a PR that regresses one is
   not merged.

**Shipped.** Cursor paging with a visible "more" for the PR, issue and review-thread
lists (#506 to #508); a chunked, bounded diff load (#509); windowed rows in the
PR conversation, the pickers and the fuzzy finder (`useVirtualList`) and the list panes; stale-while-revalidate seeding (#454, #455); the daemon is never
awaited before the first frame (#491). `src/paging-audit.test.js` pins every
fixed-size `gh` call with the reason it is complete, so a new silent cap fails
`npm test` (#510, part). A PTY flow measures cold start to first frame with a hung helper, and
`npm run test:memory` (`LAZYHUB_SCALE=1`) scrolls a 1,200-PR list and a 1,000-file diff under a memory cap.

**Planned (the rest of #510).** Seeded large-data fixtures (5,000 open PRs, a 3,000-file
diff, 250 checks, 600 notifications), PTY latency budgets against a slow fake `gh`,
exact `getGhCallHistory()` counts per action, and a dedicated `Performance budget`
CI job. Principle 3 (prefetch on cursor rest, detail to diff) is #482 and is not built.
Until then, "measured" is true only for what the existing tests cover.

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

**Current behaviour (recorded 2026-10-31, R0 #478; D9 still governs).** The TUI does
not spawn the helper before it has drawn. `bin/lazyhub.js` renders first, then
`scheduleDaemon()` (`src/daemon/lifecycle.js`) runs about 100 ms later in the background:
it probes the socket and, if nothing answers, spawns `lazyhub serve --json` detached with
a minimal environment (`daemonSpawnEnv`). It never runs for an untrusted agent context (no
TTY on stdin or stdout, or an agent marker in the environment), and `LAZYHUB_NO_DAEMON=1`
or `agent.auto_spawn_daemon = false` turns it off. Until the helper answers, reads go
straight to `gh`; a failed helper read pauses helper use for 30 s and shows "running
without the background helper" in the status bar. So "auto-spawn on first call" above
is superseded twice: by D9 (no privileged auto-spawn from an untrusted context) and by
this lazy, after-first-frame start. Control messages (`stop`, `invalidate`, `revoke`) need
the per-run session token.

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
- **Current floors (`vite.config.js`):** statements `69`, branches `70`, functions `69`, lines `69` overall, plus per-directory floors for `src/cli/**` (85/78/84/85, statements/branches/functions/lines) and `src/daemon/**` (82/78/82/82). They sit under the measured baseline with a CI/platform margin, not at one local run. Raise them intentionally as coverage improves; don't quietly lower them to get a PR green. (The earlier floors of 48/58/45/48 in this section were long out of date.)
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
   go through `runGh()` in `src/executor/core.js` (the single chokepoint); all local
   `git` calls go through `runGit()` in `src/executor/git.js`; UI code reaches the OS
   only through `src/services/` (D15).
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
13. **Fast and complete (D16).** Windowed rendering, page-by-page fetching, and no
    silent truncation: a list is complete, paged with a visible "more", or capped with a
    notice and a path to the rest. A new fixed-size `gh` call must be added to
    `src/paging-audit.test.js` with the reason it is complete.

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

## Optional approval amendment (2026-11-07)

### D17 — Optional approval runs without the gateway service

Full design, contracts and semantics: `docs/design/optional-approval.md`. This is
an explicit, reviewed amendment for `stage:approval` only. **D1-D11 are
unchanged**, and D12's statement that approval never executes merges stands.

For `stage:approval`, approval decisions are made only by a human in the
interactive TUI, recorded in a local append-only hash-linked journal, and
reflected only through the App-pinned `lazyhub/approval` check. No agent submits
approval requests in this stage, so the dependencies narrow as follows:

| Issue | Status for this stage |
|---|---|
| #145 `lazyhub serve` | not a prerequisite; the daemon, MCP and IPC expose no approval operation |
| #148 policy engine | replaced by the fixed constant `lazyhub-approval-policy/1` |
| #236 agent identity | not a prerequisite; origin is unverified metadata, approver identity is the `gh` account |
| #237 audit | the minimum (append-only, hash-linked, private modes, fail closed) is owned by #235; 90-day retention and a read-only store check are activation prerequisites |
| #238 safe mode | a local subset (block new approvals, keep deny and revoke) is an activation prerequisite of #203 |
| #146 stable errors | approval error codes are stable from the first commit and are absorbed unchanged later |

Expiry and revocation of an already-passing check are Lazyhub-mediated
(`managed_gateway` at best), depend on Lazyhub running and reaching GitHub, and
are never reported as `github_enforced`. Coverage stays `advisory` until the
live proof in #141 passes. Activating agent-submitted approval requests requires
a new decision.

## AI on existing subscriptions (#364)

### D18 — CLI login mode is opt-in, capability-gated and tools-off; chat stays API-only

- The #252 sandbox (throwaway HOME, API key or `CLAUDE_CODE_OAUTH_TOKEN`) stays the
  default. Claude subscriptions use `claude setup-token`; no Claude login mode exists.
- A CLI may use its own login in place (real HOME) only when the user consented under
  `[ai.login]` (default false, revocable), the installed CLI's `--help` proves every
  hardening flag in the provider's capability manifest, and the CLI reports being logged
  in (exit code only). A missing flag means unavailable, never degraded.
- Lazyhub never reads, copies, moves or rewrites a credential file, and never prints or
  logs CLI status output or stderr.
- All AI CLI processes start in `src/services/ai-cli.js` (own process group, 256KB stdout
  cap, 16KB stderr cap used for classification only). `src/ai/providers/` imports no
  `child_process`; the spawn-site scan allows only `src/services` for them.
- The in-TUI assistant needs tool use, so it stays on `anthropic-api` / `openai-compatible`.
- Status: codex login mode shipped; gemini-cli and agy login modes are follow-ups.
