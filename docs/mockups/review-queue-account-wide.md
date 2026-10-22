# Mockup: account-wide review queue (home screen), three variants

Issue #177 with its 2026-10-22 amendment (account-wide queue, status groups, scope
filters, per-host, freshness) and the #201 amendment (queue is the home screen, then
PR detail, then back). Protocol B step 1. Maintainer picks one variant; nothing here
is implemented.

## What exists today (checked in the source)

- The default pane is `focus` (`defaultConfig.toml`: `default_pane = "focus"`). It is
  `src/features/tabs/view.jsx` rendering three `TabPane`s (Review requested, My open
  PRs, Assigned issues) as plain read-only rows: `#num title age`, max 8 per pane,
  no cursor, no keys, no CI, no repo column, single `repo`.
- Everything actionable (cursor, scope `s`, filters `O`/`C`/`M`, `Enter`) lives in
  `src/features/prs/list.jsx`, which is single-repository and default-scoped to `own`
  (`s` cycles `all`, `own`, `reviewing`, `oldest`).
- So the account-wide queue is a new screen replacing Focus as the home, not a reskin.
  Row ingredients that already exist: `PRStateBadge`, `CIBadge`, `ReviewBadge`,
  `shortAge`, `authorColor` in `src/features/prs/list-row.jsx`.

## Design rules used (DESIGN_REVAMP, DESIGN_REFERENCES)

- One border style, 1-cell padding, `accent.primary` in at most 3 places: the focused
  row, the active group, the primary key (`Enter`). Everything else `fg.default`,
  `fg.muted` (reason text, age), `fg.subtle` (separators, hints).
- Status is never color-only: every state is a glyph plus a word.
  `◔ review requested` (`status.warning`), `✗ CI failing` (`ci.fail`),
  `▲ changes requested` (`status.error`), `… waiting on @x` (`fg.muted`),
  `✓ ready` (`ci.pass`). `⚠` partial uses `status.warning`; `⊘ offline` `fg.subtle`.
- Rows truncate secondary metadata first at 80 columns (gh-dash rule): owner prefix,
  author and CI column go before the title or the reason.
- The `why` strip under the list is a fixed row, so focus never shifts layout.
  It is the explainable attention reason: only facts GitHub returned, with inspected
  head SHA and observation time; no risk score.
