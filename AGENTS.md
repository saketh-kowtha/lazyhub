# AGENTS.md — Entry Point for Any AI Session

> **This file overrides default behavior.** Read it in full before touching any
> file — human or AI, interactive or scheduled. It is the prompt router: it tells
> you which protocol to follow for a given roadmap item / issue, lists the
> self-review checklist that catches this project's recurring bug classes, and
> restates the hard invariants that must never be violated.
>
> This file does not replace the other docs — it dispatches to them. Full detail
> for any topic below lives in the doc named next to it.

## Reading order (do this every session, scheduled or interactive)

1. **This file (`AGENTS.md`).**
2. **`docs/ARCHITECT_DECISIONS.md`** — locked cross-cutting decisions. If an issue
   body conflicts with it, that doc wins unless the issue explicitly says
   "overrides ARCHITECT_DECISIONS §X".
3. **`docs/THREAT_MODEL.md`** — required for gateway, agent, policy, approval,
   audit, MCP, credential, IPC, or release work.
4. **`docs/FILE_MAP.md`** — concept → owning file crosswalk. Consult before
   grepping blind.
5. **The issue / roadmap item body itself** — the complete spec for the picked
   item.
6. **Any doc the issue body cites** (Doc map at the bottom of this file).

---

## Prompt router — classify the picked item

Most roadmap items are **feature work (Protocol C)**. Before starting, check the
item's title/body/labels for signal that it's actually one of the other three,
and follow that protocol instead:

| Signal in title/body/labels | Protocol |
|---|---|
| "bug", "crash", "regression", "broken", "doesn't work", references a symptom without new capability | **A — Bug fix** |
| "design", "mockup", "visual", "theme", "polish", "UI", "layout", "screen redesign" | **B — UI / Design** |
| "latency", "perf", "cache", "N+1", "daemon", "warm path", "instrumentation" | **D — Performance** |
| everything else (new capability, new command, new config surface) | **C — Feature** (default) |

If an item genuinely straddles two protocols (e.g. a performance fix that also
touches UI), follow the stricter of the two and say so in the PR body.

---

## Protocol A — Bug fix

1. **Repro-first** (`ARCHITECT_DECISIONS.md` §9 rule 9). Write a failing test that
   reproduces the exact symptom *before* touching implementation code. If you
   cannot reproduce it, the deliverable is a precise repro question, not a
   speculative fix — stop and report (see "Ask, don't guess" below).
2. **Root-cause it.** Find the exact line/pattern responsible. Patch the cause,
   not the symptom.
3. **Fix minimally.** Touch only files required to fix this bug.
4. **Sibling-surface sweep** (§11 rule 11). This class of bug (missing handler,
   missing import, missing sanitize call, etc.) historically recurs across the
   PRs / Issues / Branches / Actions / Notifications panes. Check all five for
   the same defect and fix every instance in this PR.
5. Run the **known bug classes checklist** below before opening the PR.
6. Append a new `B-NN` entry to **`docs/ARCHITECTURE.md` §21** in the existing
   format (Symptom / Root cause / Fix), continuing the numbering.
7. Gate (see below), then PR.

## Protocol B — UI / Design

1. **Mockup-first** (§8 rule 8). No UI change ships without a committed ASCII
   mockup in `docs/mockups/` that it implements. If none exists for this screen,
   produce 2–3 variants. In an interactive session, let the maintainer pick; in
   an unattended/scheduled run, pick the variant that best satisfies
   `docs/DESIGN_REVAMP.md` and `docs/DESIGN_REFERENCES.md`, commit it, and record
   the rationale in the PR body.
2. Read `docs/DESIGN_REVAMP.md` (token system, layout contract) and
   `docs/DESIGN_REFERENCES.md` (consistency rules) before writing JSX.
3. Consume color/spacing exclusively via `useTheme()` tokens — never hardcode a
   literal (Hard Invariants below).
4. Implement against the chosen mockup.
5. Verify by running the built binary against the real flow:
   `npm run build && node dist/lazyhub.js`.
