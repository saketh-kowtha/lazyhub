# Mockup: PR detail with GitHub-named sections and a next-step bar (two variants)

Issue #201 with its 2026-10-22 amendment (GitHub-familiar layout), feeding #177
(queue to evidence to back) and #312 (key consistency). Protocol B step 1.
Maintainer picks a variant; nothing here is implemented.

## What exists today (checked in the source)

- `src/features/prs/detail.jsx` is one scrolling page (header, body, CI checks, reviews,
  comments) with a checks sub-mode entered by `c`, comments in a separate view (`v`),
  and the diff in `diff.jsx` (`d`). There are no named sections and no number keys.
- Digits `1`-`9` are currently global pane jumps in `src/app.jsx`, so using `1`-`4` for
  sections needs the scoping decision in `keymap-canonical.md`.
- `Esc` and `q` go back one level; the queue to detail to diff to back chain already
  restores list cursor via `usePaneState`.

## Shared rules

- Section names exactly as GitHub: Conversation, Commits, Checks, Files changed.
  Switch with `1`-`4`; the active tab is bracketed (not color-only) and uses
  `accent.primary`. Counts are observed values; `✗1` on Checks is glyph plus number.
- Next-step bar, like GitHub's merge box. Every item names its section key in brackets,
  so no new key exists: `3` jumps to Checks, `1` to Conversation. Items:
  `✗` `ci.fail`, `●` `ci.pending`, `◔` `status.warning`, `✓` `ci.pass`; text `fg.default`.
- Four different things are labelled apart on the line under the tabs, never merged:
  observed data (counts, head SHA), your own inspection progress (transient, this
  session only, no durable baseline before #294), GitHub review state (GitHub's words,
  with "stale" when the approval predates the head), and authorization (none; optional
  future stage). No risk score.
- Read-only review context (#177/#201 reconciliation): no write verb is shown and none
  is reachable. `g m` ("manage") is the labelled transition; it changes the banner and
  enables GitHub's own verbs (Approve, Request changes, Squash and merge, Resolve
  conversation). `Esc` in manage returns to the read-only review.
- Fixture: acme/web#1031 from the queue mockup.

## Variant A: bar on top, one column

The next-step bar sits under the header so it is the first thing seen and never scrolls.

### A at 80 columns, Conversation

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ acme/web#1031  New form lib: settings                       Open · read-only │
│ @dev-agent wants to merge 3 commits into main from feat/forms   head 3fa91c2 │
│ ✗ 1 check failing, 2 pending [3]   ◔ 1 approval needed [1]   ✓ no conflicts  │
├──────────────────────────────────────────────────────────────────────────────┤
│ [1 Conversation 4] │ 2 Commits 3 │ 3 Checks ✗1 │ 4 Files changed 6 +142 −31  │
│ You: not reviewed · inspected 0/6 files · GitHub: 1 approval (stale)         │
├──────────────────────────────────────────────────────────────────────────────┤
│ @dev-agent opened this 5d ago · review requested from you via @acme/core     │
│                                                                              │
│ ## Summary                                                                   │
│ Replaces the hand-rolled settings form with the shared form library.         │
│ No behaviour change intended. Fixes #1002.                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ ◔ Review requested of you (@octocat) · 5d ago                                │
│ ✓ @maria-lopez approved · 3d ago · on 91ab0c4 (2 commits ago, stale)         │
│ ● @jin-park commented on settings/Form.tsx:48 · 2d ago · unresolved          │
│     "Is the reset path covered by a test?"                                   │
│                                                                              │
│                                                                              │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
 1-4 section │ j/k │ Enter open │ d diff │ o web │ Esc queue │ g m manage │ ?
