# GHES: `field 'statusCheckRollup' doesn't exist on type 'PullRequest'`

- **Area:** prs, evidence, issues (all GraphQL reads), onboarding on GitHub Enterprise Server
- **Symptom:** a GHES user sees `github returned an error: gh: field 'statusCheckRollup' doesn't exist on type 'PullRequest'` on the first PR list.
- **Root cause:** `PR_ROW_FIELDS` and the legacy list query in `src/executor/prs.js` selected `statusCheckRollup` directly on `PullRequest` (and `checkRunCountsByState`, which is newer still). Older GHES schemas lack them; GraphQL rejects the whole document.
- **Fix:** PR-level selections moved to the head commit (`commits(last: 1) { nodes { commit { statusCheckRollup } } }`, already used by evidence), normalizers read that path, output unchanged. New `schema` failure kind in `classifyGhFailure`; `withSchemaFallback` retries once with a documented lower-capability variant and remembers it per host (`rollupCounts`, `isRequired`, `closeReason`). github.com keeps the full queries and never retries. Field audit and minimum versions: `docs/COMPATIBILITY.md`.
- **Regression test:** `src/executor/ghes-compat.test.js` (fake gh rejecting each field with the GHES error text: list, row, detail, queue, evidence, timeline; github.com adds no call).
- **Sibling sweep:** every GraphQL document under `src/executor/` audited (table in `docs/COMPATIBILITY.md`); daemon and MCP adapters only consume the normalized `statusCheckRollup` array, unchanged.

## Onboarding matrix addition (see `onboarding-install-auth.md`)

| ID | Scenario | Result | Notes |
|---|---|---|---|
| B13 | GHES-only login, GHES older than the field's release | PASS (fake gh) | PR list, detail, queue and evidence load; required checks show `unknown`; check counters computed from nodes. Not run against a real old GHES. |