6. Gate, then PR — state which mockup variant was implemented and why.

## Protocol C — Feature (default)

1. Read the full issue/roadmap text and `docs/ARCHITECT_DECISIONS.md` before
   writing code — that pair is meant to be the complete spec for a cold session.
2. **Verify current state before assuming.** Don't trust "the spec says X" —
   read the file. If spec and code disagree, code is ground truth; flag the
   discrepancy in the PR body.
3. Implement, touching only the files the item needs. No drive-by refactors,
   reformatting, version bumps, or renames of adjacent symbols.
4. Respect every chokepoint in Hard Invariants (executor, AI, subprocess).
5. **No mock implementations.** Ship the real thing, with tests, or open a
   follow-up issue explaining what's deliberately deferred — don't claim done
   with a hardcoded return value or placeholder UI text.
6. **Verified-by-running** (§10 rule 10): state the exact manual steps run
   against `node dist/lazyhub.js`, or name the flow/PTY test that covers the
   change.
7. **Don't duplicate** (§1 rule 1): if the file/function/config key/route already
   exists in some form, modify it in place.
8. Gate, then PR.

## Protocol D — Performance

1. **Baseline first.** Capture current numbers before changing anything — use
   `LAZYHUB_PERF=1` + `lazyhub perf report` for keypress/`runGh()` latency, or an
   explicit before/after script for paths that instrumentation doesn't cover yet
   (e.g. subprocess call counts, GraphQL round-trips).
2. Make the change.
3. Re-measure the same metric the same way. The PR body must show real
   before/after numbers, not a description of expected improvement.
4. Confirm no invariant was bypassed for speed (e.g. calling `gh` directly
   instead of through `runGh()` "just this once"). Don't.
5. Gate, then PR.

---

## Known bug classes — self-review checklist (run before every PR)

Every item below is a bug class that has actually shipped in this repo (full
log: `docs/ARCHITECTURE.md` §21). Check each one that's relevant to your diff:

- [ ] Every component using theme tokens has `const { t } = useTheme()` (or
  `const { scheme } = useTheme()`) actually imported and in scope — not just
  referenced.
- [ ] No placeholder functions/comments (`// ... implement X`) left where a real
  implementation was promised.
- [ ] GraphQL variables: integers passed with `-F`, strings with `-f`.
- [ ] `FuzzySearch` / `MultiSelect` / `OptionPicker` always receive objects with
  the fields named in `searchFields` — never bare strings.
- [ ] Every key advertised in the Help overlay / footer hints has a real handler
  wired in the corresponding component, and vice versa (no orphaned handlers).
- [ ] Every string sourced from the GitHub API (title, body, subject, names) is
  wrapped in `sanitize()` before rendering or interpolating into dialog text.
- [ ] Mutating dialogs (assignees/labels/reviewers) diff current vs. desired
  state and call both add *and* remove endpoints — not add-only.
- [ ] No `execa`/`execFile` calls outside `src/executor/core.js`'s `runGh()` —
  confirm no dialog/component reached around the executor.
- [ ] `gg`/`G` handlers guard against empty lists (`items.length > 0` before
  `length - 1`) and clean up any `setTimeout` ref in a `useEffect` unmount.
- [ ] `useMemo`/`useCallback` dependency arrays list every value read inside,
  especially `t`/theme.
- [ ] Env-conditioned behavior (`GH_HOST`, `NO_COLOR`, `LAZYHUB_*`) is honored at
  every call site for that surface, not just the first one you touched.
- [ ] Bulk operations over N items use a single bulk API call where GitHub
  offers one, instead of N concurrent calls (secondary rate-limit risk).
- [ ] Any new `gh api` list call sets explicit pagination (`per_page`) — don't
  rely on GitHub's default page size.