```

### A at 80 columns, Checks (after pressing 3)

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ acme/web#1031  New form lib: settings                       Open · read-only │
│ @dev-agent wants to merge 3 commits into main from feat/forms   head 3fa91c2 │
│ ✗ 1 check failing, 2 pending [3]   ◔ 1 approval needed [1]   ✓ no conflicts  │
├──────────────────────────────────────────────────────────────────────────────┤
│ 1 Conversation 4 │ 2 Commits 3 │ [3 Checks ✗1] │ 4 Files changed 6 +142 −31  │
│ You: not reviewed · inspected 0/6 files · GitHub: 1 approval (stale)         │
├──────────────────────────────────────────────────────────────────────────────┤
│ ✗ lint (ubuntu-latest)            failed 2m   annotations: 3 errors          │
│ ▶ ● test (ubuntu-latest)          running     started 1m ago                 │
│   ● test (macos-latest)           queued                                     │
│   ✓ build                         passed 3m                                  │
│   ✓ typecheck                     passed 2m                                  │
│   ✓ 3 more passed                 (Enter on this row expands)                │
│                                                                              │
│ Required: lint, test. 1 required check failing.                              │
│                                                                              │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
 1-4 section │ j/k │ Enter log │ o web │ r refresh │ Esc queue │ ? help
```

### A at 120 columns, Conversation

```
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ acme/web#1031  New form lib: settings                                                               Open · read-only │
│ @dev-agent wants to merge 3 commits into main from feat/forms                                           head 3fa91c2 │
│ ✗ 1 check failing, 2 pending [3]   ◔ 1 approval needed [1]   ✓ no conflicts                                          │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [1 Conversation 4] │ 2 Commits 3 │ 3 Checks ✗1 │ 4 Files changed 6 +142 −31                                          │
│ You: not reviewed · Inspected this session: 0 of 6 files · GitHub review: 1 approval (stale) · Authorization: none   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ @dev-agent opened this 5d ago · review requested from you via team @acme/core (not you personally)                   │
│                                                                                                                      │
│ ## Summary                                                                                                           │
│ Replaces the hand-rolled settings form with the shared form library. No behaviour change intended. Fixes #1002.      │
│ ## Testing                                                                                                           │
│ Existing form specs pass unchanged; added reset-path spec.                                                           │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ◔ Review requested of you (@octocat) · 5d ago                          GitHub review state: REVIEW_REQUIRED          │
│ ✓ @maria-lopez approved · 3d ago · on 91ab0c4 (2 commits before head 3fa91c2, so the approval is stale)              │
│ ● @jin-park commented on settings/Form.tsx:48 · 2d ago · unresolved thread (1 comment)                               │
│     "Is the reset path covered by a test?"                                                                           │
│ ○ @dev-agent pushed 2 commits · 1d ago · ci: 1 failing (lint), 2 pending                                             │
│                                                                                                                      │
│                                                                                                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
 1-4 section │ j/k move │ Enter open │ d files changed │ o browser │ Esc queue │ g m manage (write actions) │ ? help
```

Pros: the answer to "what is blocking this" is always on screen; one column works
unchanged from 80 to 120; closest to the current single-page `detail.jsx`.
Cons: at 120 columns the right half is mostly empty; the bar competes with the header
for the top rows (3 rows of chrome before content).

## Variant B: merge box at the bottom, reviewer rail at 120

