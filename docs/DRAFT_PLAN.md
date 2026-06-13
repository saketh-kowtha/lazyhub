# DRAFT PLAN — lazyhub: from "works on my machine" to top-shelf OSS

> Status: DRAFT for discussion. Not yet merged into ROADMAP.md / ARCHITECT_DECISIONS.md.
> Date: 2026-06-10
>
> This plan reorders everything around four observed realities (maintainer feedback)
> and four explicit goals. It supersedes the "feature-first" reading of ROADMAP.md:
> **quality and speed come before any new feature.**

---

## Part 0 — Where we actually are (honest snapshot)

- ~27k lines of src, 55 open issues, strong docs-as-spec system (best-in-class for AI-driven dev).
- Shipped: TOML config (E1/E2), runGh() chokepoint (J2), coverage gate (J1), openai-compatible provider (E6), command palette, popovers.
- **But:** maintainer reports 1–2 bugs per minute of real use, UI feels basic after many
  design prompts, and perceived performance is worse than github.com in a browser.
- A bug-fix log of 49 entries (B-01…B-49) where the dominant patterns are
  "help overlay advertises a key that has no handler", "handler exists in one pane but
  not its sibling", and "stale state on pane switch" — i.e. **integration bugs that the
  current unit/mocked tests structurally cannot catch.**
