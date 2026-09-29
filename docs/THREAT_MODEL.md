# Threat Model

## Purpose

Lazyhub helps a maintainer observe agent activity and record approval for a
GitHub-enforced required check. It does not make arbitrary same-user processes
safe, and Alpha does not execute merges or other GitHub mutations.

The design goals are:

1. no silent failure;
2. no security claim without evidence;
3. bounded credential and repository blast radius.

## Alpha boundaries

Alpha is for solo maintainers and pilot repositories.

- Slice 1 observes GitHub-side activity, disables unsafe agent write paths,
  hardens shipped local surfaces, reports coverage, and establishes a verifiable
  npm release path.
- Slice 2 stores exact approval records and updates the App-pinned
  `lazyhub/approval` check. It never executes a merge.
- Team availability and an always-on verifier are Beta work.
- Native payload-bound human-presence signing is post-Alpha work.

## Coverage vocabulary

| State | Meaning |
|---|---|
| `github_enforced` | GitHub itself blocks the operation unless the required App-sourced condition is satisfied. |
| `managed_gateway` | Lazyhub mediates the operation, but a same-user or alternate credential path can bypass it. |
| `advisory` | Lazyhub observes and reports; it does not block. |
| `ungoverned` | Lazyhub has neither reliable observation nor enforcement evidence. |

Coverage is per operation, never a blanket repository badge. Missing evidence,
stale observation, alternate credentials, ruleset bypass actors, or partial API
results downgrade the state.

## Check integrity: who can turn it green

The protected branch requires `lazyhub/approval`, pinned to the repository's
user-owned Lazyhub App integration. A same-name status from another actor does
not satisfy the rule.

Only the minimal credential helper holds access to the App private key. For one
approval it:

1. validates the canonical approval record;
2. mints a fresh installation token restricted to one repository and
   `checks:write`;
3. updates one check bound to the approved commit and request ID;
4. discards the token without returning, caching, persisting, logging, or
   exporting it.

The helper has a narrow HTTPS exception for allowlisted GitHub App
authentication, token, and check endpoints. It ignores inherited proxy
variables and uses a proxy only when explicitly configured by Lazyhub.

Alpha does not claim that a generic keychain prompt binds human intent to the
displayed payload. A local agent running as the same OS user may influence or
invoke local software, so local-agent merge approval is `managed_gateway`.
Eligible cloud agents cannot reach the local helper and may be
`github_enforced` after App-source, ruleset, and alternate-path verification.

Native macOS confirmation will be evaluated separately. It must display and
cryptographically bind the exact repository, PR, operation, head SHA, observed
base SHA, policy/evidence versions, expiry, and nonce to one user-presence event.
Until that proof exists, it does not upgrade the local-agent coverage claim.

## Trust assumptions

- GitHub correctly enforces the configured ruleset and App source.
- The maintainer controls repository administration and reviews bypass actors.
- Cloud agents do not have access to the maintainer's local credential helper.
- A fully compromised OS, kernel, GitHub account, App owner account, or release
  signing identity is outside Alpha's prevention boundary, but recovery and
  blast-radius controls still apply.
- Classification of work as human or agent is never trusted for authorization.

## Threat checklist

### T1 - False sense of safety

Mitigation: operation-level coverage states, downgrade reasons, and explicit
Alpha limitations. Residual risk: users may still ignore warnings or weaken
other repository controls.

### T2 - Credential and release honeypot

Mitigation: user-owned Apps, checks-only permission, one-repository tokens,
trusted npm publishing, provenance, and no central private-key store. Residual
risk: a compromised release can target each local installation.

### T3 - Approval fatigue and persuasion

Mitigation: exact requests, no batch approval, computed facts before untrusted
agent prose, and revocable records. Residual risk: humans can still approve a
harmful request.

### T4 - Targeted prompt injection

Mitigation: repository content and agent intent never resolve authority; agent
writes are disabled in Slice 1. Residual risk: untrusted text can still persuade
the human or exploit an external tool.