- [ ] Destructive/irreversible actions (merge, delete branch, admin bypass) have
  an explicit confirm step whose copy states exactly what happens (e.g. "remote
  branch" vs. local).
- [ ] Any new docs/UI text describes config as TOML — the runtime source of
  truth is `~/.config/lazyhub/lazyhub.toml`; never document JSON config as
  current behavior.

---

## Hard invariants (non-negotiable, do not violate for any issue)

1. **Repository operations use the typed executor.** Every ordinary GitHub call
   routes through `runGh()` in `src/executor/core.js`; public imports go through
   the `src/executor.js` barrel. The only raw-HTTPS exception is the minimal
   credential helper, limited to allowlisted GitHub App authentication, token,
   and check endpoints. It must use an explicitly configured proxy and must
   ignore inherited proxy environment variables. No Octokit or generic HTTP
   GitHub client is allowed.
2. **`src/ai/providers/anthropic-api.js` is the only file that makes Anthropic
   HTTP calls.** Every AI call, any provider, goes through `src/ai/index.js`.
3. **Subprocess discipline:** `execa`/`execFile` only, args always as arrays.
   Never shell strings or shell interpolation. Prompts go via stdin, never argv.
4. **Curated env for AI/gh subprocesses:** PATH/HOME/USER only. Never leak
   `ANTHROPIC_API_KEY` or `GH_TOKEN` to unrelated CLIs.
5. **Every AI call goes through `logAiUsage()`** for cost tracking and audit.
6. **No telemetry, ever.** No analytics, no crash reporting, no phone-home. This
   is a hard line — do not propose adding it, even to fix an issue.
7. **`useTheme()` hook, never `import { t }`** static constant, in components.
8. **FuzzySearch always gets objects, never strings.**
9. **GraphQL integer variables use `-F`; string variables use `-f`.**
10. **`notifyDialog(true/false)`** called by any component that opens/closes a
    dialog.
11. **`ErrorBoundary` wraps every view branch** in `app.jsx`.
12. **`sanitize()`** every string sourced from the GitHub API before rendering.
13. **Pinned versions — do not bump without an issue explicitly authorizing it:**
    React `^18` (Ink 4 is incompatible with React 19), ESLint `^8` (9+ needs flat
    config migration, out of scope), Vitest `^3` (`@vitest/coverage-v8` must
    track the same major/minor line — bumping breaks the coverage floors).
14. **Config is TOML only** (`~/.config/lazyhub/lazyhub.toml`). Never document or
    introduce JSON config as current behavior.
15. **Default shell assumption:** app starts on `focus`; active panes are
    `focus, prs, issues, branches, actions, notifications` unless a spec
    explicitly overrides them.
16. **Default agent capability is read-only.** Unknown clients and fresh config
    never receive write, approval, review, merge, or comment authority.
17. **No ungoverned write fallback.** Gateway, policy, request-store, audit, or
    identity failure blocks writes. Never fall back to direct `gh` for a write.
18. **Gateway threat accounting.** Every PR touching gateway, agent, policy,
    approval, audit, MCP, credential, IPC, or release code names the applicable
    T-items from `docs/THREAT_MODEL.md`, the mitigation, and residual risk.

---

## Scope discipline (full text: `docs/ARCHITECT_DECISIONS.md` "Spec discipline for fresh sessions")

Condensed — see that doc for full rationale and examples:

1. Don't duplicate — if it exists in some form, edit it in place.
2. Verify current state before assuming — code is ground truth over spec.
3. Idempotency — a second run of the same spec on your result should be a no-op.
4. Explicit negative constraints win — "do X" also implies "don't do Y" for
   anything the spec didn't ask for. Stay in scope.
5. Ask, don't guess (see below).
6. No optimistic claims — a warning you didn't read means it isn't done.
7. No mock implementations.
8. Mockup-first for UI.
9. Repro-first for bugs.
10. Verified-by-running.
11. Sibling-surface sweep.

## Ask, don't guess — the "ask one crisp question" clause

If you hit a genuine ambiguity mid-implementation — spec and code disagree in a
way that changes the approach, a precondition doesn't hold, or an "if X already
exists" branch isn't covered by the spec — stop. Do not pick the path that looks
easier and hope.

- **Interactive session:** ask the user one crisp question.
- **Unattended/scheduled run:** do not open a PR. Produce a report that states
  exactly what's blocking and stop, so the next run or the user can resolve it.

A guess that wastes 100 lines is more expensive than a question that delays an
hour.

---

## The gate

From the repo root, all three must pass clean before any PR:

```
npm run lint && npm test && npm run build
```

If something fails, fix it and rerun — never report success without a clean gate
run you actually saw pass. `npm run typecheck` (tsc --noEmit) is not yet part of
the required gate (tracked by #197) but is cheap to run and worth checking.

## Docs to update alongside the change

- **Bug fix (Protocol A):** append the `B-NN` entry to `docs/ARCHITECTURE.md`
  §21 in the same PR.
- **Any item:** if `docs/ROADMAP.md` is now stale (item done, blocker resolved,
  reordered), update it in the same PR. ROADMAP drifts faster than
  ARCHITECT_DECISIONS — keep it honest.
- **File added/removed/renamed:** run `npm run docs:refresh` to regenerate
  `docs/FILE_MAP.md`.

---

## Doc map

| Doc | Purpose | Read when |
|---|---|---|
| `AGENTS.md` (this file) | Canonical prompt router, protocols, checklist, invariants | Every session, first |
| `CLAUDE.md` | Compatibility pointer to this file | Claude sessions only |
| `docs/ARCHITECT_DECISIONS.md` | Locked cross-cutting decisions + spec discipline rules | Every session |
| `docs/THREAT_MODEL.md` | Security claims, T1-T21, check-integrity boundary | Security-sensitive work |
| `docs/ARCHITECTURE.md` | Codebase architecture, CI/branch strategy, invariants, full bug-fix log (§21) | Onboarding; any cross-cutting change; after any bug fix |
| `docs/FILE_MAP.md` | Concept → owning file crosswalk | Before grepping; "where is X?" |
| `docs/GLOSSARY.md` | Authoritative term definitions | Whenever an unfamiliar term appears |
| `docs/ROADMAP.md` | Execution order / what to pick next | Picking the next item |
| `docs/DRAFT_PLAN.md` | Full strategy doc ROADMAP is synced from | Understanding *why* the roadmap is ordered this way |
| `docs/DESIGN_REVAMP.md` | Visual design system, theme tokens, screen layouts | Any UI / theme issue (Protocol B) |
| `docs/DESIGN_REFERENCES.md` | Per-screen mockup variants + consistency rules | Any UI / theme issue (Protocol B) |
| `docs/CI_SIMPLIFICATION.md` | CI/CD design | Touching `.github/workflows/` |
| `docs/TEST_PLAN.md` | Test strategy, current coverage state | Writing/extending tests |
| `docs/MANUAL_TEST_PLAN.md` | Pre-release smoke test steps | Before tagging a release |
| `docs/POLISH.md` | UX polish backlog + product vision | Phase 3/wedge-feature work |
| `docs/AI_PROVIDERS_SPEC.md` | Pluggable AI backend spec | Touching `src/ai/` |
| `docs/CONFIG_REFERENCE.md` | Generated TOML config reference | Touching config schema/docs |
| `docs/NVIM_INTEGRATION_SPEC.md` | Editor integration spec (IPC) | Touching `src/ipc.js` / `integrations/nvim/` |
| `docs/homebrew.md` | Homebrew tap details | Touching release/distribution |
| `docs/mockups/` | Committed ASCII mockups | Any UI change (Protocol B step 1) |

## Roles (when orchestrating with subagents)

- **Opus** — architect: specs, decisions, judgment calls (root-cause diagnosis,
  design tradeoffs, scope calls). Does not write implementation code.
- **Sonnet** — engineer: implementation, refactors, tests, complex logic.
  Reviews any Haiku/junior output.
- **Haiku** — junior: boilerplate, CRUD, well-scoped components under Sonnet's
  spec and review.
