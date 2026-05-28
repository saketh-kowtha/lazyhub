# Architect Decisions — Locked for V1

> Single source of truth for cross-cutting decisions that affect multiple issues.
> If an issue body conflicts with this doc, **this doc wins** unless the issue body
> explicitly says "overrides ARCHITECT_DECISIONS §X".
>
> **Fresh session checklist:** read this file, then the issue body, then any other
> doc the issue body links to. That triad is your full context.

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

## Decision 3 — Daemon spawn behavior

**Auto-spawn on first `lazyhub` call. Opt-out via `LAZYHUB_NO_DAEMON=1`.**

- **Why:** best DX for humans (zero config) and agents (deterministic — agent
  calls `lazyhub --json prs.list`, gets a fast warm response). Idempotent —
  if daemon already running, attach over IPC socket.
- **Lifecycle:** daemon writes PID to `~/.config/lazyhub/daemon.pid`, listens on
  unix socket at `~/.config/lazyhub/daemon.sock`. On crash, stale socket is
  cleaned on next attach attempt.
- **Tracked in:** Phase K #145.

## Decision 4 — MCP server registration

**Manual via `lazyhub mcp install`. Never auto-edit `~/.claude/config`.**

- **Why:** editing the user's MCP client config without explicit consent is
  invasive. The command prints the exact JSON snippet to add, or — with
  `--write` flag — appends it after asking.
- **Tracked in:** Phase K #145.

## Decision 5 — Daemon idle timeout

**30 minutes default. Configurable via `[daemon.idle_timeout_minutes]` in TOML.**

- **Why:** balances warm-cache benefit against background resource use. Agents
  on long jobs can override; idle humans don't pay forever.
- **Tracked in:** Phase E1 #130, Phase K #145.

## Decision 6 — Audit log location

**`~/.config/lazyhub/audit.log` (XDG-compliant). Configurable via `[audit.path]`.**

- **Format:** NDJSON, one line per state-changing operation.
- **Rotation:** size-based, 10 MB cap, keep last 3 files. Owned by Phase K #145.
- **Tracked in:** Phase L3 #148, Phase K #145.

## Decision 7 — Permission scope set (Phase L3 #148)

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
- **Default:** `full` (matches today's behavior).
- **Tracked in:** Phase L3 #148, Phase E1 #130.

---

## Other locked-in invariants (do not violate)

These are not decisions in flight — they are project rules. Listing here so fresh
sessions don't need conversation history to know them.

1. **`gh` is the only GitHub interface.** All GitHub calls go through
   `src/executor.js`. No `octokit`, no raw HTTP, no other CLI.
2. **`src/ai/providers/anthropic-api.js` is the only file that makes Anthropic HTTP calls.**
3. **Subprocess discipline:** `execFile` only. Never `exec` / shell-interpolate.
   Prompts via stdin, never argv.
4. **Curated env for AI subprocesses:** PATH / HOME / USER only. Never leak
   `ANTHROPIC_API_KEY` or `GH_TOKEN` to non-Anthropic CLIs.
5. **Every AI call goes through `logAiUsage()`** for cost tracking and audit.
6. **No telemetry, ever.** No analytics, no crash reporting, no phone-home.
   This is a hard line; do not propose adding it.
7. **React pinned to ^18.** Ink 4 is incompatible with React 19. Do not bump.
8. **ESLint pinned to ^8.** ESLint 9+ requires flat config migration; out of V1 scope.
9. **vitest pinned to ^3.** vitest 4 breaks via rolldown's npm optional-deps bug.

## Doc map

| Doc | Purpose | Read when |
|---|---|---|
| `ARCHITECT_DECISIONS.md` (this file) | Locked cross-cutting decisions | Every fresh session |
| `ARCHITECTURE.md` | High-level codebase architecture | Onboarding to the codebase; before any cross-cutting refactor |
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
