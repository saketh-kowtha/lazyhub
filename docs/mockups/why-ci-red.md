# Mockup: "Why is CI red?" view (issue #359)

Protocol B step 1. Implemented variant: A (one scrolling page). Variant B (split
check list and detail) was rejected because it needs 100 columns to be readable and the
requirement is 80x24. Colours are theme tokens only: title `ui.selected`, failure `ci.fail`,
changed line and warnings `ci.pending`, passes `ci.pass`, unknowns `ui.muted`, log text `diff.ctxFg`.

Opened with `f` from PR detail (or from its checks mode). `j/k` scroll, `d` PR diff, `Esc` close.

## Variant A (implemented), 80x24

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Why is CI red? #42                                                    1-20/31│
└──────────────────────────────────────────────────────────────────────────────┘
 Why is CI red? PR #42  2 failing, 1 pending
 1 check(s) still running, so this list may grow.

 ✗ test (20)  ·  1m 05s
   failing step: Run node --test   job: test (20)
   Log excerpt (Node assert, redacted):
     AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
     at Object.<anonymous> (/home/runner/work/r/r/src/math.js:7:8)
   Likely cause (PR-changed lines the log points at):
     changed line  src/math.js:7  return a + b
   Seen before: possibly flaky: failed on 1 of 3 recent commits on main, passed on the rest

 ✗ lint  ·  duration unknown
   failing step: unknown
   Log excerpt: unknown (expired): Log not found or expired
   Likely cause (PR-changed lines the log points at):
     unknown: no log excerpt to match against the diff
   Seen before: unknown: GitHub API rate limit exceeded
┌──────────────────────────────────────────────────────────────────────────────┐
│ [j] scroll  [d] diff  [Esc] close                                            │
└──────────────────────────────────────────────────────────────────────────────┘
```

Rules: every unknown reads `unknown: <reason>`; truncation reads "truncated" with the
cap; a match made only by a shorter path is tagged; nothing is guessed.
