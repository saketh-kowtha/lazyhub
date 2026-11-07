# Lazyhub Roadmap

This is the canonical product direction and execution plan. The [README](../README.md) describes current user-facing behavior; items and exit criteria below are planned work until their issues are complete and the behavior is included in a release. Check the issue board for live status.

## Product direction

Lazyhub helps maintainers understand changes, make informed decisions and stay accountable for what ships as coding agents produce more work (#174, D12).

- **First audience:** terminal-oriented solo maintainers who regularly review agent-produced pull requests.
- **Target journey:** find work that needs attention, inspect changes and evidence, understand the next action, and return later with context.
- **Non-goals:** a generic coding-agent runtime, autonomous mutation execution, broad dashboards, broad editor expansion, new packaging channels, a plugin marketplace or a visual reskin.
- **Success signals:** repeat usefulness, informed decisions and observed saved effort in the consented pilot (#286). Stars and acquisition are not evidence of success; no traction is claimed before pilot evidence exists.

Keep review progress, GitHub review, local decision and Lazyhub authorization distinct (see `GLOSSARY.md`, “Review concepts”).

## Current stages

Each stage has separate entry and exit criteria. Progress in one does not prove another is complete.

| Stage | Label | Scope | Exit criteria |
|---|---|---|---|
| Review Alpha | `stage:review-alpha` | Complete the read-only review journey over the existing `gh` login, including containment, release integrity, first-run repair, queue and evidence. No App, agent/MCP or AI provider is required. Model-proposed writes stay disabled even if confirmed; existing human-initiated management remains outside that read-only context. | #295 passes the read-only journey; #134 readiness gate is met; #285 describes shipped behavior accurately; consented pilots (#286) report repeat usefulness. |
| Optional approval | `stage:approval` | Add commit-bound approval records and the App-pinned `lazyhub/approval` check (Slice 2). D1-D11 stay unchanged; Lazyhub never executes merges. This stage does not block Review Alpha. | #277 feasibility and #278 contracts (including the #145 dependency audit); #245, #235, #244 and #203; live sandbox proof in #141. |
| Demand-gated | `stage:demand-gated` | Review progress and changes since last inspection (#294), first external integration (#297), and the serve/policy service (#145). | Start only when pilot evidence supports the specific work; each issue defines its own gate. |

Contributor enablement (#296) supports adoption without a marketplace. Local-agent coverage can be called `managed_gateway`, and eligible cloud-agent coverage `github_enforced`, only after the corresponding gateway or App-source and ruleset verification exists. Team availability and an always-on verifier are Beta work.

## Review Alpha order

Canonical decisions (#293) land first. `∥` means the work can proceed in parallel; the listed `then` relationships must remain sequential.

1. #293
2. (#276 then #284, one owner) ∥ (#287, #288, #292) ∥ release work (#265 then #282)
3. #201 mockups
4. (#279 then #177) ∥ (#175 then #127) ∥ (#280 with #290) ∥ #281
5. #295, then refresh flagged demos, then run the #286 pilot

Ownership overlaps or strict sequences: #276/#284, #265/#282, #279/#177, #175/#127 and #280/#290. Other Review Alpha work without an ordering constraint includes #253, #248 (maintainer npm setup), #283, #285, #289, #296 and #134. Enforcement feasibility (#277) may proceed alongside Review Alpha.

Independent release, test-infrastructure and security work may proceed in parallel when it is consistent with the approved decisions. #293 gates work that relies on the changed scope or assistant-write boundary.

## Optional approval work

The approval stage builds on Review Alpha but is optional and does not claim that current reports enforce policy. Its work packages are:

| Order | Issue | Intended result |
|---:|---|---|
| 1 | #245 | A user-owned checks-only App publishes one check through a one-use repository token. |
| 2 | #235 | Approval records bind the repository, commit, policy and evidence state. |
| 3 | #203 | A maintainer can make a safe decision from computed facts without reading an agent transcript. |
| 4 | #244 | Protected-branch PRs require the App-pinned check; Lazyhub never merges them. |
| 5 | #141 | Live sandbox evidence covers source pinning, invalidation, bypass handling and no merge execution. |

Design and contracts for this stage are in [`design/optional-approval.md`](design/optional-approval.md) (#278, #277, #203, #235). Approval is a human decision in the interactive TUI, recorded in a local hash-linked journal; no agent submits requests in this stage, so #145, #148 and #236 are not prerequisites, and narrowed subsets of #237 (retention) and #238 (safe mode) are activation prerequisites. Expiry and revocation of a check that already passed are Lazyhub-mediated and are never reported as `github_enforced`.

**Status (honest):** only groundwork exists in the tree: the record module under `src/approval/` and the typed context read, with tests. Nothing imports them, there is no config key, command or screen, and nothing is enforced or protected. Coverage stays `advisory`. The README does not describe approval as available.

### Execution order (acyclic)

| Step | Work | Needs |
|---|---|---|
| P0 | Design doc, #235 groundwork, #140 scaffold (this groundwork) | none |
| P1 | #277 sandbox feasibility run | maintainer actions M1, M2 |
| P2 | #245 helper code against a fake endpoint | P0 |
| P3 | #245 live seeding | P2, M1, M2 |
| P4 | #244 adapter and ruleset verification | P0, P3, P1 decisions confirmed |
| P5 | #203 UI against the transition contract (may run in parallel with P2-P4) | P0 |
| P6 | #203 wired to the real publisher | P4, P5 |
| P7 | Activation prerequisites: #237 retention subset, #129 approval-screen polish | none |
| P8 | #141 live proof, matrix run twice | P6, P7, M3 |
| P9 | #140 remaining journeys | P6 (unit), P8 (live) |
| P10 | Docs may describe the stage as available (default still off) | P8, P9 |

The table above orders by dependency; the numbered list keeps #203 before #244 because the transition contract lets the UI start first, while its publish-and-read-back criterion completes at P6.

Exit requires enrolled protected-branch PRs to be blocked without the App-sourced check, stale or revoked approvals to be unusable, and the sandbox to prove the stated boundaries. A human performs the final merge through GitHub or another client.

## Demand-gated and Beta work

These areas stay behind pilot evidence and must not block Review Alpha learning:

| Area | Issues |
|---|---|
| Governed execution, crash recovery, idempotency and reconciliation | #255, #147 |
| Native payload-bound presence signing | #256 |
| Policy, identity, budgets and sandboxing | #148, #153, #155, #236 |
| Policy/approval daemon, audit and recovery | #145, #237, #238 |
| Stable errors, previews, contracts and events | #146, #149, #150, #151 |
| Evidence, CI and integration journeys | #73, #140 |
| Credential and local security depth | #234 |
| Broader release hardening | #257 |
| Team verifier and governance | #72 and Team Governance milestone |

## Frozen directions

- #174 is a strategy umbrella, not an executable milestone item.
- #201 supplies focused review journey mockups and gates the UI work in step 4 above (Protocol B).
- Broad dashboards, broad TUI feature expansion and packaging beyond npm and Homebrew stay frozen until pilot evidence changes the priority (D12). The narrow read-only review journey remains active.
- Reopen a frozen direction only with concrete user evidence or a security or correctness reason.

## Picking the next issue

1. Pick by active stage first (`stage:review-alpha`, then `stage:approval`, then `stage:demand-gated`), and follow the order and dependencies above. Security defects in shipped or enabled functionality are triaged by exposure and severity regardless of stage.
2. Read `AGENTS.md`, `docs/ARCHITECT_DECISIONS.md` and `docs/THREAT_MODEL.md`.
3. Verify every issue precondition against the current tree and check the issue board for live status.
4. Treat the issue's Files NOT to touch and Constraints sections as hard scope.
5. Update this roadmap in the same change when ordering, scope or exit criteria change.
