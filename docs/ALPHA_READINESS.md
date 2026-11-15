# Review Alpha readiness (go / no-go for Dec 1)

This is the evidence record for the Review Alpha gate in #134 and its 2026-10-22 amendment, within the launch plan in #629 (Dec 1 Review Alpha, then Jan 12 v1.0). It follows the stage definition in [ROADMAP.md](ROADMAP.md). A closed ticket is not evidence: every row cites a merged PR, a test, a workflow or a command that was run against the source named below.

- **Source verified:** `origin/main` at `8571986` (package version `26.6.3`, unreleased). Latest published npm version: `26.6.2` (tag `v26.6.2`, 233 commits behind `main`).
- **Verified on:** 2026-11-15.
- **Verdict today: NO-GO.** Several gates are met in source, but the release gates cannot be met until a candidate is published with provenance, the read-only journey (#295) exists, and the pilot has run. See [Blocking for Dec 1](#blocking-for-dec-1).

Status vocabulary: **met** (evidence observed), **partial** (some acceptance criteria evidenced, some not), **not met**, **in progress** (work underway elsewhere), **maintainer action** (needs an owner step that code cannot perform). Nothing below is marked met without an observed result.

## Evidence run

Commands actually run for this document, on a worktree at `origin/main` `8571986`:

| Command | Result |
|---|---|
| `npm ci && npm run build` | passed; `node dist/lazyhub.js --version` prints `26.6.3` |
| `npx vitest run` on the containment, IPC, MCP, queue, keystroke-budget and failure-message test files (11 files) | 173 passed, 1 skipped, 7 todo |
| `npm view lazyhub version dist.attestations` | `26.6.2`; no attestations field |
| `git merge-base --is-ancestor` for the containment PRs (#332, #324) against `v26.6.2` | not ancestors: the published `26.6.2` predates them |
| `gh run view` for the CI run on `8571986` | all 11 jobs succeeded, including memory budget, performance budget, TERM=linux smoke, Windows and Alpine smoke, both PTY platforms |
| `gh api .../private-vulnerability-reporting` | `{"enabled":true}` |

Not performed: a launch of the built binary under a temporary `HOME` (the sandbox guard denied that form of command in this session); only `--version` was run. The full lint/test/build/typecheck/PTY gate result for this documentation change is in the pull request.

## Alpha gates

### 1. Agent write containment (#276)

- **Status:** partial (met in source; not met in the distributable artifact).
- **Evidence:** #332 disables model-proposed GitHub writes in the AI assistant (stable `AI_MUTATIONS_DISABLED` error, `src/ai-assistant.js`); #324 gates GitHub writes on the IDE socket behind `[ipc].allow_writes` (stable `writes-disabled`, `src/ipc.js`); the MCP server lists read-only tools only (`src/cli/mcp-server.js`, `src/mcp.js`). Tests: `src/ai-assistant.test.js`, `src/ipc.test.js`, `src/cli/mcp-server.test.js`, `src/cli/mcp-server.e2e.test.js`, `src/security-journeys.test.js` (J4: no write tool advertised, reads still served). All passed in the run above. SECURITY.md states the behavior ("Agent and assistant writes").
- **Remains:** #276 requires verifying the distributable artifact, not only source. The published `26.6.2` does not contain #332 or #324, so a new candidate must be cut and checked (version and commit recorded) before any pilot distribution. Detail beyond this stays in private reporting.

### 2. Release provenance (#248)

- **Status:** maintainer action.
- **Evidence:** `.github/workflows/release.yml` uses OIDC trusted publishing with the `npm-publish` environment, `permissions: {}` at top level, `id-token: write` only on the publish job, `npm publish --provenance`, and a post-publish smoke job (`scripts/release-smoke.mjs`) that checks attestations and runs the tarball. `#265` merged the workflow. Observed: `npm view lazyhub dist.attestations` returns nothing for `26.6.2`, so no published version has provenance.
- **Remains:** the maintainer must finish the npm trusted-publisher binding and `npm-publish` environment setup, then publish a non-latest prerelease and run the smoke job to a pass. Procedure is in [RELEASING.md](RELEASING.md) (owned by the release-docs lane). This gate is not passed until a published tarball's provenance is verified; the #248 text says no pilot release may proceed before that.

### 3. Reproducible dependency graph (#282)

- **Status:** partial.
- **Evidence:** #305 makes CI, release and promote use `npm ci` and run `scripts/record-toolchain.mjs --verify-clean` (`ci.yml`, `release.yml`, `promote.yml`); #323 bundles runtime dependencies so the package has zero runtime dependencies (`package.json` `dependencies` is empty; observed); #320 adds Dependabot cooldown and grouping (`.github/dependabot.yml`). CI on `8571986` succeeded.
- **Remains:** the point of the gate is that validation and release resolve the same graph. That comparison (lockfile hash logged by CI versus the release run for one commit) has not been observed because no release has run from this workflow. It is exercised by the #248 prerelease.

### 4. Complete read-only journey (#295)

- **Status:** in progress.
- **Evidence:** the pieces exist and are tested individually: Focus (#400), review queue (#589), evidence core and view (#588), queue-to-evidence with return (#590), why CI is red (#578), repo picker (#308), shared fixture shim (#344). `test/pty/run.js` is the harness. No named end-to-end read-only journey exists on `main` yet; the amendment's input-level checks (every mutation key invokes no GitHub write in the review context) are not in `docs/TEST_PLAN.md` or `docs/MANUAL_TEST_PLAN.md` today.
- **Remains:** the journey and its PTY flows are being built by the test-plan lane (`test/pty`, [TEST_PLAN.md](TEST_PLAN.md), [MANUAL_TEST_PLAN.md](MANUAL_TEST_PLAN.md)). Re-check this row when that merges: it must cover login, repo selection, queue, evidence, return with position kept, narrow terminal, empty queue, auth failure, rate limit, partial evidence, and the no-mutation assertions. Also note #177 and #127 are still open (see next row).

### 5. Account-wide queue with in-repo filter (#177)

- **Status:** partial.
- **Evidence:** #589, #590 and #588 merged an account-wide queue ("scope: account", `src/features/queue/view.jsx`; `src/features/queue/useReviewQueue.js` loads it; `g q` from `src/app-keys.js`), grouped by status with an explanation per row, `]`/`[` groups, `+` for more, and return to the same group and row (`src/review-queue.e2e.test.jsx`, passed).
- **Remains (not found in source):** the amendment asks for a launch inside a git repo to start filtered to that repo with the account-wide view one key away, plus org and saved-repository-set filters. A search of `src/features/queue` finds no repository, org or set filter, and the view hard-codes "scope: account". Also unverified here: the 500-repo / 1,000-PR fixture budget for the queue, and per-host separation. #177 is open; Phase 2 "Start here" ranking is out of Alpha scope.

### 6. Open by reference or URL (#315)

- **Status:** met.
- **Evidence:** #328 (`bin/lazyhub.js`, `src/bootstrap.js`, `src/app.jsx`); `lazyhub --help` text and the README quick start describe `owner/repo#N`, `#N`, `N` and URL forms, read-only. An explicit reference skips onboarding (`bin/lazyhub.js`). Covered by the bootstrap and launch-path tests in the full suite (`src/launch-paths.test.js`, `src/bootstrap.repo.test.js`).
- **Remains:** no live GitHub run was made for this document; the pilot checklist should include one against a real repository.

### 7. Day-one failure messages (#313)

- **Status:** met (fixture level).
- **Evidence:** #338 adds `src/executor/classify.js` (SSO, scopes, rate limit, offline, not-found classification) with `src/executor/classify.test.js` and a stderr fixture set, `src/components/FailureNotice.jsx` and `EmptyState.jsx`, with a PTY flow added to `test/pty/run.js`. Classification and notice tests passed in the run above.
- **Remains:** the messages come from recorded stderr fixtures, not from live SSO or scope failures. The #295 journey covers auth failure and rate limit end to end.

### 8. Memory and terminal budget in CI (#311)

- **Status:** met.
- **Evidence:** #325 and #336. `ci.yml` jobs "TUI memory budget (512 MB)" (runs `test/pty/memory.js` in a 512 MB container, including the scale fixture), "Performance budget" (`npm run test:perf`), and "TERM=linux PTY smoke" (`npm run test:portability`); also Windows and Alpine smoke. All succeeded on `8571986`. Budgets are documented in [PERF_BUDGETS.md](PERF_BUDGETS.md).
- **Remains:** the amendment also names a 500-repo / 1,000-PR fixture for the queue; the existing scale fixtures target the PR list, so confirm the queue is inside the budget when the in-repo filter lands (row 5).

### 9. Keys via the action registry (#312)

- **Status:** partial.
- **Evidence:** #340 adds the registry-dispatched keymap, `g`-prefix navigation, which-key and keystroke budgets. `src/keys.e2e.test.jsx` and `src/keystroke-budgets.e2e.test.jsx` (37 tests) passed.
- **Remains:** #312 says all keyboard actions dispatch through the registry. A grep of non-test sources still finds 88 `input === '...'` handlers across 16 files (for example `src/app.jsx`, `src/features/prs/*`, `src/components/*`), though some are the registry and keymap modules themselves. Treat this as partial until the remaining view handlers are migrated or consciously exempted. The budget test comment still says the queue is "not built yet"; the budgets should be re-pointed at the queue.

### 10. SECURITY.md contents

- **Status:** met.
- **Evidence:** read in full on `origin/main`. It covers: inherited `gh` token access ("What lazyhub can access"); running with a fine-grained read-only `GH_TOKEN` ("Running with least privilege", with the permissions to grant); the incident runbook ("Incident response": npm deprecate, fixed release through the provenance workflow, advisory, user token revocation and audit-log review); private reporting (the Advisories flow; the setting is enabled, observed with `gh api`); supported versions; read-only agent surface.
- **Remains:** nothing missing from the checklist. Two wording items for the release-docs lane to consider: "Supported versions" still says "until the first stable gateway release", and the runbook should link the rollback steps in [RELEASING.md](RELEASING.md). This file was not edited here.

### 11. Public wording matches shipped capabilities

- **Status:** partial.
- **Evidence:** README (#632) and the Pages site (#635) were spot-checked against source. Confirmed present: `g q` queue and `]`/`[`/`+` keys; evidence `e`; why-red `f` (`src/features/prs/WhyRed.jsx`, `ci-blame.js`); claims `V` (`claims.js`, `ClaimsView.jsx`); collisions `K`; story `s`; `lazyhub --onboarding` (`src/features/onboarding/flow.js`, `src/cli/usage.js`); reference opening; `smartEnter` opt-in; `generated_files`; read-only MCP and assistant. The README explicitly states Review-specific MCP tools are not shipped, that no App enforces approval, and that no telemetry exists. No App or agent requirement appears in the default path.
- **Remains:** (a) the README says "A published release can lag `main`": today the published `26.6.2` lacks most of the listed features, so install instructions do not deliver what the page describes until a new release ships. (b) The lead GIF `docs/demo/out/tour.gif` was recorded 2026-10-21 from a tape that never visits the queue, evidence or why-red, so it shows only list, detail and diff (see row 12). (c) #285 is still open; re-check wording after the in-repo filter question in row 5 is settled, since the README describes the queue as scoped to "requests your review or that you opened".

### 12. Fixture demo

- **Status:** partial.
- **Evidence:** deterministic VHS recordings against the fixture `gh` shim (`docs/demo/`, `test/support/gh-shim/demo.mjs`, `.github/workflows/demo.yml`, #273, #344). Tapes: `tour`, `panes`, `watch-only`, `doctor-coverage`.
- **Remains:** the #134 demo is "identify work, inspect evidence, explain uncertainty, return to the queue". No tape covers that flow (`grep queue docs/demo/tapes` finds nothing), so the existing GIFs do not show it. Add or refresh a tape after #295 settles the flow (#629 asks for a refreshed `tour.gif`), and keep it free of any claim that AI proves safety.

### 13. Pilot learning gates (#286)

- **Status:** not met (maintainer action; nothing performed).
- **Evidence:** none yet. `docs/PILOT_PLAN.md` does not exist; #286 is open. The targets are goals, not results: ten consenting maintainers inspect results, five complete an unassisted review task in a selected repository, three return the following week. Measured by interview and manual observation, with no telemetry, and with App setup excluded.
- **Remains:** write the pilot protocol, recruit with explicit consent, run it against a pilot-safe build (needs rows 1 and 2), record aggregate results without names or private content, and set a dated decision checkpoint. Until then no pilot outcome may be claimed anywhere.

### 14. Emergency deprecation, supported versions, recovery, reporting (#134 last criterion)

- **Status:** partial.
- **Evidence:** SECURITY.md (row 10); [RELEASING.md](RELEASING.md) covers the release procedure.
- **Remains:** confirm RELEASING.md has the rollback/deprecation path and App-revocation note once its lane lands; the Homebrew tap lagging npm (#472) affects the same recovery story for brew users.

## Optional approval-release gates (not required for Alpha)

Per #134 and [ROADMAP.md](ROADMAP.md), these belong to the optional approval stage (`stage:approval`). They do not block the Dec 1 Review Alpha, and none of them is claimed here. Alpha wording must not imply any of them exists.

| Gate | Issue | State (from tracker and tree, not tested here) |
|---|---|---|
| Approval-check expiry, revocation and offline semantics proven | #277 | open |
| Contracts for the optional approval path | #278 | closed; design in [design/optional-approval.md](design/optional-approval.md) |
| Commit-bound approval records | #235 | closed as groundwork; `src/approval/` exists, nothing imports it, no screen or command |
| App-pinned check bound to the exact record | #244 | open |
| Checks-only App and per-approval credential helper | #245 | open |
| Approval journey UI | #203 | open |
| Live sandbox proof (source pinning, invalidation, bypass handling, no merge execution) | #141 | open |
| Stale, revoked and expired handling; failure and read-back; safe recovery | within #244/#141 | not started |
| App configuration counts | #286 | measured only in the optional stage; never substitute repository selection for enforced setup |

Coverage stays `advisory` and doctor never reports `github_enforced` or `managed_gateway` in this Alpha (SECURITY.md, `src/security-journeys.test.js` J1).

## Blocking for Dec 1

In order. Each item has a dependency on the one before it where noted.

1. **Maintainer: finish npm trusted-publisher and `npm-publish` environment setup (#248).** Nothing can ship with provenance until this is done.
2. **Cut a prerelease candidate and verify it (#248, #276, #282).** Publish a non-latest tag, run the post-publish smoke job, confirm attestations, record version and commit, and verify the containment behavior against the published tarball (the current `26.6.2` lacks it). Compare the lockfile identity logged by CI and release for the same commit.
3. **Land the read-only journey (#295)** with named PTY flows and the no-mutation input assertions (in progress in the test lane); keep `docs/MANUAL_TEST_PLAN.md` Sections 1 and 2 plus `npm run test:pty` as the pre-launch smoke.
4. **Close the queue gap (#177):** start filtered to the current repository with the account-wide view one key away, and org/repository-set filters, or have the maintainer explicitly narrow the launch requirement in #134 and the README.
5. **Finish the #312 registry migration, or record the exemptions,** and re-point the budget flows at the queue.
6. **Re-record the demo (#285, #629)** so it shows queue, evidence, uncertainty and return, and recheck README/Pages wording against the candidate release.
7. **Ship a release that contains the documented features,** and fix the Homebrew tap lag (#472), so `npm install -g lazyhub` and `brew install` match the README.
8. **Run the pilot (#286):** write `docs/PILOT_PLAN.md`, recruit with consent, run, and record the 10/5/3 outcomes as measured. Report only what happened; an unmet gate is reported as unmet.

Items 1 and 2 are maintainer-gated. Items 3 to 6 are engineering. Item 8 cannot complete before item 2 and is the only evidence of repeat usefulness.
