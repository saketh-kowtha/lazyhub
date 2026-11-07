# Optional approval: contracts, semantics and groundwork

> **Status:** architecture decision, 2026-11-07. Covers #278, #277 (decision
> part), #203 (journey design), #235 (groundwork spec), #129, #140, and the
> maintainer actions for #244, #245, #234 and #141.
>
> **Stage:** `stage:approval` only. Nothing here is a dependency of review
> Alpha, nothing here is on the default path, and nothing here claims
> enforcement. D1-D11 are unchanged; where this doc narrows a dependency it
> says so explicitly (section 10).
>
> **Reading order:** `AGENTS.md`, `docs/ARCHITECT_DECISIONS.md` (D1-D12),
> `docs/THREAT_MODEL.md`, then this doc.

## 0. Summary of decisions

1. Approval in the optional stage is a **human decision made in the
   interactive TUI**, recorded locally as an exact, hash-identified record,
   and reflected on GitHub only through the App-pinned `lazyhub/approval`
   check. Lazyhub never merges.
2. There is **no agent request queue** in this stage. Agents do not submit
   approval requests; a human opens a pull request and decides. This removes
   the need for the `lazyhub serve` service (#145), agent enrollment (#236) and
   the general policy engine (#148) for this stage.
3. The approval record store is a **local, append-only, hash-linked NDJSON
   journal** under the user config directory. It detects corruption; it is
   not tamper-proof against software running as the same OS user.
4. Canonical form is a **restricted JCS (RFC 8785) profile**: objects,
   strings, safe integers and booleans only; keys sorted by UTF-16 code unit;
   SHA-256 over a domain-separated UTF-8 byte string.
5. **What GitHub enforces** (after #141 proof): a missing check blocks merge;
   a new head commit has no check and blocks merge; with "require branches to
   be up to date", a base change blocks merge until the branch is updated,
   which creates a new head. **What GitHub does not enforce:** expiry and
   revocation of a check that already passed. Those are Lazyhub-mediated
   (`managed_gateway` at best) and depend on Lazyhub running and reaching
   GitHub. This is stated in the UI and docs and never labelled
   `github_enforced`.
6. The groundwork PR ships the record module and its tests only. It is not
   imported by any runtime surface, adds no config keys, no CLI command, no
   UI, no network call on the default path.

---

## 1. #278 — Minimal optional-approval contract

### 1.1 Human authentication and identity binding (minimum for this stage)

**Mechanism.** The approver is the GitHub account of the user's existing `gh`
session, read through a typed executor read (`viewer { login id }`) in the
same query that reads the pull-request context (section 4.6). The decision is
accepted only from the interactive TUI attached to a TTY. There is no CLI
flag, IPC message, MCP tool, deep link or environment variable that records an
approval.

**Recorded approver fields:** `host`, `login` (display), `node_id`
(authoritative), `auth_method = "gh_session_tty"`.

**Limits (stated in the UI help, the threat model and this doc):**

- This proves which GitHub account the local `gh` session belongs to. It does
  not prove that a human, rather than other software running as the same OS
  user, pressed the key. Local approval is therefore at best
  `managed_gateway`, never `github_enforced` on the human-presence axis (D1,
  T12). Payload-bound presence is #256 and does not block this stage.
- An account switch in `gh` changes the observed approver; existing records
  bound to another account fail verification (`ERR_APPROVAL_APPROVER_CHANGED`).
- Self-declared agent or client metadata (`origin`) is recorded for audit
  with `verified: false` and is never read by verification (D3).

### 1.2 Approval record: fields and binding

The **canonical request** is immutable once written and is the only thing the
hash covers.

| Field | Type / format | Role |
|---|---|---|
| `schema` | `"lazyhub.approval/1"` | format and domain separation |
| `host` | lowercase host, optional `:port` | bound; compared |
| `repo.node_id` | GitHub node ID | bound; compared (rename-safe) |
| `repo.name_with_owner` | string | what the approver saw; not compared |
| `pr.node_id` | GitHub node ID | bound; compared |
| `pr.number` | positive safe integer | bound; display and check output |
| `base.ref` | branch name (no `refs/heads/`) | bound; compared |
| `base.sha` | 40 or 64 lowercase hex | bound; compared (observed base SHA) |
| `head.ref` | branch name | bound; compared |
| `head.sha` | 40 or 64 lowercase hex | bound; compared |
| `head.repo_node_id` | node ID | bound; must equal `repo.node_id` (forks unsupported, 2.4) |
| `operation` | `"merge"` only | bound; the only approvable operation |
| `policy_version` | `"lazyhub-approval-policy/1"` | bound; change invalidates |
| `evidence.schema_version` | integer (`EVIDENCE_SCHEMA_VERSION`) | bound; change invalidates |
| `evidence.digest` | 64 hex | what the approver saw (audit); not re-compared, see 1.4 |
| `evidence.observed_at` | ISO-8601 UTC, ms, `Z` | freshness at decision time |
| `coverage_class` | one of the four D7 states | recorded as computed; never an authority input |
| `approver` | object, see 1.1 | bound; compared by `node_id` |
| `origin` | `{declared_kind, label, verified:false}` | metadata only; never compared |
| `issued_at` | ISO-8601 UTC, ms, `Z` | bound |
| `expires_at` | ISO-8601 UTC, ms, `Z` | bound; enforced locally |
| `nonce` | 32 lowercase hex (128 bits, `crypto.randomBytes`) | uniqueness |

Derived identifiers:

- `request_hash = SHA-256( "lazyhub.approval/1\n" || canonical(request) )`,
  lowercase hex.
- `request_id = "lzap1_" + request_hash` (70 characters). This is the
  check-run `external_id` (D3). #245 must confirm GitHub accepts this length
  against current documentation; if not, the documented fallback is
  `"lzap1_" + first 40 hex`, and the full hash goes into the check output.

Stored **outside** the hash, in the same journal entry:

- `decision`: `approve` or `deny`.
- `untrusted.intent`: optional agent- or author-provided text, sanitized,
  at most 2000 characters, never read by any decision code (D4, T3, T4).

### 1.3 Relation to review Alpha

- Review Alpha (#177, #175, #127) runs without this module, the App, a
  config key, or any network call it adds. The approval code is not imported
  by any review-Alpha surface; a test enforces this (section 9).
- The evidence model (`src/executor/evidence.js`) is reused read-only for
  display and for the evidence digest. Evidence never becomes an authority
  input; the digest only records what was shown.
- Review progress, GitHub reviews and local decisions never create, extend
  or satisfy an approval (D12, GLOSSARY "Review concepts").

### 1.4 Ownership of the minimum contracts

| Contract | Owner | Notes |
|---|---|---|
| Canonical record, hash, request ID, test vectors | #235 | section 4 |
| Fixed policy constant, operation allowlist, TTL bounds | #235 (`src/approval/policy.js`) | replaces #148 for this stage |
| Evidence collection for the decision screen and evidence digest projection | #203 | reuses #175 evidence; digest projection in 3.6 |
| Fresh typed read of PR context and approver | #235 (`readApprovalContext`) | section 4.6 |
| Freshness rules (decision-time freshness, re-read before write) | #235 (store checks), #203 (UI re-read) | 2.2 |
| Durable decisions and integrity-linked journal | #235 | section 4.1 |
| Journal retention (D11, 90 days) and a read-only `verify-store` check | #237, narrowed to an approval-stage subset | activation prerequisite |
| Audit failure handling (fail closed) | #235 | 2.5 |
| Stable error set for approval | #235 (`src/approval/errors.js`) | absorbed by #146 later, codes unchanged |
| Check-run publication, read-back, uncertain outcomes | #244 (adapter), #245 (helper) | transition contract 1.6 |
| Minimal local safe mode for approvals | #203, as a narrowed #238 subset | 3.8 |
| Live proof | #141 | section 7 |

**Evidence version rule.** Verification compares `evidence.schema_version`
(the meaning of the facts) but not `evidence.digest`. Checks, reviews and
thread counts move legitimately after a decision and are gated by GitHub's
own required checks and reviews. The content the approval covers is fixed by
`head.sha` and `base.sha`, which are compared. This satisfies D1 ("binds
policy/evidence versions"); it does not weaken it.

### 1.5 Parked issues: what this stage needs

| Issue | Needed? | Decision |
|---|---|---|
| #145 `lazyhub serve` | **No.** | No agent submits requests in this stage, and approval runs in the TUI process with a short-lived helper child process (#245). The daemon, MCP and IPC must not expose approval operations. Revisit only if agent-submitted requests are activated from pilot evidence. |
| #148 policy engine | **No, replaced by a constant.** | A built-in policy `lazyhub-approval-policy/1`: `merge` is approvable by a human, every other operation is not approvable, forks and merge groups are unsupported, TTL bounds per 2.1. Changing any of these bumps the version, which invalidates existing records. |
| #236 agent identity | **No.** | Origin is unverified metadata. Approver identity per 1.1. Classification grants nothing. |
| #237 audit | **Partly.** | Required now (owned by #235): append-only, hash-linked, mode 0600 in a 0700 directory, fail closed, no prompts, diffs, bodies or credentials. Required before activation (narrow #237 to this subset with `stage:approval`): 90-day retention by segment rotation with a carried-forward chain checkpoint, and a read-only store check. Deferred: execution, reconciliation and recovery events (Beta, #255). |
| #238 safe mode | **Partly.** | Required for #203: a persistent local flag that blocks new approvals and success publication while leaving inspect, deny and revoke available; it is turned off only by a human-typed CLI command in a TTY. Deferred: agent-engaged safe mode over IPC, session expiry, remote token revocation automation. |
| #146 stable errors | **Partly.** | Approval error codes (4.5) are stable from the first commit and use the shape in #129's JSON comment so #146 can absorb them unchanged. |

**D11 assessment.** The journal meets D11 for this stage on identities,
request IDs, hashes, state transitions, permissions, integrity linking and
fail-closed behaviour. GitHub links (check-run URLs) arrive with #244's
publication events. Retention is the one open D11 item and is an activation
prerequisite. The journal is not described as immutable or tamper-proof
(#237 wording).

### 1.6 Transition contract (needed by #203 before #244 exists)

Two independent state machines per `request_id`.

**Decision state** (owned by #235, derived from the journal):

```
(new) --approve--> approved --revoke--> revoked
(new) --deny-----> denied
approved --(now >= expires_at)--> expired      (derived; an `expired` event is appended by sweepExpired)
approved --revoke after expiry--> revoked      (allowed; tightening is always allowed)
```

`approved` is the only state for which `verify()` can return `ok`, and only
when every bound precondition still matches.

**Publication state** (owned by #244; journal event type reserved now):

```
none --publish(kind)--> attempted --read-back match--> confirmed
                                  --read-back absent-> failed (safe to publish again)
                                  --no read-back-----> uncertain
uncertain --read-back match--> confirmed
uncertain --read-back absent--> failed
```

`kind` is `success` (from `approved`), `failure` with title "Approval
denied", "Approval revoked" or "Approval expired". Rules:

- Before any `success` publication, the adapter calls `verify()` with a fresh
  `readApprovalContext()` result. Any non-ok result publishes nothing.
- A publish is sent only after a read-back shows no check run with this
  `external_id` and this `kind`. Lazyhub never resends while the state is
  `uncertain` (T16).
- The interface #203 codes against:
  `publishApprovalCheck({ requestId, kind }) -> Promise<{ state:
  'confirmed'|'failed'|'uncertain', checkRunUrl?, code? }>` and
  `readBackApprovalCheck({ requestId }) -> Promise<same>`. Until #244 lands,
  #203 tests inject a fake implementation in-process. There is no environment
  variable or config switch that selects a fake publisher in a built binary.

### 1.7 Execution order (acyclic)

```
P0  This PR: design doc + #235 groundwork + #140 scaffold      (no prerequisites)
P1  #277 sandbox feasibility run          needs: M1, M2 (maintainer actions, section 7)
P2  #245 helper code with fake endpoint   needs: P0
P3  #245 live seeding                      needs: P2, M1, M2
P4  #244 adapter + ruleset verification    needs: P0, P3, P1 decisions confirmed
P5  #203 UI against the 1.6 interface      needs: P0 (may run in parallel with P2-P4)
P6  #203 wired to real publisher           needs: P4, P5
P7  Activation prerequisites: #237 subset (retention), #129 approval-screen polish
P8  #141 live proof (matrix run twice)     needs: P6, P7, M3
P9  #140 remaining journeys                needs: P6 (unit), P8 (live)
P10 Docs may describe the stage as available (default still off)   needs: P8, P9
```

ROADMAP currently lists #203 before #244. That stays valid: this section
defines the transition contract, so #203's UI can start at P5, while its
"publish and read back" acceptance criterion completes at P6.

---

## 2. #277 — Expiry, revocation and offline semantics

### 2.1 Defaults

| Item | Default | Bounds |
|---|---|---|
| Approval lifetime | 4 hours | 5 minutes to 24 hours; config (added by #203) may only lower the maximum |
| Decision-time evidence freshness | facts read at most 5 minutes before the decision | not configurable |
| Re-read before writing a record | always | not configurable |
| Clock skew tolerance | `issued_at` may not be more than 5 minutes ahead of local now | not configurable |
| Expiry sweep (when approval is enabled and the TUI runs) | on start, then every 5 minutes; at most 10 publications per sweep | not configurable in this stage |

### 2.2 Who invalidates an already-passing check

| Change | GitHub-side effect | Lazyhub action | Guarantee class |
|---|---|---|---|
| New head commit | New commit has no `lazyhub/approval`; merge blocked | `verify()` returns `ERR_APPROVAL_STALE_HEAD`; no publication | `github_enforced` once #141 proves it |
| Base advances, ruleset requires up-to-date branches | PR is out of date; merge blocked until updated, which creates a new head | `ERR_APPROVAL_STALE_BASE` locally | `github_enforced` once #141 proves it |
| Base advances, up-to-date not required | Nothing; the old pass still counts | local only | reported as an enforcement gap; setup (#244) requires up-to-date |
| Base ref retargeted | Not proven | `ERR_APPROVAL_STALE_BASE` locally; publish `failure` | `managed_gateway`; #141 records GitHub behaviour |
| Expiry | Nothing; a passing check does not expire on GitHub | sweep publishes `failure` "Approval expired" | `managed_gateway`; depends on Lazyhub running |
| Revocation | Nothing until Lazyhub publishes | immediate `failure` publication | `managed_gateway`; depends on reachability |
| Policy version change | Nothing | local `ERR_APPROVAL_POLICY_CHANGED`; next sweep publishes `failure` | `managed_gateway` |
| App removed after success | Not proven whether the existing pass still counts | none possible | unknown until #141; until then, documentation says "revoke first, then remove" |
| Same head SHA in a second PR (other base) | A check run attaches to the commit, so it is visible to every PR with that head | before `success`, the adapter lists open PRs with that head; more than one open PR blocks publication with `ERR_APPROVAL_UNSUPPORTED` | PR and base binding is `managed_gateway`; a PR opened later with the same head is a documented residual risk |
| Auto-merge already enabled | GitHub merges as soon as checks pass | decision screen states it and requires a second confirmation; revocation cannot undo a merge | stated, not mitigated |
| Fork PR | Not claimed | record creation refused, `ERR_APPROVAL_UNSUPPORTED` | unsupported until #141 records behaviour |
| Merge queue / merge group | Lazyhub does not report on merge-group commits, so the queue blocks | setup reports the branch as unsupported | unsupported; blocks rather than passes |

### 2.3 Local expiry versus GitHub-observed invalidation

- **Local expiry** is exact: `verify()` compares `expires_at` with the local
  clock and returns `ERR_APPROVAL_EXPIRED`. It takes effect immediately for
  every local operation, including any future publication.
- **GitHub-observed invalidation** happens only when a `failure` run is
  published and read back. Latency is the sweep interval plus publication time
  while Lazyhub runs and GitHub is reachable; it is unbounded otherwise.
- The UI never shows "expired" without also showing what GitHub currently
  reports (3.7).

### 2.4 Offline, disconnected, rate-limited, missing credentials

| Situation | Approve | Deny | Revoke | Shown to the user |
|---|---|---|---|---|
| Offline / GitHub unreachable | refused: the fresh context read fails, no record is written | recorded locally; publication `failed` | recorded locally; publication `failed` | "GitHub still shows passing" when the last confirmed run was success |
| Rate limited | record written only if the context read succeeded; publication `failed` with retry time | same | same | retry time from the response |
| Helper or App credentials missing | record may be written; publication `failed` with `ERR_APPROVAL_CREDENTIALS_MISSING`; merge stays blocked | same | same | remediation text |
| Lost acknowledgement | state `uncertain`; no resend | same | same | "Unknown whether GitHub received it" with a read-only re-check |
| Store unavailable or corrupt | refused | refused | refused (cannot append) | recovery guidance: disable auto-merge or remove the App's repository access on GitHub |
| Safe mode engaged | refused | allowed | allowed | banner |

### 2.5 What fails closed

- No record, no `success` publication.
- Any unknown, missing or non-canonical context field: no record.
- Context read failure, clock skew, stale facts: no record.
- Store I/O, lock timeout, parse error, broken hash link, request-hash
  mismatch: every create, verify and revoke fails with a store error; nothing
  is published.
- Any `verify()` failure: no `success` publication.
- Publication uncertainty: no automatic resend.
- Unsupported context (fork, merge group, multiple PRs on one head, operation
  other than merge): no record or no publication.

### 2.6 What does not fail closed (explicitly unsupported guarantees)

Expiry and revocation of an already-published pass while Lazyhub is not
running or cannot reach GitHub; App removal after success (until #141 shows
otherwise); a later PR reusing an approved head SHA; merges triggered by
auto-merge that was enabled before approval. None of these may be reported as
`github_enforced`.

### 2.7 Expected-outcome matrix (the #277 deliverable's "expected" column)

The "observed" column is filled by the sandbox run (P1) and again by #141.
Evidence is non-secret: ruleset JSON with IDs redacted, check-run name,
conclusion, `external_id`, head SHA, and the PR's merge-eligibility state.

| # | Scenario | Expected |
|---|---|---|
| E1 | PR with no `lazyhub/approval` | not mergeable |
| E2 | Same-name check from a source other than the App | not mergeable |
| E3 | App success on head H | mergeable (if other rules pass) |
| E4 | Push new commit H2 after E3 | not mergeable |
| E5 | Base advances after E3, up-to-date required | not mergeable until updated; then E4 |
| E6 | Base retargeted after E3 | record observed behaviour |
| E7 | App publishes failure after E3 (revocation) | not mergeable; confirm which run wins when several exist |
| E8 | Expiry with Lazyhub stopped | still mergeable (documented gap) |
| E9 | App uninstalled after E3 | record observed behaviour |
| E10 | Auto-merge enabled before E3 | GitHub merges; Lazyhub made no merge call |
| E11 | Second PR with head H to another protected base | record; expected mergeable (documented gap) |
| E12 | Fork PR | record whether the App can publish on the head SHA |
| E13 | Merge queue enabled | queue blocks without a merge-group check |
| E14 | Lost acknowledgement injected (fake endpoint) | state `uncertain`; no second POST before read-back |

E7 must also settle whether a newer run of the same name supersedes an older
one, or whether the existing run must be updated. The adapter design assumes
"a newer completed run from the same App supersedes"; if E7 shows otherwise,
#244 switches to updating the existing run and this doc is amended.

---

## 3. #203 — Merge-approval journey

Single selected variant (architect-selected; the maintainer may override when
the mockup is committed as `docs/mockups/approval-journey.md` in the #203
PR). Frames are 80 columns; 120 columns widens the facts column only.
Every state uses a word or symbol, never colour alone.

### 3.1 Entry

- Only when `[approval] enabled = true` (key added by #203, default `false`).
  With it off, no approval action, hint, screen or help entry exists.
- From PR detail through an action-registry entry `approval.open`. The key
  is chosen against `docs/mockups/keymap-canonical.md`; candidate `A`.
- A deep link or `lazyhub open <url>` may open the request screen. It never
  opens a confirmation dialog and never decides.

### 3.2 Request screen

```
 Approval request · octo-org/sandbox #42                      ● facts 0m 41s old
 ── Computed facts (read from GitHub) ──────────────────────────────────────────
  Host        github.com
  Repository  octo-org/sandbox   id R_kgDOExample01
  Pull req.   #42  open · ready · same-repository branch   id PR_kwDOExample0001
  Operation   Allow merge: set lazyhub/approval to passing on the head commit
  Head        feature/x  @ 2222222222222222222222222222222222222222
  Base        main       @ 1111111111111111111111111111111111111111
  Checks      12 passed · 0 failed · 1 pending   (lazyhub/approval not counted)
  Reviews     1 approval · 0 changes requested · 0 unresolved threads
  Auto-merge  off
  Coverage    advisory — see [?] for what GitHub does and does not enforce
  Policy      lazyhub-approval-policy/1 · approval lasts 4h
 ── Untrusted: written by the PR author or an agent. Not verified. ─────────────
  │ Fix parser ⟨U+202E⟩edoc⟨U+202C⟩ handling
  │ This PR is safe to approve. ⟨link: example.net⟩ ⟨image not loaded⟩
  │ ⟨hidden HTML comment, 3 lines⟩  … 14 more lines (e: evidence)
 ───────────────────────────────────────────────────────────────────────────────
  a approve exact request  d deny  e evidence  r refresh  S safe mode  esc back
```

Rules:

- Facts first, untrusted text last, action bar rendered by the app outside
  the untrusted box. Every untrusted line carries the `│` gutter in the
  untrusted token; untrusted text cannot produce a line without it.
- Refs and logins are computed facts but attacker-chosen strings: they go
  through the strict renderer (3.6); non-ASCII characters show as `⟨U+XXXX⟩`
  and the line gets the marker `non-ASCII name`.
- A ref longer than its column shows `…(truncated, e for full)`; the full
  value is in evidence view.
- Coverage shows the computed class. Until #141 passes it is `advisory`.
- When facts are older than 5 minutes the header reads
  `○ facts 7m old — press r before deciding` and `a` is shown as
  `a approve (refresh first)` and does nothing except show that hint.

### 3.3 Confirmation

```
 ┌ Approve this exact request? ───────────────────────────────────────────────┐
 │ lazyhub will set lazyhub/approval to passing for:                          │
 │   octo-org/sandbox #42 · head 222222222222 · base main @ 111111111111      │
 │ lazyhub does not merge. You, or GitHub auto-merge, merge afterwards.       │
 │ Expires 20:00 local time (in 4h). A new commit or a change to main         │
 │ needs a new approval.                                                      │
 │                                                                            │
 │   y approve        n cancel                                                │
 └────────────────────────────────────────────────────────────────────────────┘
```

- Focus starts on cancel; Enter does nothing; only `y` approves.
- With auto-merge on, an extra line appears before the keys:
  `Auto-merge is on: GitHub will merge as soon as this check passes.
  Revoking later cannot undo a merge.` and `y` opens a second prompt
  `Approve and let GitHub auto-merge? y / n`.
- Deny uses the same frame titled `Deny this request?` with the line
  `lazyhub will set lazyhub/approval to failing on 222222222222. Nothing is
  merged or closed.`

### 3.4 Changed since you looked

Shown when the re-read before writing differs from the displayed facts.
Nothing is recorded.

```
 ┌ The pull request changed ──────────────────────────────┐
 │ Head commit: 222222222222 → 444444444444                │
 │ Nothing was approved. Review the new facts, then decide │
 │ again.                                                  │
 │   r reload facts      esc back                          │
 └─────────────────────────────────────────────────────────┘
```

Other first lines: `Base main moved: 111111111111 → 555555555555`,
`Base branch changed: main → release`, `Approver account changed: octocat →
other`, `This PR now comes from a fork. Approval is not supported for forks.`

### 3.5 Outcomes

| Outcome | Exact text |
|---|---|
| Approve, confirmed | `Approved. GitHub shows lazyhub/approval passing on 222222222222 (checked 12:00:04). Request lzap1_ec07fe13.` |
| Approve, failed | `Approved in lazyhub, but GitHub was not updated: <reason>. The merge stays blocked. p try again.` |
| Approve, uncertain | `Approved in lazyhub. lazyhub could not confirm whether GitHub received the update and will not resend until it checks. c check GitHub again (read only).` |
| Deny, confirmed | `Denied. GitHub shows lazyhub/approval failing on 222222222222.` |
| Deny, failed | `Denied in lazyhub. GitHub was not updated: <reason>. The merge stays blocked unless an earlier approval passed. p try again.` |
| Revoke, confirmed | `Revoked. GitHub shows lazyhub/approval failing on 222222222222.` |
| Revoke, failed | `Revoked in lazyhub, but GitHub still shows passing: <reason>. Do not merge. p try again. To block merging without lazyhub: turn off auto-merge, or remove the lazyhub App's access to this repository.` |
| Revoke, uncertain | `Revoked in lazyhub. GitHub may still show passing; lazyhub will not resend until it checks. c check GitHub again (read only).` |
| Already merged | `This PR is already merged. Revoking records your decision but cannot undo the merge.` |

`<reason>` comes from the error catalog `humanHint` (4.5), never from raw
server text.

### 3.6 Strict rendering for this journey

A new pure function in `src/approval/safe-text.js` composes `sanitize()`
(unchanged) and then:

- shows C0/C1 controls (other than those `sanitize()` already removes), DEL,
  bidi controls (U+061C, U+200E, U+200F, U+202A-U+202E, U+2066-U+2069),
  zero-width and invisible characters (U+00AD, U+180E, U+200B-U+200D, U+2060,
  U+FEFF) and tag characters (U+E0000-U+E007F) as visible `⟨U+XXXX⟩`;
- renders Markdown links as `text ⟨link: host⟩`, images as
  `⟨image not loaded⟩`, raw HTML tags literally, and HTML comments as
  `⟨hidden HTML comment, N lines⟩` with the content available in evidence view;
- never fetches anything;
- for identifiers (refs, logins), escapes every non-ASCII code point and
  reports `nonAscii: true` so the screen can add the marker.

**Evidence digest projection** (owned by #203): SHA-256 over
`"lazyhub.evidence-digest/1\n" || canonical(projection)`, where the projection
is the shown values of head SHA, base ref, base SHA, check summary counts and
state (excluding `lazyhub/approval`), review counts, unresolved thread counts
and auto-merge state, with `"unknown"` kept as the string `"unknown"`.

### 3.7 Inspect

```
 Approvals · octo-org/sandbox                         SAFE MODE off
  STATE       PR   HEAD          ON GITHUB          EXPIRES     REQUEST
  ● approved  #42  222222222222  passing  ✓ read   in 3h 12m   lzap1_ec07fe13
  ○ expired   #40  aaaaaaaaaaaa  passing  ⚠ stale  2h ago      lzap1_9a1c0b2e
  × revoked   #39  bbbbbbbbbbbb  failing  ✓ read   —           lzap1_51d07a44
  − denied    #38  cccccccccccc  failing  ? unsure —           lzap1_07ee9f10
 ──────────────────────────────────────────────────────────────────────────────
  enter details  R revoke  c check GitHub (read only)  p publish again  esc back
```

`⚠ stale` means GitHub's last confirmed state disagrees with the local state.
Details show the full request, the journal entries for that request and the
check-run link.

### 3.8 Safe mode (narrow #238 subset)

- Engage: `S` →
  `Turn on approval safe mode? lazyhub will refuse new approvals until you
  run "lazyhub approval safe-mode off" in a terminal. Checks that already pass
  stay passing: revoke them here, or remove the lazyhub App's access on
  GitHub.` `y turn on / n cancel`.
- Banner on every approval screen: `SAFE MODE · approvals off · deny and
  revoke still work`.
- Persisted as a journal event; turning it off is a human-typed CLI command
  that requires a TTY and typing the repository-independent phrase
  `turn off safe mode`. No IPC, MCP or TUI path turns it off.

### 3.9 Error and loading states

| State | Text |
|---|---|
| Loading facts | `Reading pull request from GitHub…` (spinner plus text) |
| Facts unavailable | `Could not read the pull request from GitHub: <humanHint>. Nothing can be decided until facts load. r retry` |
| Store unavailable | `Approval records cannot be read (ERR_APPROVAL_STORE_CORRUPT). No approval can be made, changed or published. See "Recovery" in docs/design/optional-approval.md.` |
| Helper missing | `The lazyhub App is not set up for this repository, so GitHub cannot be updated. Approvals stay blocked.` |

---

## 4. #235 — Groundwork specification

### 4.1 Storage

- **Location:** `<config dir>/approvals/`, where `<config dir>` is the same
  `join(homedir(), '.config', 'lazyhub')` that `src/config/loader.js` uses.
  Do not introduce a new XDG rule. The store directory is injectable for
  tests (`openApprovalStore({ dir })`).
- **Permissions:** directory created with `ensurePrivateDir` and checked with
  `assertPrivateDir` on every open; files 0600 via `secure-fs`.
- **Files:** `approvals-v1.ndjson` (journal), `approvals-v1.lock` (writer
  lock). Separate from `audit.log`, which rotates and would break the chain.
- **Durability:** add an optional `{ fsync: true }` parameter to
  `appendPrivateFile` in `src/secure-fs.js` (backward-compatible; existing
  callers unchanged). The store always uses it.
- **Locking:** writer lock by exclusive create (`O_EXCL`) containing pid and
  timestamp; a lock older than 30 s whose pid is not alive may be removed;
  wait up to 2 s with backoff, then `ERR_APPROVAL_STORE_UNAVAILABLE`. Inside
  the lock: re-read and re-validate the whole journal, check conflicts,
  append, release.
- **Torn tail and Recovery** (last line without newline) is corruption: fail closed. Recovery
  is manual and documented: move the file aside, which makes every record
  unusable locally (safe direction), then revoke any check that GitHub still
  shows passing through the App removal path.

### 4.2 Journal entry format

One canonical JSON object per line.

```
{ v: 1, seq: <int from 1>, prev: <hex64 of previous entry, or 64 zeros>,
  at: <ISO>, type: "decided"|"revoked"|"expired"|"publication"|"safe_mode",
  ...type fields..., hash: <hex64> }
```

`hash = SHA-256("lazyhub.approval-journal/1\n" || canonical(entry without hash))`.

| `type` | Fields |
|---|---|
| `decided` | `request_id`, `request_hash`, `request` (canonical request), `decision`, `untrusted: { intent }` |
| `revoked` | `request_id`, `by` (approver object), `reason_code`: `user_revoked` or `safe_mode` |
| `expired` | `request_id` |
| `publication` | reserved for #244: `request_id`, `kind`, `state`, `check_run_id?`, `check_run_url?`, `code?`. The groundwork reader validates it; no groundwork code writes it |
| `safe_mode` | reserved for #203: `engaged: true|false`, `by` |

On every read: parse each line, check `seq` continuity, `prev` linkage,
`hash`, and for `decided` entries recompute `request_hash` and `request_id`.
Unknown `type` or `v` is corruption.

### 4.3 Canonicalization and hashing

- Values: objects, strings, safe integers, booleans. `null`, `undefined`,
  floats, arrays and non-plain objects throw `ERR_APPROVAL_INVALID_INPUT`.
- Object keys sorted by UTF-16 code unit (the default `Array.prototype.sort`
  on strings), no whitespace, strings and keys serialized with
  `JSON.stringify`. This equals RFC 8785 for the permitted value types.
- Hash input is the UTF-8 encoding of the domain prefix, a newline, then the
  canonical string. SHA-256 from `node:crypto`. No new dependency.
- Field validation before canonicalization: hosts lowercase
  `^[a-z0-9.-]+(:[0-9]{1,5})?$`; node IDs `^[A-Za-z0-9_=-]{1,100}$`; SHAs
  `^([0-9a-f]{40}|[0-9a-f]{64})$`; refs 1-255 characters, NFC-normalized
  (`s.normalize('NFC') === s`), no C0/C1, bidi, zero-width or tag characters;
  timestamps exactly the `Date.prototype.toISOString()` form; `origin.label`
  printable ASCII, at most 64 characters (else replaced by its escaped form);
  `origin.declared_kind` one of `human`, `agent`, `unknown`.

**Test vector 1** (commit to `src/approval/canonical.vectors.js` and repeat
in the committed doc):

Input request:

```json
{
  "schema": "lazyhub.approval/1",
  "host": "github.com",
  "repo": { "node_id": "R_kgDOExample01", "name_with_owner": "octo-org/sandbox" },
  "pr": { "node_id": "PR_kwDOExample0001", "number": 42 },
  "base": { "ref": "main", "sha": "1111111111111111111111111111111111111111" },
  "head": { "ref": "feature/x", "sha": "2222222222222222222222222222222222222222", "repo_node_id": "R_kgDOExample01" },
  "operation": "merge",
  "policy_version": "lazyhub-approval-policy/1",
  "evidence": { "schema_version": 1, "digest": "3333333333333333333333333333333333333333333333333333333333333333", "observed_at": "2026-11-07T12:00:00.000Z" },
  "coverage_class": "advisory",
  "approver": { "host": "github.com", "login": "octocat", "node_id": "U_kgDOExample", "auth_method": "gh_session_tty" },
  "origin": { "declared_kind": "unknown", "label": "", "verified": false },
  "issued_at": "2026-11-07T12:00:00.000Z",
  "expires_at": "2026-11-07T20:00:00.000Z",
  "nonce": "00112233445566778899aabbccddeeff"
}
```

Canonical string:

```
{"approver":{"auth_method":"gh_session_tty","host":"github.com","login":"octocat","node_id":"U_kgDOExample"},"base":{"ref":"main","sha":"1111111111111111111111111111111111111111"},"coverage_class":"advisory","evidence":{"digest":"3333333333333333333333333333333333333333333333333333333333333333","observed_at":"2026-11-07T12:00:00.000Z","schema_version":1},"expires_at":"2026-11-07T20:00:00.000Z","head":{"ref":"feature/x","repo_node_id":"R_kgDOExample01","sha":"2222222222222222222222222222222222222222"},"host":"github.com","issued_at":"2026-11-07T12:00:00.000Z","nonce":"00112233445566778899aabbccddeeff","operation":"merge","origin":{"declared_kind":"unknown","label":"","verified":false},"policy_version":"lazyhub-approval-policy/1","pr":{"node_id":"PR_kwDOExample0001","number":42},"repo":{"name_with_owner":"octo-org/sandbox","node_id":"R_kgDOExample01"},"schema":"lazyhub.approval/1"}
```

`request_hash`: `ec07fe13d7b42bb4f75b98e549154896598cf43c7382b60c66368aa23e82fa70`
`request_id`: `lzap1_ec07fe13d7b42bb4f75b98e549154896598cf43c7382b60c66368aa23e82fa70`

Key-order vector: `canonical({ b: "é", a: "x", B: 1 })` is
`{"B":1,"a":"x","b":"é"}`. Add vectors for: rejection of `null`, a float, an
array, a non-NFC ref, a ref containing U+202E, and an uppercase SHA.

### 4.4 Module API

Files (new directory `src/approval/`):

| File | Exports |
|---|---|
| `canonical.js` | `canonicalize(value)`, `hashRequest(request)`, `requestIdFor(hash)`, `validateRequest(request)` |
| `policy.js` | `APPROVAL_POLICY_VERSION`, `APPROVABLE_OPERATIONS` (`['merge']`), `TTL_DEFAULT_MIN` (240), `TTL_MIN_MIN` (5), `TTL_MAX_MIN` (1440), `FRESHNESS_MAX_MS` (300000), `CLOCK_SKEW_MAX_MS` (300000) |
| `errors.js` | `ApprovalError` (`code`, `category`, `retriable`, `message`, `humanHint`, `changed: string[]`), frozen `APPROVAL_ERRORS` |
| `store.js` | `openApprovalStore({ dir, now = () => new Date(), random = randomBytes })` |
| `index.js` | barrel |
| `canonical.vectors.js` | test vectors (data only) |

Plus `src/executor/approval-context.js` exporting `readApprovalContext({ repo,
number })`, re-exported from the `src/executor.js` barrel (4.6).

Store methods (synchronous, using `secure-fs`):

- `createApprovalRecord({ context, decision, evidence, coverageClass,
  origin?, untrustedIntent?, ttlMinutes? })` →
  `{ requestId, requestHash, record }`. Builds the request from `context`
  (output of `readApprovalContext`), fills `policy_version`, `issued_at`,
  `expires_at`, `nonce`; validates; refuses forks, non-`merge` operations,
  stale evidence, clock skew and TTL out of bounds; under the lock refuses
  when an `approved`, unexpired record exists for the same
  `(host, repo, pr, head.sha, base.sha, operation)` (`ERR_APPROVAL_CONFLICT`,
  for both approve and deny: revoke first); appends one `decided` entry.
- `verify(requestId, observed)` → `{ ok: true, record }` or
  `{ ok: false, code, changed: [...] }`. Never throws for a stale record;
  throws only for store errors. `observed` is a fresh `readApprovalContext`
  result. The current policy and evidence schema versions are read from code,
  not from the caller. Check order, first failure sets `code`, all failures
  fill `changed`: store integrity, not found, denied, revoked, expired
  (including a persisted `expired` event), clock, host/repo/PR context,
  unsupported (fork), head ref or SHA, base ref or SHA, policy version,
  evidence schema version, approver `node_id`.
- `revoke(requestId, { by, reasonCode = 'user_revoked' })` → record.
  Idempotent: revoking a revoked record returns it with `already: true` and
  appends nothing. Revoking an expired record appends `revoked`. Revoking a
  denied record returns `ERR_APPROVAL_DENIED`.
- `list({ host?, repoNodeId?, prNodeId?, state? })` → array of summaries
  `{ requestId, state, prNumber, nameWithOwner, headSha, baseRef, baseSha,
  issuedAt, expiresAt, approverLogin, publication }`, newest first, derived
  state computed with `now()`.
- `get(requestId)` → full record with its journal entries, or `null`.
- `sweepExpired()` → array of request IDs for which an `expired` entry was
  appended (approved records past `expires_at`). Not called by anything in
  the groundwork PR.

### 4.5 Stable error catalog

| Code | Category | Retriable | Meaning |
|---|---|---|---|
| `ERR_APPROVAL_NOT_FOUND` | approval | no | unknown request ID |
| `ERR_APPROVAL_INVALID_INPUT` | approval | no | missing, unknown or non-canonical field (`changed` names it) |
| `ERR_APPROVAL_UNSUPPORTED` | approval | no | fork, merge group, non-merge operation, head on several open PRs |
| `ERR_APPROVAL_CONFLICT` | approval | no | active approval already exists for this exact context |
| `ERR_APPROVAL_EVIDENCE_STALE` | approval | yes | facts older than 5 minutes at decision time |
| `ERR_APPROVAL_CLOCK` | approval | no | `issued_at` ahead of local clock, or `expires_at` not after `issued_at` |
| `ERR_APPROVAL_STALE_HEAD` | stale | no | head ref or SHA changed |
| `ERR_APPROVAL_STALE_BASE` | stale | no | base ref or SHA changed |
| `ERR_APPROVAL_CONTEXT_MISMATCH` | stale | no | host, repository or PR node ID differs |
| `ERR_APPROVAL_POLICY_CHANGED` | stale | no | policy version differs |
| `ERR_APPROVAL_EVIDENCE_CHANGED` | stale | no | evidence schema version differs |
| `ERR_APPROVAL_APPROVER_CHANGED` | stale | no | current `gh` account differs from the approver |
| `ERR_APPROVAL_EXPIRED` | stale | no | past `expires_at` |
| `ERR_APPROVAL_REVOKED` | stale | no | revoked |
| `ERR_APPROVAL_DENIED` | stale | no | denied |
| `ERR_APPROVAL_STORE_UNAVAILABLE` | store | yes | I/O, permissions or lock timeout |
| `ERR_APPROVAL_STORE_CORRUPT` | store | no | parse failure, broken link, hash mismatch, torn tail |
| `ERR_APPROVAL_CREDENTIALS_MISSING` | publication | no | reserved for #244/#245 |
| `ERR_APPROVAL_PUBLISH_FAILED` | publication | yes | reserved for #244 |
| `ERR_APPROVAL_PUBLISH_UNCERTAIN` | publication | no | reserved for #244; resolve by read-back only |

Each entry has a fixed `message` and `humanHint`. Codes never change once
merged.

### 4.6 Typed context read

`readApprovalContext({ repo, number })` runs one GraphQL query through
`runGh()` (owner and name with `-f`, number with `-F`) and returns
`{ host, repo_node_id, name_with_owner, pr_node_id, number, state, is_draft,
is_cross_repository, base_ref, base_sha, head_ref, head_sha,
head_repo_node_id, auto_merge_enabled, approver: { host, login, node_id },
fetched_at }`. GraphQL fields: `repository { id nameWithOwner pullRequest {
id number state isDraft isCrossRepository baseRefName baseRefOid headRefName
headRefOid headRepository { id } autoMergeRequest { enabledAt } } } viewer {
login id }`. `host` is `GH_HOST` (lowercased) or `github.com`, matching
`src/cli/doctor/coverage.js`. A missing field throws
`ERR_APPROVAL_INVALID_INPUT` naming it; nothing defaults to a safe value.
It is a read; it is not called from any existing module.

### 4.7 Invalidation rules (summary)

New head (ref or SHA), base ref or SHA change, host/repo/PR node mismatch,
expiry, revocation, denial, policy version change, evidence schema version
change, approver change: each makes `verify()` non-ok with the code in 4.5.
Repository rename or transfer that keeps the node ID does not invalidate.

### 4.8 Required tests

`src/approval/canonical.test.js`
- Vector 1 reproduces the canonical string, hash and request ID exactly.
- Key ordering vector; rejection vectors (null, float, array, non-NFC, bidi,
  uppercase SHA, bad timestamp form).
- Hash changes when any single bound field changes (table-driven over every
  field in 1.2, including `nonce` and `approver.node_id`).

`src/approval/store.test.js` (store in a temp dir; injected clock and random)
- Approve, deny, revoke, expire, get and list are durable across reopen and
  attributable (approver recorded on `decided` and `revoked`).
- `verify()` returns ok for an unchanged context; returns the exact code and
  `changed` list for each of: head SHA, head ref, base SHA, base ref, host,
  repo node ID, PR node ID, policy version (stubbed constant), evidence
  schema version, approver, expiry (clock advanced), revocation, denial.
- Repository rename (same node ID, new `name_with_owner`) stays ok.
- Fork context (`head_repo_node_id` differs) is refused.
- Two records for the same context differ by nonce and request ID; the second
  approve while the first is active is `ERR_APPROVAL_CONFLICT`.
- Concurrency: two child processes (`child_process.fork` of a small fixture
  script) approve the same context at once; exactly one `decided` entry
  results and the other gets `ERR_APPROVAL_CONFLICT`; the chain stays valid.
- Corruption: edit one byte, delete a middle line, break `prev`, truncate the
  last newline, change a stored request without changing its hash; each makes
  create, verify and revoke fail with `ERR_APPROVAL_STORE_CORRUPT`.
- Permissions: the directory is 0700 and the journal 0600 (POSIX only);
  a symlinked journal is refused.
- Untrusted intent is stored, returned by `get`, and has no effect on
  `request_hash` or `verify`.
- Stale evidence (older than 5 minutes) and clock skew are refused.
- `sweepExpired()` appends one `expired` entry per expired approval and is
  idempotent.
- The record contains no field named or valued like a token, no PR body, no
  diff (assert on the serialized journal).

`src/executor/approval-context.test.js`
- With gh fixtures: correct argv (`-F` for number, `-f` for strings), full
  mapping, and `ERR_APPROVAL_INVALID_INPUT` for each missing field.

`src/approval/isolation.test.js`
- No file under `src/` outside `src/approval/` imports `src/approval/`
  (tests excluded). `readApprovalContext` is imported only by
  `src/approval/` and tests.
- No file in `src/approval/` imports a mutating executor function, calls
  `gh pr merge`, a review endpoint, or `check-runs` with a write method, or
  opens a network connection.

---

## 5. #129 — Polish split

| Item | Today's screens | Approval screens |
|---|---|---|
| Decision hints and key registration | tracked by #312 / #453 | in the #203 mockup (3.2, 3.7) |
| Structured errors with request IDs | #454 / #469 for current errors | approval errors carry `code` and request ID (3.9, 4.5) |
| Loading, disconnected, stale, recovery | #454 / #486 | 3.2 freshness, 3.9 |
| NO_COLOR and high contrast; meaning not by colour alone | #460 | every state has a word or symbol (3.7) |
| Stable layout at 80 and 120 columns | existing budget tests | #203 PTY tests at both widths |
| Focus visibility for approve and safe-mode controls | not applicable | #203 |
| JSON error variant | waits for #146 formatter | catalog shape already matches |

Nothing in #129 is implemented by the groundwork PR. #129 stays open and is
satisfied by #203 plus the #146 formatter.

---

## 6. #140 — Journeys

| ID | Journey | Testable now? | How |
|---|---|---|---|
| J1 | Watch-only reports without claiming enforcement | yes | unit over `src/watch-only/report.js`: no operation is ever `github_enforced`; the existing watch-only CLI test covers the stub-gh path |
| J2 | Another source cannot satisfy the check | no | #244 adapter (unit) then #141 (live) |
| J3 | New head or base invalidates approval | yes (local half) | `verify()` with changed head/base; GitHub half in #141 E4/E5 |
| J4 | Unknown agent write denied, reads still work | yes | existing MCP server module with stub gh; assert write tools are absent or refused and a read succeeds |
| J5 | Policy/audit loss blocks writes, no fallback | partly | approval store corrupt or unavailable blocks create and verify (unit); daemon part already covered by `src/daemon/fallback.js` tests, referenced not duplicated |
| J6 | Ambiguous outcome reconciles before retry | no | #244 with #245 fake endpoint (E14) |
| J7 | Safe mode blocks writes; revocation guidance available | no | #203 safe-mode subset |
| J8 | Control text cannot spoof the approval screen | no | #203 `safe-text.js` snapshots, then PTY |
| J9 | Alternate credentials lower coverage | yes | `src/cli/doctor/coverage.js` with detected alternate path returns `advisory` or `ungoverned` |
| J10 | Privileged workflow rerun asks or denies | yes (deny half) | agent surfaces expose no rerun; "ask" is Beta |

**Scaffold.** One file, `src/security-journeys.test.js`, with a
`JOURNEYS` table (`id`, `title`, `blockedOn: number[]`). Runnable journeys
are real `it(...)` tests that import production modules (no copies of other
tests). Blocked journeys are `it.todo('J6 … blocked on #244, #245')`, so the
gap is visible in test output; this is tracking, not a placeholder
implementation. If a runnable journey needs a refactor to be reachable,
leave it as `it.todo` with the reason and say so in the PR body.

PTY journeys (later, in `test/pty/`, using `installShim` with a new
`approval` fixture set for the context query): J7 and J8 at 80 and 120
columns, and the full #203 journey with an in-process fake publisher in the
Ink interaction tests (not in the built binary).

---

## 7. #244, #245, #234, #141 — Maintainer actions and preparable code

### Maintainer actions

**M1 — Sandbox repository (for #277, #141).** Create a new private,
disposable repository under the maintainer's account, for example
`<owner>/lazyhub-approval-sandbox`, with one seed commit on `main`. Never use
the lazyhub repository. Write its cleanup steps (delete repository, uninstall
App) into `docs/MANUAL_TEST_PLAN.md` before the first run.

**M2 — Checks-only GitHub App (#245).** Register a GitHub App owned by the
maintainer:
- Repository permissions: **Metadata: read** (mandatory) and **Checks: read
  and write**. Nothing else: no Pull requests, Contents, Administration,
  Workflows, Secrets, Actions or organization permissions.
- Webhook: inactive. No callback or setup URL needed.
- "Only on this account".
- Install on **only the sandbox repository**.
- Generate one private key and store it in the platform credential store
  (macOS Keychain) outside any repository or config file. Record the App ID
  and installation ID locally; redact both from shared evidence.
- Rotation: generate a new key, update the store, delete the old key in the
  App settings. Removal: uninstall the App, then delete it.

**M3 — Ruleset (#244, #141).** After the App has published one seeded check
on the sandbox (P3, so GitHub lists it as a source), create a branch ruleset
for `main` manually as the repository owner: require status check
`lazyhub/approval` with its source set to the App; require branches to be up
to date; block force pushes and deletion; **no bypass actors**. Do not grant
the App any ruleset or administration permission. Merge queue off.

**M4 — PR authors for #141.** A second account or a cloud coding agent with
access to the sandbox only, to open "agent-authored" and "unknown" PRs. Can be
deferred until P8.

**M5 — Issue hygiene.** Narrow #237 and #238 to the approval-stage subsets in
1.5 with `stage:approval` (or open two narrow issues and link them); leave the
rest demand-gated.

### Code that can be prepared without claiming enforcement

| Issue | Preparable now | Not before maintainer action |
|---|---|---|
| #245 | Allowlisted endpoint table; App JWT (RS256 via `node:crypto`) and installation-token request (`repository_ids: [id]`, `permissions: { checks: 'write' }`) builders; proxy policy that ignores inherited proxy variables; local fake HTTPS endpoint for tests; tests that the token never reaches env, logs, IPC or audit | live seeding (needs M1, M2) |
| #244 | Pure mapping from a verified record to a check-run payload (`name`, `head_sha`, `status`, `conclusion`, `external_id`, output title and summary with expiry and request ID); read-back matcher filtered by App ID and `external_id`; the one-open-PR-per-head guard; ruleset reader that reports bypass actors and the up-to-date flag | ruleset verification against a real ruleset (M3) |
| #234 | Lint-invariant test that only the helper module may read the key; doctor already reports alternate paths and stays the owner of downgrades | PAT rejection and key isolation proof need the helper |
| #141 | Harness skeleton reading a redacted config file, the E1-E14 matrix as data, evidence writer that strips IDs | every live row (M1-M4) |

Each preparation is its own PR (one lane each), says "no enforcement claim"
in its body, and is not wired into the default path.

---

## 8. Issue table for the groundwork PR

The groundwork PR contains: `docs/design/optional-approval.md` (this doc),
`src/approval/*`, `src/executor/approval-context.js` plus its barrel export,
the `appendPrivateFile` fsync option, the tests in 4.8, the #140 scaffold,
and the doc updates listed in the #278 row.

| Issue | Keyword | Why / what remains |
|---|---|---|
| #278 | **Fixes**, only if the PR also: adds a short D17 entry in `docs/ARCHITECT_DECISIONS.md` pointing to this doc and listing the narrowed dependencies (1.5) as an explicit, reviewed amendment that leaves D1-D11 unchanged; updates `docs/ROADMAP.md` with the order in 1.7 and accurate status; adds the unsupported guarantees (2.6) to `docs/THREAT_MODEL.md` under T1/T11/T16; states in `docs/CONTRACT.md` that approval has no machine-facing contract yet. Otherwise **Part of**. The maintainer still performs M5. |
| #277 | **Part of** | Decisions and the expected matrix are done. Remaining: the observed column from the sandbox run (P1, needs M1-M3), the fault-injection run for E14, and the `docs/MANUAL_TEST_PLAN.md` entries. |
| #203 | **Part of** | Journey, wording and states are decided. Remaining: committed mockup file, `[approval] enabled` key, UI, `safe-text.js`, safe-mode subset, interaction and PTY tests, wiring to #244. |
| #235 | **Fixes**, only if every test in 4.8 exists and passes and `readApprovalContext` ships. Otherwise **Part of**. Not covered by #235 and tracked elsewhere: retention (#237 subset), publication (#244). |
| #129 | **Part of** | Approval-screen items land with #203; JSON formatter with #146. |
| #140 | **Part of** | Scaffold plus J1, J3, J4, J5 (partial), J9, J10 (deny). Remaining: J2, J6, J7, J8, J5 daemon half if not already referenced, live halves via #141. |
| #244 | Part of (doc only) | Nothing implemented. Remaining: everything in section 7, needs M3. |
| #245 | Part of (doc only) | Nothing implemented. Remaining: helper code, then live seeding, needs M1-M2. |
| #234 | Part of (doc only) | Nothing implemented. Remaining: key-isolation test and PAT rejection after #245. |
| #141 | Part of (doc only) | Nothing implemented. Remaining: harness and two live runs, needs M1-M4 and P6-P7. |

---

## 9. Constraints the implementation must respect

1. Do not change `merge.*` config or behaviour, `identities`,
   `trustedAuthors`, or `sanitize()` and its call sites. The strict renderer
   (#203) composes `sanitize()`; it does not modify it.
2. No new network call on the default path. `readApprovalContext` exists but
   nothing outside `src/approval/` imports it; the isolation test enforces
   this.
3. No telemetry, analytics, crash reporting or phone-home.
4. No merge, no review submission, no check-run write, no raw HTTPS, no
   Octokit, no new dependency in the groundwork PR. All GitHub reads go
   through `runGh()`; GraphQL integers use `-F`, strings `-f`.
5. No IPC, daemon, MCP, CLI or UI surface for approval in the groundwork PR,
   and no config key. `src/daemon/protocol.js` privileged types are not
   extended.
6. Do not reuse or rotate `audit.log` for approval records; the journal is
   separate. Do not call it immutable or tamper-proof.
7. No prompts, diffs, PR bodies, comment bodies or credentials in records.
   Agent intent is length-bounded and outside the hash.
8. Inject `now` and `random`; no `Date.now()` or `Math.random()` inside the
   module. Tests are hermetic: the store directory is a temp dir and the real
   `~/.config/lazyhub` is never touched.
9. `appendPrivateFile` change is additive and backward-compatible.
10. Do not edit `docs/FILE_MAP.md`; do not bump pinned versions.
11. ROADMAP, README and docs must not say approval is available, enforced or
    protecting anything. Coverage stays `advisory` in every report until #141
    passes.
12. The PR body names threats T1, T3, T9, T10, T11, T12, T14, T16, T20 and
    T21 with mitigation and residual risk (AGENTS invariant 18).
13. Public wording only: describe threat classes, never step-by-step bypasses.
14. Run the full gate (`npm run lint && npm test && npm run build && npm run
    typecheck`) and report only what was observed.
15. No `Co-Authored-By` trailers in commits or the PR body.

---

## 10. Amendment (D17)

> **D17 — Optional approval runs without the gateway service (2026-11-07).**
> For `stage:approval`, approval decisions are made only by a human in the
> interactive TUI, recorded in a local hash-linked journal, and reflected only
> through the App-pinned `lazyhub/approval` check. No agent submits approval
> requests in this stage, so #145, #148 and #236 are not prerequisites; a fixed
> policy constant replaces the policy engine; the minimum audit (#237) and
> safe-mode (#238) subsets in `docs/design/optional-approval.md` are
> approval-stage prerequisites. Expiry and revocation of an already-passing
> check are Lazyhub-mediated and never reported as `github_enforced`. D1-D11
> are unchanged; activating agent-submitted requests requires a new decision.
