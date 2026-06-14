# Roadmap — execution order

> Which issue do I pick next? This file answers that. Read top-to-bottom.
> Synced with `DRAFT_PLAN.md` (the full strategy doc) on **2026-06-10**.
>
> **Operating rule that overrides all tiering:** Stabilize → Speed up → Beautify →
> Differentiate → Launch. No feature work while its phase's exit criteria are unmet.
> Issues carry **GitHub milestones** matching the phases below — `gh issue list
> --milestone "Phase N — ..."` is the authoritative "what's next" query.
>
> Every issue is a self-contained spec (template: ARCHITECT_DECISIONS.md → "Issue
> spec template"). Dependencies are stated as verifiable preconditions inside each
> issue body — check them there, not here.

## TL;DR — what to start now

**#186 (npm audit)** — it's a required CI check; everything is blocked behind it.
Then the rest of Phase 0, then Phase 1.

---

## Shipped (do not pick up — kept for drift control)

#130 TOML loader · #131 TOML writer/migration · #139 runGh() refactor ·
#138 coverage gate · #168 openai-compatible provider · #45 auto-merge footer ·
#137 ZWJ flake · #124 command palette · #123 popover primitive

## Parked (closed, reopen at ~5k MAU / demonstrated demand)

#157/#158 team server · #159 marketplace · #136 JetBrains · #61 Raycast · #169 NLS-B

---

## Phase 0 — Unbreak (exit: CI green on main, lint catches undefined identifiers, docs match reality)

| # | Title |
|---|---|
| **#186** | npm audit failures (REQUIRED CHECK — first) |
| **#188** | missing useKeyScope imports + enable ESLint `no-undef` (see scope-correction comment) |
| **#187** | knip cleanup |
| **#185** | settings theme/provider regressions |
| **#197** | tsc --checkJs static checking in CI |

## Phase 1 — Bug-Zero (exit: two consecutive 15-min dogfood sessions, zero new bugs; every advertised key works)

| # | Title |
|---|---|
| **#132** | keymap registry through TOML — kills the key-desync bug class (launch blocker) |
| **#193** | PTY E2E harness (real binary, stubbed gh, tmux included) |
| **#194** | crash handler — always restore the terminal |
| **#195** | --debug-state dump + bug-report template |
| **#180** | degraded-state / gh-failure status indicator |
| **#196** | god-file split (mechanical, parallel-friendly) |

Plus: daily dogfood sessions file bugs; every fix follows repro-first
(ARCHITECT_DECISIONS §9).

## Phase 2 — Performance (exit: keystroke <33ms, warm pane switch <100ms perceived, "faster than the browser" verdict)

| # | Title |
|---|---|
| **#198** | LAZYHUB_PERF instrumentation + baseline report (do first in this phase) |
| **#199** | stale-while-revalidate disk cache — spinner-free warm paths |
| **#200** | one GraphQL call for PR list + N+1 audit |
| **#145** | daemon, K-lite slice only: cache + background refresh (see re-scope comment; Windows transport decision first) |

## Phase 3 — Design (exit: every screen matches a committed snapshot/spec the maintainer picked)

| # | Title |
|---|---|
| **#201** | DESIGN_REFERENCES.md + per-screen design variants (docs only — human picks; do first) |
| **#202** | golden render snapshots per screen |
| **#127** | diff view redesign (implements its chosen direction) |
| **#129** | polish: hint bars, error formatter, loading states, NO_COLOR, high-contrast |
| **#128** | embedded mode + drafts persistence |
| **#126** | onboarding tour |

## Phase 4 — Wedge + Contract (the differentiation; mostly parallel)

**Wedge features (priority order):**

| # | Title |
|---|---|
| **#175** | Tripwires — hero feature (see expanded-scope comment) |
| **#178** | multi-state filter for PRs/Issues |
| **#203** | Triage Flow — inbox-zero review mode |
| **#177** | review-queue sections (Needs My Review / Mine / Involved) |
| **#179** | global cross-status PR search |
| **#174** | EPIC: Agent PR Cockpit (assembles #175/#177/#178/#203) |
| **#204** | Agent Scoreboard |
| **#205** | cross-model second opinion |
| **#206** | ambient mode (tmux/starship status) — precondition: #199 |
| **#176** | dispatch issue/PR to a coding agent (can trail launch) |

**Contract (the timeless core — outranks cockpit breadth per DRAFT_PLAN Part 5):**

| # | Title |
|---|---|
| **#208** | CONTRACT.md + COMPATIBILITY.md covenant |
| **#146** | stable error code catalog |
| **#150** | schema_version in JSON/MCP output (pulled forward from V2) |
| **#147** | idempotency on state-changing ops |
| **#148** | permission scopes |
| **#149** | --dry-run on destructive ops |
| **#152** | rate-limit awareness in JSON output (pulled forward from V2) |

**Config completion + standalone features:**

| # | Title |
|---|---|
| **#66** | custom tabs · **#133** doctor --config · **#70** setup wizard (unblocked) |
| **#62** | CLI deep links · **#68** AI Q&A tab · **#65** PR template auto-fill · **#69** share AI review · **#71** age colors · **#73** interactive CI checks (verify against F-12 first — see comment) |

## Phase 5 — Launch (exit: shipped, announced, soaked)

| # | Title |
|---|---|
| **#140** | top-5 flow integration tests (launch blocker) |
| **#141** | pre-publish live smoke test (launch blocker) |
| **#207** | staged npm releases (next → soak → latest) |
| **#134** | polish bundle: VHS demo GIF, wedge-led README, comparison table, FUNDING (see scope-additions comment) |
| **#209** | distribution: scoop / winget / nix / mise |
| **#135** | VSCode extension (fast-follow; not a launch blocker) |

Launch week: coordinated HN / r/commandline / lobste.rs / newsletters push —
AFTER Phase 1 exit criteria still hold on the release candidate.

---

## V2+ (defer until launch feedback exists)

Agent contract depth (#151 L6 NDJSON, #153 L8 cost surface, #154 L9 agent-test,
#155 L10 sandboxing, #156 L11 concurrency) · test depth (#142 J3-full, #143 J4
gh contract matrix, #144 J6 AI contract tests) · #72 team view · #63 watch mode ·
#64 desktop notifications · #67 auto-refresh · #170 LiteLLM (gated).

---

## How to use this with fresh sessions

1. `gh issue list --milestone "Phase N — ..."` for the current phase (lowest
   incomplete phase wins).
2. Read the issue body — it is the complete spec. Check its **Preconditions**
   section (verifiable commands) instead of trusting this file's ordering blindly.
3. Read `docs/ARCHITECT_DECISIONS.md` (always) + any doc the issue cites.
4. If this file disagrees with reality (issue closed, blocker merged), update
   this file in the same PR. ROADMAP drifts faster than ARCHITECT_DECISIONS —
   keep it honest.
