# Lazyhub Roadmap

## Product direction

Lazyhub helps maintainers understand changes, make informed decisions, and stay
accountable for what ships as coding agents produce more work (#174, D12).

- **First audience:** terminal-oriented solo maintainers who regularly review
  agent-produced PRs.
- **Core journey:** open, see work needing attention, inspect changes and
  evidence, understand the next action, return with context preserved.
- **Non-goals:** generic coding-agent runtime, autonomous mutation execution,
  broad dashboards, editor expansion, new packaging channels, plugin
  marketplace, visual reskin.
- **Success signals:** repeat usefulness, informed decisions, and observed saved
  effort (pilot #286). Stars and acquisition do not count. No traction is claimed
  before pilot evidence exists.

> **Superseded (2026-10-21).** The earlier narrative of Lazyhub as "a human
> approval and evidence surface" whose Alpha is Slice 1 (watch-only) plus Slice 2
> (approval) is replaced by the three stages below. Slice 1 and Slice 2 remain as
> work-package names: Slice 1 is containment/observation and release integrity;
> Slice 2 is the optional approval stage.

Read `docs/ARCHITECT_DECISIONS.md` and `docs/THREAT_MODEL.md` before selecting
work. The milestone and issue body are authoritative when this roadmap only
summarizes them; `docs/ROADMAP.md` and `docs/ARCHITECT_DECISIONS.md` are
authoritative over #174, which only summarizes them for GitHub readers.

Concepts that must stay distinct: review progress, GitHub review, local
decision, and Lazyhub authorization (GLOSSARY "Review concepts").

## Stages

Each stage has its own exit criteria. Success of one is not evidence for another.

| Stage | Label | Scope | Exit criteria |
|---|---|---|---|
| Review Alpha | `stage:review-alpha` | Read-only review journey over the existing `gh` login; no App, agent/MCP, or AI provider. Containment, release integrity, first-run repair, queue/evidence. Model-proposed writes disabled, even if confirmed. Human-initiated management is preserved as legacy functionality outside the read-only review context. | #295 passes the complete read-only journey; #134 readiness gate met; #285 story matches shipped behavior; consented pilots (#286) report repeat usefulness. |
| Optional approval | `stage:approval` | Commit-bound approval and the App-pinned `lazyhub/approval` check (Slice 2). D1-D11 unchanged; never executes merges. No dependency from review Alpha. | #277 feasibility and #278 contracts (including the #145 dependency audit); #245, #235, #244, #203 done; #141 live sandbox proof. |
| Demand-gated | `stage:demand-gated` | Review progress and changes since last inspection (#294), first external integration (#297), serve/policy service (#145). | Activated only from pilot evidence; each ticket states its own gate. |

Contributor enablement (#296) supports adoption without a marketplace. Local-agent merge
approval is `managed_gateway`; eligible cloud-agent merge approval is
`github_enforced` after ruleset and App-source verification. Team availability and
an always-on verifier are Beta.

## Review Alpha execution order

Canonical decisions (#293) land first. `∥` means parallel.

1. #293
2. (#276 then #284, one owner) ∥ (#287 [closed], #288, #292) ∥ release (#265 [merged] then #282)
3. #201 mockups
4. (#279 then #177) ∥ (#175 then #127) ∥ (#280 + #290) ∥ #281
5. #295, then demo re-record, then #286 pilot

Ownership overlaps (one owner or strict sequence): #276/#284, #265/#282,
#279/#177, #175/#127, #280/#290. Remaining review Alpha items without an ordering
constraint: #253, #248 (maintainer npm setup), #283, #285, #289, #296, #134.
Enforcement feasibility (#277) may run in parallel with all of this.

Independent release, test-infrastructure, and security work consistent with
existing decisions may proceed in parallel; #293 gates only work that relies on the
changed scope or the assistant-write boundary.

## Slice 1 - observe safely and reach pilots

| Order | Issue | Exit condition | Status |
|---:|---|---|---|
| 1 | #247 | D1-D12, T1-T21, canonical agent rules, and private disclosure path are tracked. | Tracked |
| 2 | #249 | Agent mutations are disabled and fresh/default capability is read-only. | Done |
| 3 | #250 | Arbitrary daemon passthrough is gone and privileged IPC is authenticated. | Done |
| 4 | #251 | Only typed reads are cacheable; unknown/write-shaped operations fail closed. | Done |
| 5 | #252 | Shipped external AI subprocesses use isolated cwd, HOME, config, and environment. | Done |
| 6 | #253 | Shipped local files, sockets, caches, and diagnostics are permissioned and redacted. | Partial — PR #269 merged; daemon pid-file mode, daemon socket bind→chmod window, Windows pipe naming/ACLs, and cache partitioning remain |
| 7 | #246 | Watch-only observes GitHub timelines, commits, reviews, and checks with zero agent configuration. | Done |
| 8 | #133 | Doctor reports evidence-backed coverage and ungoverned paths. | Done |
| 9 | #70 | First run reaches a useful watch-only report through the existing `gh` login. | Done |
| 10 | #248 | Pilot npm release uses trusted publishing and verifiable provenance. | Open (pending maintainer npm trusted-publisher setup; PR #265 merged) |

Progress: items marked Done are merged; each PR lists its own residual gaps under "Not done / needs maintainer". #248 stays open until the maintainer completes npm trusted-publisher setup.

### Slice 1 exit

- Ten maintainers complete watch-only onboarding.
- Reports never call an unknown path enforced.
- Published-package security fixes and the provenance release gate are merged.
- No enabled agent mutation path remains outside typed policy.

## Slice 2 - optional approval stage (`stage:approval`)

| Order | Issue | Exit condition |
|---:|---|---|
| 1 | #245 | A user-owned checks-only App publishes one check through a one-use repository token. |
| 2 | #235 | Canonical approval records bind exact repository, commit, policy, and evidence state. |
| 3 | #203 | A maintainer can make safe decisions from computed facts without reading the agent transcript. |
| 4 | #244 | Every protected-branch PR requires the App-pinned check; Lazyhub never merges it. |
| 5 | #141 | Live sandbox evidence proves source pinning, invalidation, bypass handling, and no merge execution. |

### Slice 2 exit

- Every enrolled protected-branch PR is blocked without the App-sourced check.
- New commits and stale/revoked approvals cannot reuse a passing check.
- The UI and diagnostics label local-agent coverage `managed_gateway`.
- The sandbox proves eligible cloud-agent coverage `github_enforced`.
- A human still performs the final merge through GitHub or another client.

## Beta - supervised execution and team operation

Beta work must not block Alpha user learning.

| Area | Issues |
|---|---|
| Governed execution, crash recovery, idempotency, reconciliation | #255, #147 |
| Native payload-bound presence signing | #256 |
| Policy, identity, budgets, sandboxing | #148, #153, #155, #236 |
| Policy/approval daemon, audit, recovery | #145, #237, #238 |
| Stable errors, previews, contracts, events | #146, #149, #150, #151 |
| Evidence, CI, integration journeys | #73, #140 |
| Credential and local security depth | #234 |
| Broader release hardening | #257 |
| Team verifier and governance | #72 and Team Governance milestone |

## Backlog and frozen work

- #174 is the strategy umbrella, not an executable milestone item.
- #201 (focused review journey mockups) is review Alpha work and gates the UI
  tickets in step 4 of the execution order (Protocol B).
- Broad dashboards, editor integrations, broad TUI feature expansion, and
  packaging beyond npm and Homebrew are frozen until pilot evidence changes the
  priority (D12). The narrow read-only review journey is not frozen.
- Reopen a frozen direction only with concrete user evidence or a security and
  correctness reason.

## Picking the next issue

1. Pick by active stage first, priority second: `stage:review-alpha`, then
   `stage:approval`, then `stage:demand-gated`. Within a stage follow the
   execution order. Security defects in shipped or enabled functionality are
   triaged by exposure and severity regardless of stage.
2. Read `AGENTS.md`, `docs/ARCHITECT_DECISIONS.md`, and
   `docs/THREAT_MODEL.md`.
3. Verify every issue precondition against the current tree.
4. Treat the issue's Files NOT to touch and Constraints sections as hard scope.
5. Update this roadmap in the same PR when ordering, scope, or exit criteria
   change.
