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

## MCP Server

Entrypoints: `lazyhub --mcp` and `lazyhub mcp-server`.

Transport: JSON-RPC over stdio.

Initialize response:

```json
{
  "protocolVersion": "2024-11-05",
  "serverInfo": { "name": "lazyhub", "version": "1.0.0" },
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

| Tool | Inputs | Output | Side effects |
| --- | --- | --- | --- |
| `lazyhub_pr_list`, `list_prs` | `repo`, `state`, `limit` | PR array | none |
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
| `lazyhub_query`, `query` | freeform object | placeholder answer | none |

## Schema Version Policy

New JSON payloads should include `schema_version`. Additive changes increment the
minor schema version. Breaking changes require a major schema version and an
N-1 readable compatibility path.

Current discrepancy: MCP responses and `--debug-state` do not include
`schema_version`; this belongs with the schema-versioning work tracked separately.
