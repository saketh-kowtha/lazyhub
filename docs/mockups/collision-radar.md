# Collision radar (#360)

Opened from PR detail with `K`. Variant chosen: one full-screen scrolling list with two tabs
(this PR / repo), because it fits 80x24 without a split and reuses the log-viewer chrome.

```
Collisions for #12  [Tab] repo view + merge order  [r] rescan  [j/k] scroll  [Esc] back
#12 Fix parser -> main
2 open PRs touch the same files; 1 likely to conflict. Likely means the data points to it.

#18 Rework lexer (alice)  - likely conflict
    src/parser.js  [same lines]
      old-side lines changed in both: #12 40-52, #18 48
#20 Docs tidy (bob)  - same file, may merge cleanly
    src/parser.js  [same file]
      different parts of the file; git can usually merge this
    generated, merge one at a time: docs/FILE_MAP.md

scanned 14:02 (3m ago) - 37 open PRs read of 340
Not scanned: 303 older open PRs ...
```

Repo tab: collision clusters, generated files grouped as "merge one at a time", then the suggested
merge order (fewest overlaps, then smaller diff) with a reason line per step.
