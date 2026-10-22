# Mockup: onboarding step 2 report, attribution separated from coverage

Issue #281. Replaces the step 2 body in `onboarding-first-run-a-stepper.md`.
Only the report body changes; frame, header and footer are unchanged.

Four distinct facts, never merged into one line:

1. operation + coverage (what lazyhub could see): per-operation rows
2. observation completeness/freshness: the reason lines (codes stay visible)
3. enforcement: always "none" in watch-only
4. attribution: who GitHub says acted. Metadata only; a GitHub user account is
   never labelled "human"; unattributed activity does not change coverage.

Reason and attribution lines wrap (never truncate): they are the only place a
limitation is explained. Operation rows keep truncation; their codes are repeated
in full in the reason lines.

## 80x24

```
 Observed 20 PR(s) in 1 page(s). Nothing was enforced, installed or written.
 identity: verified · rulesets: readable (1)
 Coverage (github_enforced | managed_gateway | advisory | ungoverned)
   pr_merge                     advisory
   pr_review                    ungoverned [observation_gap:reviews_truncated]
   force_push                   advisory
 Gaps: reviews_truncated
   reviews_truncated: activity beyond the read window was not observed. Next:
   re-run with a larger --limit or --max-pages.
 Enforcement: none. Coverage reflects what was observed, not who acted.
 Attribution (who GitHub says acted): known agent 2, known automation 1,
 GitHub user (not proof of a human) 14, unattributed 3
   Attribution is who GitHub says acted. A GitHub user account does not prove a
   human wrote the change, and unattributed activity neither grants authority
   nor changes coverage.
```

Tokens: reason lines `ci.pending`, attribution caveat `ui.dim`, rest `ui.muted`.
