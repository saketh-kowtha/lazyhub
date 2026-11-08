# Performance and completeness budgets (#510)

`npm run build && npm run test:perf` (CI job `Performance budget`) drives the built TUI in a PTY
against a generated fake `gh` (`test/support/gh-shim/perf.mjs`) with a fixed 300 ms delay per call.
The data is produced from the row index, so it is deterministic and nothing large is committed.

Update a number here and in `BUDGETS` (`test/perf/run.js`) in the same commit, on purpose. Never
loosen a budget to make a run pass; if a run is slow, find out why.

## Fixture

| Data | Size |
|---|---|
| Open PRs | 5,000 (search reaches the newest 1,000, like GitHub) |
| Closed/merged PRs | 80,000 (served by the same search; text search not driven yet) |
| Open issues | 2,000 (same 1,000 cap) |
| PR conversation | 400 comments, 150 review threads, one thread with 120 replies |
| Diff | 3,000 files, 100,000 changed lines, one 40,000-line file, one file whose patch GitHub omits |

Not in the fixture yet: 250 check runs on one PR, 600 notifications (see "Left").

## Budgets and baseline

Baseline: macOS, Node 22, five runs (slowest shown). Budgets leave about 2.5x headroom so a loaded
shared runner does not flake; a real regression (an extra round trip, a lost page, a whole-diff
download) costs far more than that or fails an exact assertion.

| Metric | Budget | Baseline |
|---|---|---|
| Cold PR list or issue list, key to first rows | 1,200 ms (1 round trip + 900) | ~410 ms |
| Key to first frame (skeleton) | 400 ms | ~1 ms |
| Each further list page, G to the footer count growing | 1,800 ms | ~490 ms |
| `d` on a PR to the first diff file | 1,800 ms (2 round trips + 1,200) | ~0 ms prefetched, ~380 ms cold |
| Conversation first comments | 1,200 ms | ~415 ms |
| Peak RSS across the whole run | 512 MB (`LAZYHUB_PERF_RSS_MB`) | 150 to 225 MB |

Exact assertions (no tolerance):

- PR list: 10 pages of 100, cursors `0,100..900`, each fetched once, in order; footer ends
  `1000 of 5000 (GitHub search returns at most 1000...)`; the 1,000th PR reaches the screen.
- Issue list: 20 pages of 50 with the same cap notice.
- Diff: no `pr diff` call (patches load per file); a file with an omitted patch shows the "too large"
  notice; no file-list page is fetched twice.
- Conversation: every comment page (`cAfter` up to 350) and thread page (`tAfter` up to 100) is
  requested, none twice; the 70 missing replies of the 120-reply thread are fetched exactly once.

The memory container job (150 MB on a 1,200-PR / 1,000-file fixture, `test/pty/memory.js`) is
unchanged and still required.

## Proving the gate

With PR list paging stopped after page two (`loadMore` in `src/features/prs/list.jsx` returning unless
`endCursor === '100'`), `npm run test:perf` fails: the list stays at 200 items and the cap notice
never appears.

## Left (Part of #510)

250 check runs, 600 notifications, search over the 80,000 closed PRs, keypress-to-frame p95, warm
navigation at 0 gh calls, exact `getGhCallHistory()` counts per action, `it.fails` pins for gaps that
#480-#482 close, and making the job a required check after a stable week.
