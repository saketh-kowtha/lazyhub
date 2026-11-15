# Compatibility

lazyhub is a terminal UI, but several surfaces are depended on by scripts,
agents, and editor integrations. Treat the following as stable within a major
version.

## Never Break Silently

- CLI command names: `status`, `doctor`, `serve`, `mcp-server`, `--mcp`,
  `--debug-state`, `perf report`.
- Machine-readable output fields once documented in `CONTRACT.md`.
- MCP tool names and aliases listed in `CONTRACT.md`.
- TOML config keys shipped in `src/config/defaultConfig.toml`.
- Default panes: `focus`, `prs`, `issues`, `branches`, `actions`,
  `notifications`.
- Default keybinding action IDs in `[actions]` and default keymaps in
  `[keymaps]`.
- Exit behavior for status-bar commands: `lazyhub status` must not fail or hang
  when the cache is cold.

## TOML Config

Config keys are migrated, not silently removed. The migration mechanism is
`src/config/migrate.js`; removals require a major version unless a migration can
preserve behavior.

Question rule: if a future change asks "may I rename this TOML key?", the answer
is no within the same major version. Add the new key, migrate the old one, warn
for one minor release, then remove only in the next major.

## Deprecation Procedure

1. Announce the replacement in release notes.
2. Keep the old behavior working for one minor release.
3. Emit a warning when the deprecated path is used.
4. Remove only in the next major version.

## Exit Codes

Current state is inconsistent and intentionally documented as such:

- `lazyhub status` returns 0 for warm and cold cache, and 2 for invalid args.
- `--debug-state` exits 0 on success.
- MCP tool errors are encoded in JSON-RPC content with `isError: true`.

A stable error-code catalog is tracked separately; do not invent ad-hoc numeric
codes in new machine surfaces.

## JSON Schema Versions

New JSON-producing commands should include `schema_version`. Existing surfaces
without that field are compatibility gaps, not a precedent to copy.

## GitHub Enterprise Server GraphQL schema

lazyhub reads GitHub through GraphQL documents under `src/executor/`. An older
GitHub Enterprise Server (GHES) schema lacks some fields, and GraphQL rejects the
whole document when one field is missing (`Field 'x' doesn't exist on type 'Y'`).
Rules:

- github.com always gets the full queries. A schema error there is a bug and is
  not retried.
- On any other host, `classifyGhFailure` reports the error as kind `schema`
  (`src/executor/classify.js`). `withSchemaFallback` (`src/executor/schema-compat.js`)
  then retries ONCE with the lower-capability variant named in the table, and
  remembers the degraded capability per host for the session, so later calls skip
  the failing document.
- A degraded field is never dropped silently (D16): the data shows as unknown or
  unavailable, or as a lower bound (`✗ 2+/150`).
- Approval binding (`approval-context.js`) has no fallback by design: it fails
  closed (THREAT_MODEL, invariant 17).

"Minimum GHES" is `unverified` unless a source is given: GitHub does not publish a
per-field GHES matrix in the public docs, and the schema reference for each GHES
version is the authority (`https://docs.github.com/en/enterprise-server@<version>/graphql/reference/objects`).
`Commit.statusCheckRollup` is documented in the GHES 3.16 to 3.19 and github.com
`commits` reference pages (`https://docs.github.com/en/enterprise-server@3.17/graphql/reference/commits`);
No documentation or changelog entry for `PullRequest.statusCheckRollup`, and a GHES host
rejects it (see `docs/bugs/ghes-schema-compat.md`).

| Document (file) | Field or argument | Minimum GHES | Status in lazyhub |
|---|---|---|---|
| PR list, row, legacy list (`prs.js`) | `PullRequest.statusCheckRollup` | not documented; missing on the reporting host | REMOVED. Read from `commits(last: 1) { nodes { commit { statusCheckRollup } } }` on every host |
| PR row (`prs.js`) | `StatusCheckRollupContextConnection.checkRunCountsByState`, `statusContextCountsByState` | unverified (newer than the rollup) | capability `rollupCounts`. Variant: first 100 context nodes, counters computed from them; `partial: true` (shown as `N+`) when the PR has more |
| Evidence detail (`evidence-detail.js`) | `CheckRun.isRequired(pullRequestNumber:)`, `StatusContext.isRequired` | unverified | capability `isRequired`. Variant: none can answer; required checks are `unknown` with the reason in the detail errors |
| Issue timeline (`issue-timeline.js`) | `ClosedEvent.stateReason` | unverified (github.com added it in 2022) | capability `closeReason`. Variant: no `stateReason`; the close event shows no reason |
| Evidence queue and record (`activity.js`, `evidence.js`) | `Commit.statusCheckRollup` | documented, long standing | none needed; this is the path the PR documents now use |
| Evidence (`activity.js`) | `PullRequest.latestOpinionatedReviews`, `reviewThreads`, `reviewRequests`, `mergeable`, `reviewDecision`, `changedFiles` | unverified, old fields | none; a missing field surfaces as the classified `schema` notice, and `evidence.js` already maps an absent selection to `unknown` |
| Evidence and files (`evidence-detail.js`, `pr-files.js`, `collisions.js`) | `PullRequestChangedFile.changeType`, `PullRequest.files` | unverified | none (surfaces the classified `schema` notice) |
| Review delta (`pr-story.js`) | `PullRequest.viewerLatestReview` | unverified | none (surfaces the classified `schema` notice) |
| Approval context (`approval-context.js`) | `PullRequest.autoMergeRequest`, `isCrossRepository`, `baseRefOid`, `headRepository`, `viewer.id` | unverified | none by design: fails closed |
| PR row, legacy list (`prs.js`) | `PullRequest.autoMergeRequest` | unverified (auto-merge shipped in GHES 3.1) | none |
| Comments (`pr-comments.js`) | `reviewThreads`, `PullRequestReviewThread.isResolved`, `resolveReviewThread` | unverified, old | none |
| Activity (`activity.js`) | `HEAD_REF_FORCE_PUSHED_EVENT` item type, `Commit.authors`, `checkSuites`, `rateLimit`, `mergedBy` | unverified, old | none |
| Issues (`issues.js`) | `search(type: ISSUE)`, `Issue.comments.totalCount` | old | none |
| Branches (`branches.js`) | `pullRequests(states: OPEN)`, `isCrossRepository` | old | none |
| `mergeQueueEntry`, `latestReviews` | not queried by lazyhub | n/a | n/a |

`gh pr view --json statusCheckRollup` (preview, `getPR`, branches) is `gh`'s own query: gh builds
it from the commit rollup, so it is not a lazyhub GraphQL document.