- CI is currently red-able on main (npm audit #186), missing-import bug class is
  still live (#188: `ConflictView.jsx`, `NewPRDialog.jsx` call `useKeyScope` with no
  import — works only by esbuild accident), ROADMAP.md lists shipped issues as TODO.

**Conclusion:** the bottleneck is not missing features. It is that the product does not
yet survive 10 minutes of real use. Stars/virality/income are downstream of fixing that.

---

## Part 1 — The four pain points: root causes and the actual fixes

### Pain 1 — "The design is basic, even after multiple prompts"

**Root cause (be honest about it):** "make the UI better" prompts give LLMs no target,
so they regress to the generic Ink layout every model has seen a thousand times.
LLMs are good at *implementing a precise visual spec* and bad at *being the art director*.
DESIGN_REVAMP.md exists but specifies tokens, not screens.

**Fix — change the design workflow, not the model:**

1. **Mockup-first rule.** No UI PR without an ASCII mockup committed first to
   `docs/mockups/<screen>.txt` — exact box-drawing chars, column widths at 80/120/160
   cols, every glyph, every color token annotated. The LLM's job becomes
   "match the mockup byte-for-byte", which it is excellent at.
2. **Steal deliberately.** Build a reference sheet (`docs/DESIGN_REFERENCES.md`) with
   screenshots of the best-looking TUIs: lazygit (layout density), k9s (header/crumbs),
   atac/posting (Charm-style chrome), gh-dash (PR table), superfile (modern borders).
   Every mockup must cite which reference it borrows from. Original design is not a goal;
   *coherent borrowed design* is.
3. **Snapshot the pixels.** Add render-to-string snapshot tests per screen
   (ink-testing-library output committed as `.snap` golden files). Design regressions
   become test failures. This also stops LLMs from "improving" a screen nobody asked about.
4. **One design pass, by a human eye.** Maintainer picks the mockups (10 minutes per
   screen choosing between 2–3 ASCII variants the LLM generates). The human chooses,
   the LLM renders. This is the missing step — taste cannot be delegated.
5. **Quick wins that read as "designed":** consistent 1-cell padding everywhere, one
   border style (rounded) app-wide, a real header bar with repo/context breadcrumb,
   dim-not-hide for inactive panes, and an intentional accent color used in exactly
   3 places. Most "basic-looking" TUIs are inconsistent, not under-featured.

### Pain 2 — "1–2 bugs per minute; LLM code quality is poor"

**Root cause:** three compounding things, none of which is "LLMs write bad code" per se:

1. **No structural source of truth for keys.** Help overlay, footer hints, and handlers
   are written by hand in 3 places; every feature PR can desync them. Half of B-01…B-49
   is this one defect class.
2. **Tests mock the terminal.** The e2e tests drive mocked components; nothing ever runs
   the real binary in a real PTY. Integration bugs ship invisibly.
3. **No human QA loop.** Code merges on green CI without anyone using the app for
   5 minutes. LLMs can't feel jank; only usage finds it.

**Fix — make the dominant bug classes impossible, then gate on real usage:**

1. **#132 keymap registry is the single highest-leverage bug fix in the repo** —
   promote it above everything else. One declarative registry generates: the handler
   wiring, the help overlay, the footer hints, and the TOML keymap schema. The
   "advertised key has no handler" class dies structurally. Acceptance: `git grep
   useInput src/features/` returns zero.
2. **PTY smoke harness.** A `test/pty/` suite using `node-pty`: launch the real
   `dist/lazyhub.js` against a fixture repo (recorded `gh` responses via a stub `gh`
   on PATH), drive 20–30 keystrokes per flow, assert on screen text. 10 flows ×
   ~30s runtime. This is the test layer that matches how the product actually breaks.
3. **Quality freeze: declare a "Bug-Zero Sprint" before any new feature.**
   Protocol: maintainer uses lazyhub for 15 minutes/day on real repos, files every bug
   with exact keystrokes; nothing else merges until the list is empty twice in a row
   (two consecutive 15-minute sessions with zero new bugs).
4. **Definition of Done changes:** every PR touching `src/features/` or `src/components/`
   must include (a) the PTY flow test or snapshot covering the change, and (b) a
   "verified by running" line in the PR body with the exact steps. CI red on missing snap.
5. **Error budget:** crash = P0, wrong data = P0, visual glitch = P1, missing feature = P2.
   The board gets re-labeled accordingly.

### Pain 3 — "Performance is bad; the browser is faster"

**Root cause:** every user action spawns a `gh` subprocess (gh startup is 50–300ms,
plus the API round-trip), nothing is prefetched, and Ink re-renders large trees on
cursor movement. The browser feels faster because github.com is server-rendered behind
a CDN and the SPA prefetches. A TUI cannot win the *data race*; it must win the
*input-latency race* and *hide* the data latency.

**Fix — a perf doctrine, in order of impact:**

1. **Measure first.** `LAZYHUB_PERF=1` env: log keypress→render-flush latency and
   every `runGh` duration to a perf log. One session of instrumentation before any
   optimization. Targets: **keystroke→visual feedback < 33ms** (always, even while
   loading), **pane switch < 100ms perceived** (cached data shown instantly, refresh
   behind), cold start < 800ms.
2. **Stale-while-revalidate everywhere.** Persist the last successful payload per
   (repo, pane) to disk (`~/.cache/lazyhub/`). On open: render cached data in one frame
   with a subtle "refreshing…" glyph, then swap in fresh data. The app should *never*
   show a spinner on a screen it has ever shown before. This single change beats the
   browser feel, because the browser can't render before its network round-trip.
3. **Prefetch on intent.** When the cursor rests on a PR row >150ms, prefetch its detail
   + diff in the background. Enter then feels instant. Same for the next/prev item.
4. **Batch with GraphQL.** PR list currently implies several REST calls per view
   (PRs, then checks, then review state). One `gh api graphql` call can fetch the list
   with checks + review decision in a single round-trip. Audit executor.js for N+1 calls
   (B-28 was exactly this class).
5. **Cut Ink re-render cost:** memoize row components; keep cursor position in a
   narrow context so moving the cursor re-renders 2 rows, not the whole list; verify
   `useVirtualList` is applied on every list pane (it exists — confirm coverage).
6. **The daemon (#145) is a perf feature — scope it that way.** V1-slice the daemon to
   exactly: warm cache + background refresh over a socket. MCP, audit log, idle
   accounting come after. (Also: unix sockets don't exist on Windows — decision needed:
   named pipes or localhost TCP. Flag for Opus.)

### Pain 4 — "LLMs can't fix the bugs I report"

**Root cause:** bug reports reach the model as English ("the filter resets sometimes"),
the model can't reproduce, so it pattern-matches a plausible-looking fix in a 1,000-line
file and misses. Three god files (`executor.js` 1,388 / `app.jsx` 1,021 / `prs/list.jsx`
1,017) make the context worse.

**Fix — repro-first protocol + smaller blast radius:**

1. **Repro-first rule (hard rule, add to ARCHITECT_DECISIONS):** no bug fix PR without
   a failing test written FIRST that reproduces the bug (PTY test, snapshot, or unit).
   If the session can't reproduce it, the session's deliverable is the repro question
   back to the maintainer — not a speculative fix. This converts "LLM guessed wrong"
   into "we now have a permanent regression test."
2. **Bug report template** (`.github/ISSUE_TEMPLATE/bug.yml`): repo used, pane, exact
   keystroke sequence, expected vs actual, terminal + size. 60 seconds for the
   maintainer, removes 80% of LLM guessing.
3. **Split the god files** (mechanical, Haiku-grade with tight spec): `executor.js` →
   `executor/{prs,issues,branches,actions,notifications}.js` re-exported through the
   existing chokepoint; `app.jsx` → extract dialog routing and key routing. Smaller
   files = the model reads the whole relevant context = better fixes.
4. **Right-size the model to the bug.** Per existing orchestration rules: cross-file
   state bugs are Sonnet/Opus work, never Haiku. A wrong fix costs more than the
   model-tier savings.
5. **`lazyhub --debug-state` dump:** one keypress (F12-style) writes current app state
   (pane, filters, cursor, last 20 gh calls + durations + exit codes) to a file the
   user can paste into an issue. Turns "sometimes it's weird" into a diffable artifact.

---

## Part 2 — What else is missing (the gap analysis you asked for)

Things not in any issue today, ordered by impact on the four goals:

1. **A demo GIF.** The #1 statistically-proven driver of TUI stars. Use `vhs` (Charm)
   with a scripted tape: open → triage 3 agent PRs with glyphs → approve → merge,
   in 20 seconds. Belongs at the very top of README. No GIF = no stars, period.
2. **A wedge sentence.** "lazygit for GitHub" positions you against gh-dash and loses.
   "**The terminal cockpit for reviewing AI-agent PRs**" positions you in an empty
   category that is growing 10x/year (your own #174 research). README, repo
   description, and the launch post must all lead with the wedge, with the generic
   GitHub-TUI capability as the supporting act.
3. **A launch plan.** Show HN, r/commandline, r/programming, lobste.rs, Hacker
   Newsletter, Console.dev, Terminal Trove, X/Twitter dev community. One coordinated
   week, after the Bug-Zero sprint — a buggy launch is worse than no launch
   (HN commenters will run it for 60 seconds; today that yields 1–2 bugs).
4. **Distribution breadth:** npm + Homebrew exist. Missing: `winget`, `scoop`,
   `nix`/nixpkgs, `mise`/`asdf` plugin, and a `npx lazyhub` zero-install path that
   actually starts fast. Each registry is a discovery channel, not just convenience.
5. **Windows support decision.** Undecided today (and the daemon socket choice depends
   on it). Even "best-effort via Windows Terminal, tested in CI" widens the funnel
   meaningfully. Decide explicitly; document it.
6. **Community surface:** CONTRIBUTING.md, `good-first-issue` labels (the docs-as-spec
   system is *uniquely* friendly to first-time contributors — advertise that:
   "every issue is a self-contained spec an AI or human can execute"), GitHub
   Discussions, optional Discord later. Stars follow contributors.
7. **Comparison table in README** (lazyhub vs gh-dash vs octo.nvim vs gh CLI) —
   honest, including what they do better. Converts "why another one?" HN cynicism
   into credibility.
8. **Privacy as marketing:** "No telemetry, ever" is already an invariant — say it
   loudly in the README. It's a differentiator developers reward.
9. **Income reality check (goal #2):** donations on a dev TUI plateau at
   $50–500/month even at 10k+ stars (lazygit-scale projects confirm this). The
   realistic monetization ladder for lazyhub specifically:
   - **Now:** GitHub Sponsors + Polar.sh funded by the README/FUNDING.yml (#134). Low ceiling.
   - **V2:** *sponsorware* for the cockpit power features (early access to Agent
     Cockpit dashboards for sponsors, MIT-released after a sponsorship threshold).
   - **V2.5–V3 (the real one):** the **team/enterprise server (#157/#158) sold to
     teams supervising fleets of coding agents.** Teams paying for agent oversight
     have budget; individuals browsing PRs don't. This is the only path on the board
     to "decent secondary income," and it's another reason the agent wedge leads.
   - Anti-goal: paid themes, license keys on the CLI, ads. They kill goal #1/#3.
10. **A name/identity pass:** logo (even ASCII), social preview image, consistent
    tagline across README / gh-pages site / npm. Cheap, compounds with every share.
11. **`lazyhub doctor`** (exists as #133 for config) — extend to environment: gh
    version, auth status, terminal capabilities, truecolor, font/glyph support. Cuts
    the "it renders weird" issue class at install time.
12. **Versioning clarity:** `26.6.2` reads as CalVer on npm where users assume semver.
    Keep it if intentional, but document it in README; agents and humans both pin deps.

---

## Part 3 — The reordered roadmap

> Rule that overrides ROADMAP.md tiering: **Stabilize → Speed up → Beautify →
> Differentiate → Launch.** No feature work while its phase's exit criteria are unmet.
>
> **Canonical execution order lives in `docs/ROADMAP.md` + the GitHub Phase 0–5
> milestones** (synced 2026-06-10; all 53 open issues conform to the spec template).
> This section is the strategic rationale; if it ever disagrees with ROADMAP.md,
> ROADMAP.md wins.

### Phase 0 — Unbreak (1–2 sessions)
1. #186 npm audit (required check; blocks all PRs). May need a pin-override decision.
2. #188 finish: 2 missing imports + **enable ESLint `no-undef`** repo-wide.
3. #187 knip clean; gitignore `coverage/`.
4. #185 settings regressions.
5. #197 tsc --checkJs static checking in CI (catches the missing-import class at type level).
6. Docs truth pass — ✅ DONE 2026-06-10 (PR #210): ROADMAP rewritten, ARCHITECT_DECISIONS
   execa fix + spec template, ARCHITECTURE B-01..B-14 restored, coverage/ gitignored.

**Exit criteria:** CI green on main; lint catches undefined identifiers; docs match reality.

### Phase 1 — Bug-Zero Sprint (the quality freeze)
1. #132 keymap registry (kills the dominant bug class).
2. #193 PTY smoke harness + #195 bug template / --debug-state (repro-first rule is now
   ARCHITECT_DECISIONS §9).
3. #194 crash handler — always restore the terminal.
4. Daily 15-min dogfood sessions → file → fix with repro-first protocol.
5. #180 degraded-state indicator (silent gh failures are themselves a bug factory).
6. #196 god-file split (mechanical; parallel Haiku sessions with tight specs).

**Exit criteria:** two consecutive 15-minute dogfood sessions with zero new bugs;
every advertised key works in every pane.

### Phase 2 — Performance sprint
1. #198 perf instrumentation + publish baseline numbers in the repo.
2. #199 stale-while-revalidate disk cache; spinner-free warm paths.
3. #200 GraphQL batching for PR list; N+1 audit of executor (includes the
   cursor-movement render isolation + virtualization audit).
4. #145 daemon, K-lite slice only: cache+refresh (Windows transport decision first —
   see the re-scope comment on the issue).

**Exit criteria:** keystroke feedback <33ms; warm pane switch <100ms perceived;
maintainer agrees it feels faster than the browser for the core loop.

### Phase 3 — Design revamp (mockup-first)
1. #201 DESIGN_REFERENCES.md + per-screen ASCII mockups; maintainer picks variants.
2. #202 golden render snapshots per screen (the enforcement layer for mockup-first).
3. Implement screen-by-screen against the snapshots: PR list → PR detail → diff
   (#127) → issues → header/footer chrome (#129 hint bars, NO_COLOR, high-contrast).
4. #126 onboarding tour; #128 embedded mode/drafts.

**Exit criteria:** every screen matches a committed mockup; maintainer is satisfied
looking at each screen for the first time in weeks.

### Phase 4 — Differentiate (the wedge)
1. #175 Tripwires (hero feature; full per-rule spec is in the issue body).
2. #178 multi-state filter; #177 review-queue sections; #179 global PR search.
3. #203 Triage Flow (inbox-zero review mode) — the wedge UX on top of 1–2.
4. #174 Agent PR Cockpit epic assembled from the above; #204 Agent Scoreboard;
   #205 cross-model second opinion; #206 ambient/tmux mode; #176 dispatch can trail.
5. Contract (outranks cockpit breadth per Part 5): #208 CONTRACT/COMPATIBILITY docs,
   #146 error codes → #147 idempotency → #148 scopes → #149 dry-run; #150 schema_version
   and #152 rate-limit pulled forward from V2.
6. #73 interactive CI checks (verify against ARCHITECTURE F-12 — may be mostly shipped).
7. Config completion: #66 custom tabs (largely shipped — gap-close), #133 doctor
   (partially shipped — gap-close), #70 wizard (unblocked); standalone: #62 deep links,
   #68 AI Q&A, #65, #69, #71.

### Phase 5 — Launch
1. #140 flow tests + #141 pre-publish smoke (launch blockers).
2. #207 staged npm releases (publish to `next`, soak, promote to `latest`).
3. #134 polish bundle: VHS demo GIF + wedge-led README + comparison table + FUNDING.
4. #209 distribution: winget/scoop/nix/mise.
5. Coordinated launch week (HN/Reddit/lobsters/newsletters).
6. #135 VSCode extension — fast-follow after launch, not a blocker.

### V2/V3 — unchanged, still demand-gated
Remaining contract depth (#151 NDJSON, #153 cost surface, #154 agent-test, #155
sandboxing, #156 concurrency), J3/J4/J6 test suites (#142/#143/#144), #63 watch mode,
#64 desktop notifications, #67 auto-refresh, #72 team view, #170 LiteLLM (gated).
✅ DONE 2026-06-10: #157/#158/#159/#136/#61/#169 closed as "parked — reopen at
demonstrated demand"; all deferred issues carry an activation-protocol header.

---

## Part 4 — Goal scorecard (what each goal actually requires)

| Goal | What it actually depends on | Plan coverage |
|---|---|---|
| Huge-star standout repo | Flawless 10-minute first run + demo GIF + wedge positioning + launch week | Phases 1–3 (quality), Part 2 items 1–3, Phase 5 |
| Secondary OSS income | Sponsors floor now; **team server for agent-supervising orgs** as the real ceiling | Part 2 item 9; V2.5 #157/#158 |
| Goes viral | One 20-second demo moment (agent-PR triage with glyphs) + zero bugs when HN tries it | Phase 4 #175/#174 + Phase 1 exit criteria |
| Go-to tool for a specific set | Pick the set explicitly: **devs supervising coding-agent PRs.** Own that category end-to-end | Wedge sentence + Phase 4 + L-phase contract |

The honest dependency chain: **goal 4 → goal 3 → goal 1 → goal 2.** Pick the user,
delight them, the demo goes viral, stars follow, and income arrives last (and mostly
via teams, not individuals). Every phase above is ordered to serve that chain.

---

## Part 5 — North star: built to last, not built for 2026

> Maintainer's vision: lazyhub should be the go-to tool for humans AND agents for a
> long time — built for the future, not for this year's trend.

**How forever-tools are actually made:** git, vim, tmux, curl, sqlite, fzf all won a
sharp *today* problem first, then refused to break for decades. Durability is not an
upfront design feature; it is a covenant kept release after release. The 2026
agent-supervision wedge is the door, not the destination.

**The timeless core is already on the board, mislabeled as plumbing:** specific agents
and protocols will churn, but the need for a fast, stable, scriptable,
permission-scoped, auditable interface to code operations — usable by any actor,
human or machine — only grows. That is Phases K/L (error codes, idempotency, scopes,
dry-run, schema versioning, audit log). The contract is the product; TUI and JSON/MCP
are its two heads.

**Five structural commitments (the future-proofing that costs little now):**

1. **Elevate the contract to public-API status.** Pull #150 (schema_version) and
   #146 (error code catalog) forward into V1.5. Document the operations catalog like
   an API (`docs/CONTRACT.md`): every operation, its inputs, outputs, error codes,
   side effects. Versioned from day one.
2. **Ship a COMPATIBILITY.md covenant.** Enumerate what will never break without a
   major version: keybindings, TOML config keys (migrations only, never removals —
   `config/migrate.js` already exists), JSON output schemas, error codes, exit codes.
   This document is how a tool earns decade-long trust from both scripts and humans.
3. **Protocol-agnostic core.** The capability catalog is the center; MCP, CLI flags,
   and the TUI are adapters around it. When MCP's successor appears, lazyhub writes
   one new adapter — nothing else moves. Enforce this in the daemon design (#145):
   no MCP types below the adapter layer.
4. **Keep the forge seam clean.** gh-only stays the V1 invariant, but `executor.js`
   is already the single seam — never let GitHub-shaped assumptions leak above it.
   Costs zero today; preserves the option of GitLab/Forgejo adapters if the forge
   landscape shifts in 5–10 years.
5. **Dependency austerity as policy.** Every dependency is a 10-year liability — the
   React/Ink/ESLint/Vitest pin stack is already a preview of that pain. New deps
   require justification against "can we own these 200 lines instead?"; prefer
   plain-text durable formats everywhere (TOML config, NDJSON logs — already true).

**Two properties already in place that age better than any feature — protect them:**
local-first with no server dependency, and no telemetry ever. And one meta-durability
play unique to this repo: the docs-as-spec system means future AI agents can maintain
lazyhub indefinitely from cold context. A solo-maintainer project's realistic 10-year
survival plan *is* AI maintainability — keep investing in it.

**What this changes in sequencing:** nothing before Phase 4; the door is still
stabilize → speed → design → wedge. Within Phase 4, contract work (#146, #150) gains
priority over cockpit breadth. The trend features ride on the timeless core — never
the other way around.

---

## Part 6 — Execution discipline (the business layer)

A plan without a clock, users, or kill criteria is a wish. These four mechanisms
turn Parts 0–5 into something that ships inside the category window.

### 7.1 Time-boxes (calendar, not just sequence)

| Phase | Box | Slip rule |
|---|---|---|
| 0 — Unbreak | 1 week | none — it's small |
| 1 — Bug-Zero | 3–4 weeks | if >4 weeks, cut surface: disable the buggiest pane behind a flag rather than fixing forever |
| 2 — Performance | 2–3 weeks | ship at "feels faster than browser on core loop", not perfection |
| 3 — Design | 2–3 weeks | screen-by-screen; ship partial rather than slip |
| 4 — Wedge + contract | 5–6 weeks | tripwires + triage flow are the must-haves; everything else can trail the launch |
| 5 — Launch | 2 weeks | hard date set 4 weeks in advance; launch with what's true then |

≈ 4 months to launch. The agent-cockpit window is open now; every month of slip
is market risk, not just delay. Review the box monthly; re-plan, don't drift.

### 7.2 Design partners (users before launch, not after)

- During Phase 1, recruit **5–10 design partners**: developers who review multiple
  agent PRs daily (source: agent-tooling communities, X, HN threads on agent
  workflows). Offer early access + named credit.
- Cadence: they use lazyhub weekly; 15 minutes of feedback; their real workflows —
  not our imagination — shape Phase 4 (triage flow, tripwire set, scoreboard).
- Hard gate: **do not enter Phase 4 without at least 5 active partners.** If we
  can't find 5 people who want this, that is itself decisive data about the wedge.

### 7.3 Build in public (demand-side, from week 1)

- Minimum 1 public artifact/week from Phase 0 onward: a clip, a before/after perf
  number, a tripwire catch, a devlog note. Audience compounds with ~3 months of
  lag — starting at launch is 3 months too late.
- Each phase exit = a public demo moment. The launch week (Phase 5) is the 5th
  public moment, not the 1st.

### 7.4 Checkpoints and kill/pivot criteria (decided now, while sober)

- **Phase 1 exit metric:** two consecutive 15-min dogfood sessions, zero new bugs.
- **Phase 2 exit metric:** keystroke <33ms, warm pane switch <100ms, maintainer
  verdict "faster than browser."
- **Beta signal (during Phase 4):** design partners return weekly *unprompted*.
  If they don't, stop building and find out why before writing more code.
- **Launch (week 1):** ≥500 stars = pass; ≥2k = breakout, double down on cockpit;
  <200 = positioning problem — fix the story, relaunch a feature in 4–6 weeks
  (virality is a repeated game; one launch is one roll).
- **3 months post-launch:** <50 weekly active users or no organic mentions →
  re-evaluate the wedge itself before any V2 work. The contract core (Part 5)
  survives any pivot; the cockpit skin is replaceable.
- **Standing risk watch:** if GitHub/gh ships native agent-PR triage, accelerate
  to the parts they won't build (cross-forge contract, local-first audit,
  scoreboard) — don't compete head-on with the platform owner.

### 7.5 The honest #1 risk

Not competition, not tech: **discipline.** Phases 0–2 are grindy and invisible,
and the temptation to skip to shiny Phase-4 features is the single most likely
failure mode of this plan. The maintainer's job in months 1–2 is to say "not yet"
— mostly to himself.

---

## Part 7 — New operating rules for LLM sessions (proposed ARCHITECT_DECISIONS additions)

1. **Mockup-first:** no UI change without a committed ASCII mockup it implements.
2. **Repro-first:** no bug fix without a failing test that reproduces it first.
3. **Verified-by-running:** every feature PR body includes the exact manual steps run.
4. **Snapshot gate:** screens have golden snapshots; intentional changes update them
   in the same PR with the mockup.
5. **Perf budget:** PRs may not regress keypress→render latency (perf trace in CI on
   the PTY harness, threshold-gated).
6. **Right-size the model:** cross-file state bugs are never delegated to Haiku.
