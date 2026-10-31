# Machine Contract

This document records the current machine-facing lazyhub surface. It documents
what exists today; schema-version and error-code gaps are listed as gaps for
follow-up issues rather than normalized here.

## CLI JSON Paths

### `lazyhub --debug-state`

Inputs: none.

Side effects: writes a debug-state JSON file under `~/.cache/lazyhub/` and
prints a pointer plus the captured state.

Idempotency: not idempotent; each run writes a timestamped file.

Example:

```json
{
  "path": "/Users/saketh/.cache/lazyhub/debug-state-2026-06-13T12-05-25-835Z.json",
  "state": {
    "generatedAt": "2026-06-13T12:05:25.835Z",
    "version": "26.6.2",
    "node": "v22.20.0",
    "platform": { "name": "darwin", "arch": "arm64" },
    "terminal": { "columns": null, "rows": null, "term": "dumb" },
    "app": {
      "activePane": null,
      "view": null,
      "itemNumber": null,
      "filters": {},
      "cursors": {},
      "dialog": null,
      "mode": null
    },
    "ghCalls": [],
    "recentStatus": []
  }
}
```

Known gaps: no `schema_version` field and no stable error code catalog.

### `lazyhub status --format json`

Inputs: no flags except `--format json`.

Side effects: none. Reads the SWR disk cache only.

Idempotency: idempotent for unchanged cache contents.

Warm-cache output shape:

```json
{
  "schema_version": 1,
  "counts": {
    "review_requested": 1,
    "failing_ci": 0,
    "unread_notifications": 2
  },
  "cache_age_seconds": 5
}
```

Cold-cache behavior: prints `lazyhub: no data - open the app once` and exits 0.

## Review Evidence (internal executor API, `schema_version` 1)

Exposed by the `src/executor.js` barrel for the review-queue (#177) and PR detail
(#127) views. Not a CLI or MCP surface. Read-only, one GraphQL call per read via
`runGh()`; display evidence only, never an authorization input.

- `fetchReviewQueueEvidence({limit, scope:{org,repos}, after, cache})` returns
  `{schema_version, kind:"review_queue", host, account, fetched_at, items[], group_counts, truncation:{review_requested,authored}, rate_limit}`.
  `truncation.<group>` is `{total, returned, has_more, next_cursor}`; pass the cursors back as `after`.
- `fetchPRReviewEvidence(repo, number, {cache, force})` returns one item plus `rate_limit`.
- Item: `{schema_version, identity:{host,repo,number,url,account}, context:{head,base}, facts, attention[], group:{group,because}, actor, untrusted, fetched_at}`.
- Every `facts.*` and `context.*` entry is `{value, source, fetched_at}`. A field GitHub
  did not return has `value: "unknown"`; it is never defaulted to a safe value.
  `required_checks` is always `unknown` (branch protection is not read).
- `attention[]` is `{code, fact, value, source}`, deterministic and ordered, no scores.
  `group` precedence: needs_my_review, ci_failing, changes_requested, unknown, waiting/ready;
  `ready` needs approval, passing or absent checks and a known-mergeable PR.
- `untrusted` holds sanitized, length-bounded PR title/body and unresolved-thread excerpts
  (author prose); `actor.attribution` is always `unverified`. Never use either as a decision input.
- Cache (`createEvidenceCache`) is in memory, partitioned by host, account and repo;
  past its TTL a hit is `stale`. `diagnostics()` returns counts only.
- Approval handoff: a record is a snapshot. Revalidation against the live head and exact
  binding remain the approval work's job (#235/#244/#278); nothing may be authorized from a cached record.

## MCP Server

Entrypoints: `lazyhub --mcp` and `lazyhub mcp-server`.

Transport: JSON-RPC over stdio.

Initialize response:

```json
{
  "protocolVersion": "2024-11-05",
  "serverInfo": { "name": "lazyhub", "version": "<package.json version>" },
  "capabilities": { "tools": {} }
}
```

Tool call success response:

```json
{
  "content": [
    { "type": "text", "text": "{\n  \"number\": 1\n}" }
  ]
}
```

Tool call error response:

```json
{
  "content": [
    { "type": "text", "text": "Error: message" }
  ],
  "isError": true
}
```

All GitHub-backed tools use the `gh` CLI through `src/executor.js`.

`tools/list` advertises only implemented read-only tools (no placeholders, no
mutating tools), each with its own `inputSchema`; `number` is `required` for
`get_pr`, `get_pr_diff`, `get_checks`, `get_issue` and their `lazyhub_*` aliases.
Results are compact JSON. Error codes: `MCP_INVALID_REPO` (bad `repo`, or no
repository resolved from `repo`, the startup repository or the saved default),
`MCP_INVALID_NUMBER` (missing or non-positive `number`), `MCP_INVALID_STATE`,
`MCP_INVALID_LIMIT`, `MCP_RESOURCE_MISMATCH`, `MCP_UNKNOWN_TOOL`,
`MCP_MUTATIONS_DISABLED`.

`lazyhub --mcp` runs a headless preflight: no prompts and no `gh auth login`;
stdout carries JSON-RPC only; if `gh` is missing or unauthenticated it prints one
line to stderr and exits non-zero.

Removed: `lazyhub_query` / `query` was a placeholder that returned canned text. It is no
longer advertised, and calling it now returns `MCP_UNKNOWN_TOOL`.

| Tool | Inputs | Output | Side effects |
| --- | --- | --- | --- |
| `lazyhub_pr_list`, `list_prs` | `repo`, `state`, `limit` | slim PR array (no `body`; at most 10 checks per PR, failing first then pending then passing; `checksSummary {failing, pending, passing, total}` on every row that has checks) | none |
| `lazyhub_pr_view`, `get_pr` | `repo`, `number` | PR object | none |
| `lazyhub_pr_diff`, `get_pr_diff` | `repo`, `number` | diff text | none |
| `lazyhub_watch_ci`, `get_checks` | `repo`, `number` | checks array/object | none |
| `lazyhub_pr_approve` | `repo`, `number`, `body` | `gh pr review` result | approves PR |
| `lazyhub_pr_merge`, `merge_pr` | `repo`, `number`, `strategy` | `gh pr merge` result | merges PR |
| `lazyhub_pr_comment`, `lazyhub_issue_comment`, `post_comment` | `repo`, `number`, `body` | comment result | posts PR comment |
| `lazyhub_pr_review_line`, `review_line` | `repo`, `number`, `file`/`path`, `line`, `side`, `commitId`, `body` | review comment result | posts line comment |
| `lazyhub_issue_list`, `list_issues` | `repo`, `state`, `limit` | issue array | none |
| `lazyhub_issue_view`, `get_issue` | `repo`, `number` | issue object | none |
| `close_issue` | `repo`, `number` | `gh issue close` result | closes issue |
| `list_notifications` | none | notification array | none |
| `list_branches` | `repo` | branch array | none |

## Schema Version Policy

New JSON payloads should include `schema_version`. Additive changes increment the
minor schema version. Breaking changes require a major schema version and an
N-1 readable compatibility path.

Current discrepancy: MCP responses and `--debug-state` do not include
`schema_version`; this belongs with the schema-versioning work tracked separately.
