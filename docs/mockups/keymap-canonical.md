# Mockup and table: canonical keymap, which-key popup, context footer

Issue #312 (one verb per key, registry-driven footer/help, which-key, keystroke
budgets), with #201 (`1`-`4` sections) and #177 (queue is read-only). Protocol B step 1.

**Status (2026-10-23): accepted with the maintainer decisions of 2026-10-22, and
partly implemented.** Decisions applied below: global pane jumps are a GitHub-style
`g` prefix (`g h` home, `g p` PRs, `g i` issues, `g b` branches, `g a` actions,
`g n` inbox); digits `1`-`9` also jump to the Nth active pane (restored, `app.jump-pane`;
if #201 sections land they need a different key); the queue stays read-only, so the "approve" budget is measured
queue -> PR detail (`Enter`, `a`, confirm = 3). Sections marked **(implemented)** are
live in the registry (`defaultConfig.toml` `[actions.*]`, read through
`src/ui/actions.js`); the rest is the remaining plan.

## 1. Inventory: how keys are bound today

Measured with `grep -rn "input === '" src` (tests excluded).

| Mechanism | Where | Count |
|---|---|---|
| Hard-coded `input === 'x'` in view handlers | 17 non-test files, 167 matches | 167 |
| `matchesAction(id, ...)` through TOML keymap | `app.jsx`, `prs/list.jsx`, `issues/list.jsx`, `branches`, `actions`, `notifications`, `components/dialogs/*` | 113 call sites |
| Display-only metadata (`keys` in `src/ui/actions.js`) | command palette hints | n/a |
| Hand-written footer/help text | `VIEW_KEYS`, `PANE_KEYS.branches/actions/notifications` in `src/app-keys.js` | whole tables |

Files with hard-coded matches: `prs/diff.jsx` 34, `prs/detail.jsx` 30, `prs/comments.jsx`
15, `prs/ConflictView.jsx` 11, `prs/NewPRDialog.jsx` 10, `settings/index.jsx` 9, `logs/index.jsx`
9, `issues/detail.jsx` 9, `config/actions.js` 9 (token matching, not a view), `components/CustomPane.jsx`
8, `components/AIReviewPane.jsx` 6, `components/AIAssistant.jsx` 6, `utils.js` 4 (readline keys),
`onboarding/Onboarding.jsx` 4, and one each in `config/keymap.js`, `components/ErrorBoundary.jsx`
and `app.jsx`.

Consequences already visible: `VIEW_KEYS.detail` in `app-keys.js` omits `c`, `E`, `C`,
`R`, `/`, `g`; `PANE_KEYS.branches` lists `Space / Enter`, `D`, `p` as literal text, so
rebinding in TOML changes behaviour but not the footer or `?`.

### Conflicts: one key, several verbs

Source lines are from this checkout (`origin/main` at c4ae169).

| Key | Verbs bound today (file:line) | Distinct verbs |
|---|---|---|
| `s` | PR scope cycle (list.jsx, `pr.scope-cycle`); issue sort (`issue.sort-cycle`); diff split/unified (diff.jsx:938); save in Settings (settings:341); set up in ConflictView (:141); post in AI review (AIReviewPane:148) | 6 |
| `R` | reviewers (`pr.reviewers`, detail.jsx:433); re-run failed jobs (`workflow.rerun`, detail.jsx:399); resolve thread (comments.jsx:228) | 3 |
| `c` | checkout PR (`pr.checkout`); enter checks mode (detail.jsx:445); comment on line (diff.jsx:955); commit and continue (ConflictView:178) | 4 |
| `M` | auto-merge (`pr.auto-merge`, detail.jsx:465); filter merged (`pr.filter-merged`, same key in the same list: auto-merge wins when eligible, silently); mark all read (`notification.mark-all`) | 3 |
| `A` | assignees (list, detail, issues); abort merge (ConflictView:188); AI code review (diff.jsx:1001) | 3 |
| `e` | edit comment (comments:219, diff:964); edit file (ConflictView:152); open editor (AIReviewPane:151) | 3 |
| `x` | request changes (`pr.request-changes`); close issue (`issue.close`); clear branch filter (`workflow.clear-filter`) | 3 |
| `f` | cycle state filter (PR, issues); jump to file (diff.jsx:883); filter comments (comments:237); filter logs (logs:84) | 3 |
| `r` | refresh (about 9 views); reply (comments:214, issues/detail:116); diff.jsx:983 replies when the line has a comment, otherwise refreshes | 2 |
| `d` | open diff (`pr.diff`); delete comment (comments:224, diff:964) | 2 |
| `m` | merge (`pr.merge`); mark notification read (`notification.mark-read`) | 2 |
| `n` / `N` | new issue, new branch, new PR (`N`); next / previous comment thread (diff:919, 928); "no" in confirms | 3 / 2 |
| `E` | edit config (global `app.open-config`); open file in editor (detail.jsx:423, diff.jsx:874). Both are live; precedence is decided by `keyscope`, not by design | 2 |
| `C` | filter closed (list); detail: resolve conflicts or open Actions, chosen by `mergeable` state (detail.jsx:434, 440) | 2-3 |
| `D` | draft toggle (detail.jsx:463); delete branch (`branch.delete`) | 2 |
| `l` | labels; check logs (detail.jsx:395); open run log (`workflow.logs`) | 3 |
| `t` | file tree (diff.jsx:941); `Space t` theme | 2 |
| `:` | command palette; go to line in diff (diff.jsx:953) | 2 |
| `1`-`9` | jump to pane by position (app.jsx). #201 wants `1`-`4` for sections | 2 |
| `Space` | leader prefix (app); toggle in dialogs; stage in ConflictView; skip in AI review; checkout in branches | 5 |
| `Ctrl+G` | submit compose; `dialog.top`, `dialog.bottom`, `dialog.filter-top` also include it | 4 |
| `Ctrl+A` / `Ctrl+E` / `Ctrl+K` | global AI assistant / compose editor / filter-up, versus readline start/end/kill in `TextInput` (utils.js:324-337) | 2 each |

Verbs that are already consistent and stay: `j`/`k`, `gg`/`G`, `/`, `?`, `a` approve,
`m` merge, `o` browser, `y` copy URL, `p` push, `Enter` open, `Esc` back, `q` back/quit.

## 2. Canonical verb to key table (proposal)

Rules: one verb per key everywhere; GitHub.com's own shortcuts where they exist
(`?`, `/`, `j`/`k`, `Enter`/`o`, `t`, `g`-prefix navigation); lowercase for the common
verb, uppercase only when a lowercase twin exists on the same screen; write verbs
keep their existing confirmation dialogs.

| Verb | Key | Changes from today | Notes |
|---|---|---|---|
| Move | `j` `k` `Up` `Down` | none | |
| Top / bottom | `gg` `G` | **(implemented)** `Ctrl+G` removed from `dialog.top/bottom/filter-*`; the filter dialogs' jump keys are now `Ctrl+T` / `Ctrl+B` | `Ctrl+G` is submit only (guard test) |
| Open (in app) | `Enter` | none | |
| Open in browser | `o` | none; diff `o` opens `/files` today, becomes "this view's page" | one verb, target follows context |
| Back | `Esc`, `q` | none | `q` quits only at root (already true) |
| Sections / groups | `1`-`4` (PR detail), `1`-`5` (queue groups) | digits jump panes (`app.jump-pane`); the #201 sections need another key | pane jumps are `g` chords or digits |
| Prev / next item | `[` `]` | queue group, diff file | same verb: step one unit |
| Prev / next thread | `{` `}` | **(implemented)** was `N` / `n` in diff. `n` / `N` stay as next / previous search match in the diff only (no "new" verb exists there) | frees `n` for "new" in lists |
| Go to (prefix) | `g` then `h` Home, `p` PRs, `i` issues, `b` branches, `a` actions, `n` inbox, `l` line (diff only) | **(implemented)** `g h` replaces `g f`; `g m` (manage) is not built; `:` stays the palette only | which-key popup lists the continuations valid in the current view |
| Find / filter | `/` | none | |
| Find file | `t` | **(implemented)** diff `f` (file jump) merges into `t`; tree toggle becomes `T` | GitHub's `t` |
| Palette | `:` or `Space Space` | diff go-to-line leaves `:` | |
| Help | `?` | none | generated from the registry |
| Settings | `,` | **(implemented)** `S` removed (`,` is the action's key now) | `S` becomes sort |
| Refresh | `r` | **(implemented)** reply leaves `r` in the diff, comments and issue views | one key, all views |
| New | `n` | **(implemented)** PR `N` becomes `n` | issue, branch, PR |
| Comment / reply | `c` | **(implemented)** checkout leaves `c` (now `b`); in the diff, comments and issue views `c` replies when a thread is there. Checks mode keeps `c` in PR detail until section `3` exists (#201) | in a thread, `c` replies |
| Edit | `e` | none | comment, PR title/body; `E` = open file in `$EDITOR` |
| Delete | `Ctrl+X` | **(implemented)** comment `d` and branch `D` move here. `Del` was rejected: Ink reports Backspace and Delete as the same key, so a mistyped Backspace could start a delete | destructive, always confirms |
| Approve | `a` | none | |
| Request changes | `x` | issue close leaves `x`; clear-filter leaves `x` | |
| Resolve conversation | `z` | **(implemented)** was `R` in comments | GitHub's word, no GitHub key exists |
| Merge | `m` | **(implemented)** notifications mark-read leaves `m` (now `u`). **Deferred:** `M` auto-merge is still bound; it needs the merge-picker option first | |
| Close / cancel | `X` | **(implemented)** issue close `x` becomes `X`. **Deferred:** ConflictView abort `A` -> `X` (view not migrated) | one verb: stop this thing |
| Draft / ready | `D` | **(implemented)** branch delete leaves `D` (now `Ctrl+X`) | |
| Labels / assignees / reviewers | `l` / `A` / `R` | `R` rerun leaves; ConflictView `A`, diff `A` leave | |
| Re-run checks | `Ctrl+R` | **(implemented)** was `R` | in checks mode and the Actions pane |
| Checkout PR branch | `b` | **(implemented)** was `c` | |
| Copy URL | `y` | none | |
| Scope / sort | `s` / `S` | **(implemented)** diff split `s` becomes `w`. **Deferred:** Settings save `s` removal (view not migrated); `S` -> sort | |
| Mark read / all read | `u` / `U` | **(implemented)** was `m` / `M` | |
| AI review | `Space a` stays; diff `A` leaves | **Deferred:** diff `A` stays as `diff.ai-review` because it has no other key; it is the one remaining `A` collision (assignees elsewhere) | |
| Submit / editor in compose | `Ctrl+G` / `Ctrl+E` | none | readline wins inside text fields (see open questions) |
| Edit config | palette only | **(implemented)** global `E` removed | detail/diff `E` keeps "open in editor" |

Net effect: every key in the conflict table ends with one verb, except the modal or
contextual ones named in the notes (`Space` in dialogs, `Ctrl+A/E/K` versus readline,
`y` as copy versus confirm-yes, `o` whose target follows the view).

## 3. Which-key popup

Any prefix key (`g`, `Space`, and user-defined prefixes) opens a small overlay listing
the valid continuations, drawn from the registry. It uses `bg.overlay`, `border.focused`
and `accent.secondary` for the key letters; it times out after 1.5 s as the leader does
today, or closes on `Esc`. It overlays rather than reflows (principle 2). Contents are
contextual: in the queue it omits `g m` and `g l`; in PR detail it adds `g m` (manage),
and in Files changed it adds `g l` (go to line).

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                        ⟳ updated 2m ago │
│ scope: account · involves me                                  s change scope │
├──────────────────────────────────────────────────────────────────────────────┤
│ [◔ Review 4]  ✗ CI 2  ▲ Changes 1  … Waiting 3  ✓ Ready 1                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ platform#412  Retry in webhook sender         review requested · 2d        │
│   ledger#88     Fix invoice rounding            re-requested · 1d            │
│   web#1031      New form lib: settings          via team @acme/core · 5d     │
│                                                                              │
│                                                                              │
│                                                                              │
│ ╭────────────────────────────────────────────────────╮                       │
│ │ g  go to / prefix                       Esc cancel │                       │
│ ├────────────────────────────────────────────────────┤                       │
│ │ g  top of list            f  Home (queue)          │                       │
│ │ p  Pull requests (manage) i  Issues                │                       │
│ │ b  Branches               a  Actions               │                       │
│ │ n  Notifications                                   │                       │
│ ╰────────────────────────────────────────────────────╯                       │
╰──────────────────────────────────────────────────────────────────────────────╯
 g pressed │ next key within 1.5 s, or Esc
```

## 4. Context footer (registry-driven)

The footer, `?` help and the palette read one list: registry actions whose context
matches the current view and whose precondition holds (for example, nothing that writes
in the read-only review context; `Ctrl+R rerun*` appears only when the cursor is on a
failed check you can re-run, marked `*` below). Items are ordered by priority; what does not fit becomes
`?`. Replaces `VIEW_KEYS` / `PANE_KEYS` in `src/app-keys.js`.

```
Queue (read-only review context)
 j/k │ Enter review │ d files │ o web │ s scope │ [ ] group │ / find │ ? help

PR detail, Conversation (read-only)
 1-4 section │ j/k │ Enter open │ d diff │ o web │ Esc queue │ g m manage │ ?

PR detail, Checks (cursor on a failing check)
 1-4 section │ j/k │ Enter log │ o web │ Ctrl+R rerun* │ Esc queue │ ? help

Files changed (diff)
 j/k │ ] [ file │ } { thread │ t files │ w split │ / find │ Esc back │ ? help

Files changed, after g m (manage on)
 c comment │ a approve │ x request changes │ m merge │ Esc review │ ? help

Compose dialog (comment, approve body)
 Ctrl+G submit │ Ctrl+E editor │ Tab next field │ Esc cancel
```

### `?` help screen (same source, 80 columns)

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Help · PR detail · Conversation                          source: registry    │
├──────────────────────────────────────────────────────────────────────────────┤
│ MOVE      j/k move   gg/G top/bottom   [ ] prev/next group or file           │
│ SECTIONS  1 Conversation   2 Commits   3 Checks   4 Files changed            │
│ OPEN      Enter open   d diff   o browser   y copy URL   t find file         │
│ GO        g p PRs   g i issues   g b branches   g a actions   g n inbox      │
│ READ-ONLY (this context)  no write keys are listed or reachable here         │
│ MANAGE    g m turns on: a approve  x request changes  m merge  z resolve     │
│ META      / search   : palette   r refresh   , settings   ? this help        │
│                                                                              │
│ Only actions that work here are listed. Rebind any of them in                │
│ [keymaps] in lazyhub.toml; this screen updates itself.                       │
╰──────────────────────────────────────────────────────────────────────────────╯
```

## 5. Top tasks and keystroke budgets

**Measured (PTY-style e2e, `src/keystroke-budgets.e2e.test.jsx`, 80 and 120 columns).**
The PR list stands in for the read-only queue. Counts exclude typed text.

| # | Task | Keys | Count | Budget |
|---|---|---|---|---|
| 1 | Approve (queue -> detail) | `Enter`, `a`, `Ctrl+G` | 3 | 3 |
| 2 | Open a failing check's log | `Enter`, `c`, `Enter` (2 from detail) | 3 | 3 |
| 3 | Merge a ready PR | `m`, `Enter`, `Enter`, `y` | 4 | 4 |
| 4 | Read the diff | `d` | 1 | 2 |
| 5 | Request changes + comment | `x`, text, `Ctrl+G` | 2 + text | 3 + text |
| 6 | Comment on a diff line | `d`, `j` x 2, `c`, text, `Ctrl+G` | 5 + text | 5 + text |
| 7 | Resolve a review thread | `Enter`, `v`, `z` | 3 | 3 |
| 8 | Check out a PR branch | `b`, `y` | 2 | 2 |
| 9 | Open the PR in the browser | `o` | 1 | 1 |

Task 10 (find by text) and the queue-group paths (`5`, section `3`) wait for #177 / #201.

Assumptions for "today": launched inside a repo, default pane `focus`, persisted PR
scope `own` (the default), target PR is the first row of its list. Counts were derived by
reading the handlers, not by running the app; the PTY budget tests in #312 will replace
them with measured values. Typed text is excluded and shown as "+ text".

| # | Task | Today's keys (path) | Today | Budget | Proposed path |
|---|---|---|---|---|---|
| 1 | Approve a review-requested PR | `2` (PR pane; Focus has no cursor), `s` (own to reviewing), `a`, `Ctrl+G` (submit empty comment) | 4 | 3 | `a`, `Enter`, once the row is selected* |
| 2 | Open the log of a failing check | `2`, `s`, `Enter` (detail), `c` (checks mode, lands on first failure), `Enter` (annotations) | 5 | 3 (from detail: 2) | `Enter`, `3`, `Enter` |
| 3 | Merge a ready PR | `2`, `m`, `Enter` (strategy), `Enter` (message step) | 4 | 4 | `5` (Ready group), `m`, `Enter`, `Enter` |
| 4 | Read the diff of a requested review | `2`, `s`, `d` | 3 | 2 | row selected, `d` (= section `4`) |
| 5 | Request changes with a comment | `2`, `s`, `x`, text, `Ctrl+G` | 4 + text | 3 + text | `x`, text, `Ctrl+G` |
| 6 | Comment on a diff line | `2`, `s`, `d`, `j` x n, `c`, text, `Ctrl+G` | 5 + n + text | 3 + n + text | `d`, `j` x n, `c`, text, `Ctrl+G` |
| 7 | Resolve a review thread | `2`, `s`, `Enter`, `v` (comments view), `R` | 5 | 3 | `Enter`, `1`, `z` |
| 8 | Check out a PR branch | `2`, `s`, `c`, `y` (confirm) | 4 | 2 | row selected, `b`, `y` (fixed: 2) |
| 9 | Open the PR in the browser | `2`, `s`, `o` | 3 | 1 | `o` from the queue row |
| 10 | Find a PR by text anywhere in scope | `2`, `/`, text, `Enter` (repo only; account-wide not possible today) | 3 + text | 2 + text | `/`, text, `Enter` |

\* Task 1 depends on the open question below: the read-only queue shows no write verbs.
If writes stay behind `g m`, the budget applies to the management list and the path is
`g p`, `s`, `a`, `Enter` (4).

Test shape (from #312): one PTY flow per row at 80 and 120 columns that sends the
proposed keys against a fixture and fails if the app needs more than the budget to
reach the end state (for example, the check log visible).

## Recommendation

Adopt the table in section 2 as the single source for #312, with the three structural
choices that remove the most conflicts: digits become sections (pane jumps move to `g`
chords), `g` becomes the one prefix with a which-key popup, and auto-merge becomes an
option inside `m`. Migrate view by view (diff, detail and comments first: 79 of the 167
matches), enforcing a duplicate-binding guard test as each file moves.

## Open questions for the maintainer

Resolved 2026-10-22: 1 (queue is read-only; approve is measured queue -> detail) and 2
(digits retired from pane jumps in favour of `g` chords; no compatibility alias).
Answered in the implementation: 3 (`Ctrl+X`, see Delete), 5 (breaking changes are listed
in the #312 PR for release notes; no alias shipped). Still open: 4 and 6.

1. Queue and writes: #177 says the review context has no reachable write shortcut,
   #312 budgets "approve from the queue in 3 keys". Which holds? Proposed: queue is
   read-only, `g p` is the management list, budget 1 applies there.
2. Digits: OK to retire `1`-`9` pane jumps in favour of `g` chords (and `Tab`)? A
   `[keymaps]` compatibility alias could restore them.
3. `Del` as the delete key: acceptable on laptops without a forward-delete? Alternative
   `Ctrl+X`.
4. `Ctrl+A` opens the AI assistant but is readline "start of line" in text fields;
   keep the split (readline wins in fields), or move the assistant to `Space a` only?
5. Removing `M` (auto-merge) and `S` (settings) are breaking changes to documented
   defaults; list them in release notes, or ship a one-release compatibility alias?
6. `z` for resolve conversation, `b` for checkout, `w` for split view: any preference
   for other letters? None has a GitHub equivalent.
