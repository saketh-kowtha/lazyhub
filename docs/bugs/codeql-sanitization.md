# CodeQL sanitization alerts

Open code-scanning alerts on main, grouped by rule, with the change for each.

| Rule | Where | Change |
|---|---|---|
| js/incomplete-sanitization | `src/executor/*` repo path (`encodeURIComponent(x).replace('%2F', '/')`) | New `repoPath()` in `src/executor/core.js`: splits `owner/name`, requires exactly two non-empty parts, encodes each. All call sites use it. |
| js/incomplete-sanitization | `compact` (prs.js) and `q` (issues.js) quote escaping | Escape backslashes before quotes. |
| js/incomplete-sanitization | `src/ai/login.js` flag regex, `CommandPalette.confirm.test.jsx` | Escape every regex metacharacter, including the backslash. |
| js/incomplete-url-substring-sanitization | Settings AI provider hint | New `src/features/settings/endpoint-hint.js` compares the parsed `URL` hostname (exact or subdomain). |
| js/incomplete-url-substring-sanitization | `bootstrap.test.js`, `ai-assistant.test.js` | Exact equality / regex instead of substring checks. |
| js/double-escaping | `src/features/prs/diff/highlight.js` | Decode `&amp;` last, so `&amp;lt;` becomes `&lt;`, not `<`. |

Behaviour is unchanged for valid `owner/name` repositories. A malformed repo now
throws a clear error instead of building a different path.

Tests: `src/executor/repo-path.test.js`, `src/features/settings/endpoint-hint.test.js`,
`src/features/prs/diff/highlight.test.js`.