- Footer: only keys that work in the read-only review context. Write verbs
  (approve, merge, close) are not shown here (#177 reconciliation); `g p` is the
  labelled exit to the management list.
- Data model assumed: one batched GraphQL search per refresh per host (#177), grouped
  client-side. A `+` after a count means the 100-result search limit was hit.
  Hosts are never mixed: a host switch is a separate scope entry, not extra rows.

## Variant A: grouped sections in one scrolling list

Headings with counts, rows under each, five groups visible without navigation.
`Enter` on a heading expands or collapses it.

### A at 80 columns

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                        ⟳ updated 2m ago │
│ scope: account (all repos you can see) · involves me          s change scope │
├──────────────────────────────────────────────────────────────────────────────┤
│ ◔ NEEDS MY REVIEW  4                                                         │
│ ▶ platform#412  Retry in webhook sender         review requested · 2d        │
│   ledger#88     Fix invoice rounding            re-requested · 1d            │
│   … 2 more · Enter on the heading expands                                    │
│ ✗ CI FAILING  2                                                              │
│   platform#409  Shard the worker queue          ✗ test failing · 3h          │
│   mailer#57     Upgrade to Node 22              ✗ lint failing · 1d          │
│ ▲ CHANGES REQUESTED  1                                                       │
│   ops#23        Add alerting rules              @dev-agent changes · 2d      │
│ … WAITING ON OTHERS  3                                                       │
│   platform#405  Split the config loader         awaiting @jin-park · 4d      │
│   search#14     Index warm-up on boot           no reviewer · 2d             │
│   … 1 more · Enter on the heading expands                                    │
│ ✓ READY TO MERGE  1                                                          │
│   api#301       Paginate audit endpoint         approved · CI ok · clean     │
├──────────────────────────────────────────────────────────────────────────────┤
│ why  review requested of you Oct 20 · head 3fa91c2 · CI 9/9 · seen 2m ago    │
╰──────────────────────────────────────────────────────────────────────────────╯
 j/k │ Enter review │ d files │ o web │ s scope │ [ ] group │ / find │ ? help
```

### A at 120 columns

```
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                                                                ⟳ updated 2m ago │
│ scope: account (all repos you can see) · involves me                                                  s change scope │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ ◔ NEEDS MY REVIEW  4                                                                                                 │
│ ▶ acme/platform#412      Retry in webhook sender           @maria-lopez  ✓ 9/9  review requested of you · 2d         │
│   acme/ledger#88         Fix invoice rounding              @jin-park     ✓ 6/6  re-requested after push · 1d         │
│   … 2 more · Enter on the heading expands                                                                            │
│ ✗ CI FAILING  2                                                                                                      │
│   acme/platform#409      Shard the worker queue            you           ✗ 1/9  ✗ test (ubuntu) failing · 3h         │
│   acme/mailer#57         Upgrade to Node 22                you           ✗ 1/6  ✗ lint failing · 1d                  │
│ ▲ CHANGES REQUESTED  1                                                                                               │
│   acme/ops#23            Add alerting rules                you           ✓ 4/4  changes by @dev-agent · 2d           │
│ … WAITING ON OTHERS  3                                                                                               │
│   acme/platform#405      Split the config loader           you           ✓ 9/9  awaiting @jin-park · 4d              │
│   acme/search#14         Index warm-up on boot             you           ✓ 5/5  no reviewer assigned · 2d            │
│   … 1 more · Enter on the heading expands                                                                            │
│ ✓ READY TO MERGE  1                                                                                                  │
│   acme/api#301           Paginate audit endpoint           you           ✓ 7/7  approved · CI passing · clean        │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ why  review requested of you on Oct 20 (unreviewed) · head 3fa91c2 · CI 9/9 passing · mergeable · observed 2m ago    │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
 j/k move │ Enter review │ d files changed │ o browser │ s scope │ [ ] group │ / search │ g p manage PRs │ ? help
```

Pros: all groups visible at once; no hidden state; works unchanged at 80 columns.
Cons: groups are capped at two rows each unless expanded, so a busy account scrolls a
lot; the count and the visible rows disagree until you expand.

## Variant B: status sidebar plus list (compact chip header at 80)

At 120 columns a sidebar holds scope (account, orgs, saved sets) above status groups
with counts; the list shows the focused group. At 80 columns the sidebar collapses to
one chip line; `[` and `]` move between groups, `s` opens the scope list.

### B at 80 columns

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
│   hello#9       Bump dependencies               review requested · 6d        │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ why  review requested of you Oct 20 · head 3fa91c2 · CI 9/9 · seen 2m ago    │
╰──────────────────────────────────────────────────────────────────────────────╯
 j/k │ Enter review │ d files │ o web │ s scope │ [ ] group │ / find │ ? help
```

### B at 120 columns

```
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com · all hosts separate                                           ⟳ updated 2m ago │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ SCOPE                      │   REF                  TITLE                        CI     WHY IT IS HERE               │
│ ▸ Account  github.com      │ ▶ acme/platform#412    Retry in webhook sender      ✓ 9/9  review requested · 2d        │
│   Org  acme                │   acme/ledger#88       Fix invoice rounding         ✓ 6/6  re-requested · 1d            │
│   Org  octocat             │   acme/web#1031        New form lib: settings       ✗ 1/8  via team @acme/core · 5d     │
│   Set  work (3 repos)      │   octocat/hello#9      Bump dependencies            ✓ 3/3  review requested · 6d        │
│                            │                                                                                         │
│ STATUS                     │                                                                                         │
│ ▶ ◔ Needs my review  4     │                                                                                         │
│   ✗ CI failing        2    │                                                                                         │
│   ▲ Changes requested 1    │                                                                                         │
│   … Waiting on others 3    │                                                                                         │
│   ✓ Ready to merge    1    │                                                                                         │
│                            │                                                                                         │
│   total 11 of 11           │                                                                                         │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ why  review requested of you on Oct 20 (unreviewed) · head 3fa91c2 · CI 9/9 passing · mergeable · observed 2m ago    │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
 j/k move │ Enter review │ d files changed │ o browser │ s scope │ [ ] group │ / search │ g p manage PRs │ ? help
```

Pros: matches the amendment wording (status sidebar plus scope filters); scope and
status are separate axes; the list never mixes groups so counts equal rows. Same
shape as the Sidebar already in `src/components/Sidebar.jsx`.
Cons: one group at a time; needs two layouts (sidebar at 120, chips at 80); a new
focus target (sidebar) to explain.

## Variant C: single list, status column

One list sorted by urgency (review, CI, changes, waiting, ready); a STATUS word column
replaces headings; `f` cycles a filter, chips show counts.

### C at 80 columns

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                        ⟳ updated 2m ago │
│ all 11 · ◔ review 4 · ✗ CI 2 · ▲ changes 1 · … wait 3 · ✓ ready 1   f filter │
├──────────────────────────────────────────────────────────────────────────────┤
│   STATUS    REF          TITLE                    REASON                     │
│ ▶ ◔ REVIEW  platform#412 Retry in webhook sender  review requested · 2d      │
│   ◔ REVIEW  ledger#88    Fix invoice rounding     re-requested · 1d          │
│   ◔ REVIEW  web#1031     New form lib: settings   via team @acme/core · 5d   │
│   ◔ REVIEW  hello#9      Bump dependencies        review requested · 6d      │
│   ✗ CI FAIL platform#409 Shard the worker queue   ✗ test failing · 3h        │
│   ✗ CI FAIL mailer#57    Upgrade to Node 22       ✗ lint failing · 1d        │
│   ▲ CHANGES ops#23       Add alerting rules       @dev-agent changes · 2d    │
│   … WAITING platform#405 Split the config loader  awaiting @jin-park · 4d    │
│   … WAITING search#14    Index warm-up on boot    no reviewer · 2d           │
│   … WAITING docs#77      Rewrite install guide    draft · 9d                 │
│   ✓ READY   api#301      Paginate audit endpoint  approved · CI ok · clean   │
├──────────────────────────────────────────────────────────────────────────────┤
│ why  review requested of you Oct 20 · head 3fa91c2 · CI 9/9 · seen 2m ago    │
╰──────────────────────────────────────────────────────────────────────────────╯
 j/k │ Enter review │ d files │ o web │ s scope │ [ ] group │ / find │ ? help
```

### C at 120 columns

```
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                                                                ⟳ updated 2m ago │
│ all 11 · ◔ review 4 · ✗ CI 2 · ▲ changes 1 · … wait 3 · ✓ ready 1                                           f filter │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│   STATUS    REF                    TITLE                        AUTHOR        CI     REASON                          │
│ ▶ ◔ REVIEW  acme/platform#412      Retry in webhook sender      @maria-lopez  ✓ 9/9  review requested of you · 2d    │
│   ◔ REVIEW  acme/ledger#88         Fix invoice rounding         @jin-park     ✓ 6/6  re-requested after push · 1d    │
│   ◔ REVIEW  acme/web#1031          New form lib: settings       @dev-agent    ✗ 1/8  via team @acme/core · 5d        │
│   ◔ REVIEW  octocat/hello#9        Bump dependencies            @dependabot   ✓ 3/3  review requested of you · 6d    │
│   ✗ CI FAIL acme/platform#409      Shard the worker queue       you           ✗ 1/9  ✗ test (ubuntu) failing · 3h    │
│   ✗ CI FAIL acme/mailer#57         Upgrade to Node 22           you           ✗ 1/6  ✗ lint failing · 1d             │
│   ▲ CHANGES acme/ops#23            Add alerting rules           you           ✓ 4/4  changes by @dev-agent · 2d      │
│   … WAITING acme/platform#405      Split the config loader      you           ✓ 9/9  awaiting @jin-park · 4d         │
│   … WAITING acme/search#14         Index warm-up on boot        you           ✓ 5/5  no reviewer assigned · 2d       │
│   … WAITING acme/docs#77           Rewrite install guide        you           - 0/0  draft · 9d                      │
│   ✓ READY   acme/api#301           Paginate audit endpoint      you           ✓ 7/7  approved · CI passing · clean   │
├──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│ why  review requested of you on Oct 20 (unreviewed) · head 3fa91c2 · CI 9/9 passing · mergeable · observed 2m ago    │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
 j/k move │ Enter review │ d files changed │ o browser │ s scope │ [ ] group │ / search │ g p manage PRs │ ? help
```

Pros: simplest model (one list, one cursor); closest to today's `list.jsx` and gh-dash;
lowest implementation cost.
Cons: no spatial grouping; the reason column loses width at 80 columns; counts and
scope live in a chip line that is easy to miss.

## States (drawn on variant B chrome at 80 columns; A and C reuse the same text)

### Launched inside a git repo: starts filtered to that repo, account is one key away

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · repo acme/platform (from this directory)             ⟳ updated 2m ago │
│ scope: repo · 3 PRs here, 8 more elsewhere in your account           s widen │
├──────────────────────────────────────────────────────────────────────────────┤
│ [◔ Review 1]  ✗ CI 1  ▲ Changes 0  … Waiting 1  ✓ Ready 0                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ platform#412  Retry in webhook sender         review requested · 2d        │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ why  review requested of you Oct 20 · head 3fa91c2 · CI 9/9 · seen 2m ago    │
╰──────────────────────────────────────────────────────────────────────────────╯
 j/k move │ Enter review │ s widen to account │ [ ] group │ / find │ ? help
```

The header names the source of the scope ("from this directory"). The line below it
says how much the filter hides ("7 more elsewhere") so a short list is not mistaken for
a complete one. `s` widens straight to account; pressing it again cycles orgs and sets.

### Empty

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                      ⟳ updated just now │
│ scope: account · involves me                                  s change scope │
├──────────────────────────────────────────────────────────────────────────────┤
│ [◔ Review 0]  ✗ CI 0  ▲ Changes 0  … Waiting 0  ✓ Ready 0                    │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│     Nothing needs your attention.                                            │
│                                                                              │
│     Checked 14 repos on github.com, 0 review requests, 0 failing PRs.        │
│                                                                              │
│     /      search every PR in scope                                          │
│     s      widen or change scope (acme, octocat, set: work)                  │
│     g p    browse all PRs, including closed                                  │
│                                                                              │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ why  empty is a result: the query ran at 14:02 and returned 0 items          │
╰──────────────────────────────────────────────────────────────────────────────╯
 / search │ s scope │ g p browse PRs │ ? help
```

### Partial failure (some repos failed, rest stays usable)

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                      ⚠ partial · 2m ago │
│ scope: account · involves me                                  s change scope │
├──────────────────────────────────────────────────────────────────────────────┤
│ [◔ Review 3]  ✗ CI 2  ▲ Changes 1  … Waiting 3  ✓ Ready 1                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ platform#412  Retry in webhook sender         review requested · 2d        │
│   ledger#88     Fix invoice rounding            re-requested · 1d            │
│   web#1031      New form lib: settings          via team @acme/core · 5d     │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⚠ 12 of 14 repos loaded. Counts may be low.                                  │
│ ⚠ acme/billing: SAML SSO not authorized for acme.                            │
│     fix: gh auth refresh -h github.com, then authorize acme (SSO)            │
│ ⚠ acme/legacy: not found, or you have no access.                             │
├──────────────────────────────────────────────────────────────────────────────┤
│ why  review requested of you Oct 20 · head 3fa91c2 · CI 9/9 · seen 2m ago    │
╰──────────────────────────────────────────────────────────────────────────────╯
 j/k move │ Enter review │ r retry failed │ ? what do these mean │ q quit
```

Counts may be low while a repo is missing. Messages follow `day-one-errors.md`
(#313). The list is fully interactive; `r` retries only the failed repos.

### Search rate limit, and offline

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                          ◷ cache 4m old │
│ ◷ GitHub search rate limit reached. Resets 14:32 local (in 6m).              │
├──────────────────────────────────────────────────────────────────────────────┤
│ [◔ Review 4+]  ✗ CI 2  ▲ Changes 1  … Waiting 3+  ✓ Ready 1                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ platform#412  Retry in webhook sender         review requested · 2d        │
│   ledger#88     Fix invoice rounding            re-requested · 1d            │
│   web#1031      New form lib: settings          via team @acme/core · 5d     │
│                                                                              │
│   + means the search hit its 100-result cap; narrow it with s or /           │
├──────────────────────────────────────────────────────────────────────────────┤
│ why  review requested of you Oct 20 · head 3fa91c2 · CI 9/9 · seen 2m ago    │
╰──────────────────────────────────────────────────────────────────────────────╯
 j/k move │ Enter review │ r retry at 14:32 │ s scope │ ? help
```

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com              ⊘ offline · cached 14m ago │
│ ⊘ offline: cannot reach github.com. Showing the last good result.            │
├──────────────────────────────────────────────────────────────────────────────┤
│ [◔ Review 4+]  ✗ CI 2  ▲ Changes 1  … Waiting 3+  ✓ Ready 1                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ platform#412  Retry in webhook sender         review requested · 2d        │
│   ledger#88     Fix invoice rounding            re-requested · 1d            │
│   web#1031      New form lib: settings          via team @acme/core · 5d     │
│                                                                              │
│   data may be out of date; it refreshes by itself when the network returns   │
├──────────────────────────────────────────────────────────────────────────────┤
│ why  review requested of you Oct 20 · head 3fa91c2 · CI 9/9 · seen 2m ago    │
╰──────────────────────────────────────────────────────────────────────────────╯
 j/k move │ Enter review (cached) │ r retry now │ ? help
```

Both keep the last good result on screen and state its age; neither blanks the list.

## Cross-variant notes

| Concern | A | B | C |
|---|---|---|---|
| Fits 80 columns without a new layout | yes | no (chip header) | yes |
| Counts equal visible rows | no (capped sections) | yes | yes (via filter) |
| Scope plus status as separate axes | no | yes | partly (chips) |
| New focus targets | headings | sidebar | none |
| Closest to code that exists | low | medium (Sidebar.jsx) | high (list.jsx) |

Hand-off contract for #201 / #279 (what the queue passes to PR detail and gets back):
`{ host, repo, number, headSha, reason, groupId, scopeId }` out; cursor, group, scope
and scroll restored on return (`usePaneState`, as `list.jsx` already does).

## Recommendation

Variant B. It is the only one that gives scope and status separate controls, which
is what the 2026-10-22 amendment asks for, and counts always equal the rows beneath
them. The 80-column chip header is a cheap degradation of the same model. If cost is
the overriding constraint, C is the fallback and can grow into B later.

## Open questions for the maintainer

1. Footer shows no write verbs in the queue (per #177 reconciliation), but #312 budgets
   "approve from the queue in 3 keys or fewer". Which wins? This mockup assumes the
   read-only queue and `g p` as the labelled exit; the budget then applies to the
   management list.
2. Should `Enter` on a PR open PR detail (#201 layout) directly, or the existing
   `detail.jsx`? This mockup assumes the new layout.
3. Is "involves me" (author, reviewer, assignee, mentioned) the right default query, or
   only review-requested plus authored?
4. Do saved repository sets live in TOML (`[scopes.work]`) or in the persisted state?
5. Group order: is CI failing above or below needs my review for you?