The next-step bar becomes a "Merge readiness" box pinned to the bottom of the frame, as
on github.com. At 120 columns a right rail shows Reviewers, Checks and Files summaries
(GitHub's sidebar), so wide terminals use their width.

### B at 80 columns, review (read-only)

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ acme/web#1031  New form lib: settings                       Open · read-only │
│ @dev-agent wants to merge 3 commits into main from feat/forms   head 3fa91c2 │
├──────────────────────────────────────────────────────────────────────────────┤
│ [1 Conversation 4] │ 2 Commits 3 │ 3 Checks ✗1 │ 4 Files changed 6 +142 −31  │
│ You: not reviewed · inspected 0/6 files · GitHub: 1 approval (stale)         │
├──────────────────────────────────────────────────────────────────────────────┤
│ @dev-agent opened this 5d ago · review requested from you via @acme/core     │
│ ## Summary                                                                   │
│ Replaces the hand-rolled settings form with the shared form library.         │
│ ◔ Review requested of you (@octocat) · 5d ago                                │
│ ✓ @maria-lopez approved · 3d ago · on 91ab0c4 (stale)                        │
│ ● @jin-park commented on settings/Form.tsx:48 · unresolved                   │
│                                                                              │
│ ╭ Merge readiness · observed 2m ago ───────────────────────────────────────╮ │
│ │ ✗ 1 check failing, 2 pending                                  [3 Checks] │ │
│ │ ◔ 1 approval needed (yours would count)                 [1 Conversation] │ │
│ │ ✓ no conflicts with main                                                 │ │
│ ╰──────────────────────────────────────────────────────────────────────────╯ │
╰──────────────────────────────────────────────────────────────────────────────╯
 1-4 section │ j/k │ Enter open │ d diff │ o web │ Esc queue │ g m manage │ ?
```

### B at 80 columns, after `g m` (manage mode, GitHub's verbs)

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ acme/web#1031  New form lib: settings               Open · MANAGE: writes on │
│ @dev-agent wants to merge 3 commits into main from feat/forms   head 3fa91c2 │
├──────────────────────────────────────────────────────────────────────────────┤
│ [1 Conversation 4] │ 2 Commits 3 │ 3 Checks ✗1 │ 4 Files changed 6 +142 −31  │
│ You: not reviewed · inspected 0/6 files · GitHub: 1 approval (stale)         │
├──────────────────────────────────────────────────────────────────────────────┤
│ @dev-agent opened this 5d ago · review requested from you via @acme/core     │
│ ## Summary                                                                   │
│ Replaces the hand-rolled settings form with the shared form library.         │
│ ◔ Review requested of you (@octocat) · 5d ago                                │
│ ✓ @maria-lopez approved · 3d ago · on 91ab0c4 (stale)                        │
│ ● @jin-park commented on settings/Form.tsx:48 · unresolved                   │
│                                                                              │
│ ╭ MANAGE · writes enabled ─────────────────────────────────────────────────╮ │
│ │ ✗ Required check failing: Squash and merge is blocked                    │ │
│ │ [a Approve] [x Request changes] [c Comment] [m Squash and merge: blocked]│ │
│ │ Esc returns to the read-only review                                      │ │
│ ╰──────────────────────────────────────────────────────────────────────────╯ │
╰──────────────────────────────────────────────────────────────────────────────╯
 a approve │ x request changes │ c comment │ m merge │ Esc review │ ? help
```

### B at 120 columns

```
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ acme/web#1031  New form lib: settings                                                               Open · read-only │
│ @dev-agent wants to merge 3 commits into main from feat/forms                                           head 3fa91c2 │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ [1 Conversation 4] │ 2 Commits 3 │ 3 Checks ✗1 │ 4 Files changed 6 +142 −31                                          │
│ You: not reviewed · Inspected this session: 0 of 6 files · GitHub review: 1 approval (stale) · Authorization: none   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ @dev-agent opened this 5d ago · review requested via team @acme/core           │ REVIEWERS                           │
│                                                                                │ ◔ you (@octocat)   requested        │
│ ## Summary                                                                     │ ✓ @maria-lopez   approved (stale)   │
│ Replaces the hand-rolled settings form with the shared form                    │ ◔ team @acme/core  requested        │
│ library. No behaviour change intended. Fixes #1002.                            │                                     │
│                                                                                │ CHECKS  3 Checks                    │
│ ◔ Review requested of you (@octocat) · 5d ago                                  │ ✗ lint             failed           │
│ ✓ @maria-lopez approved · 3d ago · on 91ab0c4 (stale)                          │ ● test x2          pending          │
│ ● @jin-park commented on settings/Form.tsx:48 · unresolved                     │ ✓ 6 passed                          │
│     "Is the reset path covered by a test?"                                     │                                     │
│ ○ @dev-agent pushed 2 commits · 1d ago                                         │ FILES  4 Files changed              │
│                                                                                │ 6 files  +142 −31                   │
│                                                                                │ inspected 0 of 6                    │
│                                                                                │                                     │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ✗ 1 check failing, 2 pending [3]   ◔ 1 approval needed [1]   ✓ no conflicts                                          │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
 1-4 section │ j/k move │ Enter open │ d files changed │ o browser │ Esc queue │ g m manage (write actions) │ ? help
```

Pros: mirrors github.com most literally (timeline, merge box, sidebar), so users
relearn nothing; the rail makes reviewers and checks visible without leaving
Conversation.
Cons: two layouts to build (rail at 120, box-only at 80); the bar is at the bottom, so
a long Conversation can push it off-screen unless it is pinned (it is pinned here, at
the cost of 5 rows at 80x24).

## States (variant A chrome, 80 columns; B reuses the text)

### Loading

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ acme/web#1031  New form lib: settings                       Open · read-only │
│ @dev-agent wants to merge 3 commits into main from feat/forms   head 3fa91c2 │
│ … loading merge readiness                                                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ [1 Conversation 4] │ 2 Commits 3 │ 3 Checks ✗1 │ 4 Files changed 6 +142 −31  │
│ You: … · Inspected this session: … · GitHub review: …                        │
├──────────────────────────────────────────────────────────────────────────────┤
│ Conversation loads first; other sections load when opened.                   │
│                                                                              │
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒                                            │
│ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒                                                          │
│                                                                              │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
```

### One section failed (rate limit); the rest stays usable

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ acme/web#1031  New form lib: settings                       Open · read-only │
│ @dev-agent wants to merge 3 commits into main from feat/forms   head 3fa91c2 │
│ ✗ ? checks unknown   ◔ 1 approval needed [1]   ✓ no conflicts                │
├──────────────────────────────────────────────────────────────────────────────┤
│ 1 Conversation 4 │ 2 Commits 3 │ [3 Checks ✗1] │ 4 Files changed 6 +142 −31  │
│ You: not reviewed · inspected 0/6 files · GitHub: 1 approval (stale)         │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⚠ Checks could not be loaded: GitHub rate limit reached.                     │
│     Resets 14:32 local (in 6m). Everything else on this page is current.     │
│     r  retry at 14:32     o  open Checks in the browser                      │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
```

### Offline

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ acme/web#1031  New form lib: settings                       Open · read-only │
│ @dev-agent wants to merge 3 commits into main from feat/forms   head 3fa91c2 │
│ ⊘ offline: showing the copy observed 14m ago (head 3fa91c2)                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ [1 Conversation 4] │ 2 Commits 3 │ 3 Checks ✗1 │ 4 Files changed 6 +142 −31  │
│ You: not reviewed · inspected 0/6 files · GitHub: 1 approval (stale)         │
├──────────────────────────────────────────────────────────────────────────────┤
│ Reading works from the cache. Anything that needs GitHub is disabled         │
│ until the connection returns; r retries now.                                 │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
```

## Recommendation

Variant A for Alpha. It is the cheapest path from today's `detail.jsx`, keeps the
blocker line always visible, and the number-key sections are identical in B, so B's
rail can be added at 120 columns later without changing keys or labels. If the
maintainer wants literal github.com parity now, pick B.

## Open questions for the maintainer

1. `1`-`4` conflict with the global pane-jump digits. Proposed: digits are section keys
   inside PR detail and diff, pane jumps move to `g` chords everywhere (see
   `keymap-canonical.md`). Acceptable?
2. Is `g m` the right label and key for the read-only to manage transition, and should
   the manage banner stay for the whole session once entered?
3. "Stale approval" is computed by comparing the review commit to the head SHA. Is that
   deterministic enough to show without a caveat, given force-pushes?
4. Should "Inspected this session" count a file as inspected when the diff cursor passes
   it, or only on an explicit key? (Transient state only until #294.)
5. Commits section: list only, or also per-commit diff? This mockup assumes list only.
