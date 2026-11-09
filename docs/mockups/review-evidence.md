# Review evidence (#127, #175)

Reached from PR detail with `e`, or opened by the review queue (#177) with a return target.
Full-screen, read-only, like the claims check. Variant chosen in an unattended run because it
matches the variant A reading order of `pr-detail-github-layout.md` (revision first) and the
existing dialog views; rationale in the PR body.

```
 Evidence  acme/web#1031                                                 OPEN  read-only
 ✗ The head changed since you opened this. What you read earlier no longer applies.
 Revision
 > head               3fa91c2 on main
   changed         ✗  head moved since you opened this: 91ab0c4 -> 3fa91c2. Read the evidence again
   read               4s ago
 Attention
   ci_failing      ✗  from checks
 Checks
   rollup          ✗  FAILURE: 5 passed, 1 failed, 2 pending of 8
   required        ✗  2 required: 1 passing, 1 failing, 0 pending. A required check that has not reported is not visible here
 Review
   decision           APPROVED
   approvals       ◐  1 approval, 1 given on an earlier head (stale), 0 requesting changes
   requested of you   via a team (core); GitHub does not say which of your teams matched
   threads         ◐  1 unresolved of 1
 Merge
   mergeable       ✓  MERGEABLE
 Files
   changed            6 files  +142 -31
   by path            source 3, test 2, docs 1
   no_test_files_changed  none of the 6 files read
 Changed files
   modified           +12 -3  src/forms/Settings.tsx
 Written by the author (unverified)
   title              New form lib: settings
 source github.graphql.pullRequest.commits.last.statusCheckRollup, read 2026-11-09T12:00:00.000Z
 Observation only. It does not approve, merge or authorize anything. No AI was used.
 j/k scroll  r refresh  d diff  Esc back to queue
```

Rules the layout keeps:
- unknown is written as `unknown (reason)`, never as a passing value; counts that cover only the
  fetched checks, threads or files say "lower bound" or "the first N are listed";
- status is a glyph plus words, never colour alone; colours come from `useTheme()`;
- author-written prose (title, description, thread excerpts, actor) sits under its own heading, cleaned;
- the selected row shows its source and read time on the line above the footer;
- `Esc` goes back to the caller's return target (queue position and filter) or closes.