### T5 - Harmful composition

Mitigation: canonical operation identity, policy/evidence versions, budgets,
and no Alpha execution. Residual risk moves to Beta execution and plan policy.

### T6 - Exfiltration through allowed writes

Mitigation: non-merge writes remain disabled in Alpha; approval UI exposes
hidden Markdown/HTML and never fetches remote media. Residual risk returns when
Beta enables operation-specific writes.

### T7 - Alternate and unobserved paths

Mitigation: every protected-branch PR is gated; doctor reports SSH, credential
helpers, direct clients, other MCP servers, bypass actors, and unknown paths.
Residual risk: local operations that never reach GitHub cannot be observed.

### T8 - Governance erosion

Mitigation: read-only defaults, explicit coverage downgrades, no human-PR
exemption, and separate team availability work. Residual risk: repository
administrators can weaken or remove the ruleset.

### T9 - Audit data liability

Mitigation: store hashes, identities, state transitions, and links rather than
full prompts/diffs; permission-restricted files and retention limits. Residual
risk: metadata can still reveal private repository activity.

### T10 - Accountability confusion

Mitigation: separate App, agent/session, and human identities; correlate the
check `external_id` with the request ID. Residual risk: GitHub's audit log shows
the shared App for Alpha check operations.

### T11 - Time of check to time of use

Mitigation: bind head/base SHAs and policy/evidence versions; invalidate stale
approval; Alpha performs no merge. Residual risk: future execution needs
immediate revalidation and reconciliation.

### T12 - Identity spoofing

Mitigation: self-declared client data and PR classification are metadata only;
authority comes from server-side session and approval state. Residual risk:
same-user compromise can attack local enrollment and remains managed.

### T13 - Resource-type confusion

Mitigation: typed resources and node IDs; all current agent mutations are
disabled pending runtime validation. Residual risk: future GitHub APIs can add
new overlapping resource forms.

### T14 - Name normalization and redirects

Mitigation: bind host and GitHub node IDs, not display names alone. Residual
risk: incomplete API responses must downgrade or block decisions.

### T15 - Workflow reruns with secrets

Mitigation: workflow execution is outside approval-only Alpha and remains
disabled for agents. Residual risk: users and other GitHub integrations retain
their existing workflow authority.

### T16 - Missing idempotency

Mitigation: Alpha only updates a commit-bound check from an exact request ID.
Mutation markers, crash recovery, and reconciliation are Beta requirements.
Residual risk: a network loss during check publication requires authoritative
read-back before another update.

### T17 - Rate limits and account safety

Mitigation: watch-only reports truncation/rate-limit gaps and Alpha disables
agent comment bursts. Residual risk: other clients share the account quota.

### T18 - Deep links and notifications

Mitigation: links may open but never decide a request; no private content leaves
the machine through telemetry or notifications by default. Residual risk:
GitHub itself delivers repository notifications according to user settings.

### T19 - Supply chain compromise

Mitigation: trusted npm publishing, provenance, package-content inspection,
checks-only App permissions, and minimal helper scope. Residual risk: dependency,
maintainer-device, and build-runner compromise still require monitoring.

### T20 - Text and terminal spoofing

Mitigation: escape ANSI/OSC, C0/C1 controls, bidi and zero-width characters;
surface hidden Markdown/HTML and confusable identifiers. Residual risk: visual
confusables cannot be eliminated completely.

### T21 - Cross-agent data leakage

Mitigation: typed cache keys include host, account, repository node ID, session,
and operation class; sensitive payloads are not cached. Residual risk: shared
OS resources and logs remain defense-in-depth boundaries.

## Reporting and response

Do not publish working exploit instructions, tokens, private repository data, or
patch-sensitive bypass details in issues. Use GitHub private vulnerability
reporting or a draft repository security advisory. Rotate exposed credentials
first, then preserve evidence, contain the affected App/ruleset, patch, verify,
and only then coordinate public disclosure.
