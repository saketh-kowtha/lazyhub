# Mockup: review queue "Start here" ranking and signal badges

Issue #177, phase 2 (merged from #363). Protocol B step 1. Builds on the chosen variant B
of `review-queue-account-wide.md` (status sidebar at 120 columns, chip line at 80) and the
scope row of `review-queue-scope.md`; the chrome is unchanged.

## Behaviour

- A new first group, **Start here**, lists every loaded PR in rank order under section
  headings: **Needs you**, **Waiting on others**, **Stale**. It is where the queue opens.
  The status groups (Needs my review, CI failing, ...) are still one `]` away and keep their
  own order (most recently updated first).
- The ranking is a fixed list of sort keys (`src/features/queue/rank.js`); no score, no
  weight. In order:
  1. section: Needs you (review requested of you or via a team; your PR ready to merge;
     your PR blocked by failing CI, requested changes or a merge conflict), then Waiting on
     others (your PR waiting for a review or CI; PRs whose facts are unavailable), then
     Stale (no update for more than `[queue].stale_days`, default 14). A review requested of
     you never goes to Stale.
  2. tier inside the section, in the order just listed;
  3. clear first: CI passing (or none reported), mergeable, not a draft. An unavailable fact
     is "not clear", named;
  4. oldest update first (whole days); unknown last;
  5. smallest change first (added plus deleted lines); unknown last;
  6. repository, then number.
- The strip gains a **rank** line naming every key for the cursor row, and a **sig** line
  listing every signal in words. The why lines are unchanged. When the rank line does not
  fit, the trailing keys switch to short words first; no key is dropped.
- Each row gets a compact cell: estimated size (`XS` <= 10 lines, `S` <= 100, `M` <= 400,
  `L` <= 1000, `XL`), then badges, most important first: `✗CI` (CI red, only where there is
  no CI column), `⚠conf` (GitHub merge conflict), `⑂#N` (collision radar found a likely
  collision with #N), `bot` (GitHub reports a Bot account; a login is never called an
  agent), `draft`. A badge that does not fit becomes `+N`; the sig line lists them all.
- Badges are hidden, never faked: the collision badge is read from the radar's cached
  scan and appears only once the radar has run for that PR this session. Review Story
  (#362) produces no risk rating and Claims check (#361) keeps no per-PR result yet, so
  neither has a badge. The queue never makes a call for a badge.
- Read-only, as before. No new key.

## Variant A (chosen): sections inside the Start here group

### A at 80 columns

```
 Review queue  account @octocat · github.com                       ⟳ updated 2m ago
 scope: account · read-only · s: org acme
 [◆ Start 7]  ◔ Review 2   ✗ CI 1   ▲ Changes 1   … Waiting 1   ✓ Ready 1   ? Unknown 1
   NEEDS YOU 5
 ▶ platform#412 Retry in webhook send… XS       review requested of you    1d
   ledger#88    New form lib           XS       via team @acme/core        2d
   hello#9      Bump dependencies      S        approved, CI passing, mer… 2d
   mailer#57    Upgrade to Node 22     M ⚠conf  changes requested          2d
   platform#409 Shard the worker queue XS ✗CI   1 of 2 checks failing      2d
   WAITING ON OTHERS 1
   docs#31      Docs sweep             XS bot   waiting for a review       2d
   STALE 1  no update in more than 14d
   odd#5        No data PR             ?        CI status unavailable +1   3w

 1 of 7 in Start here
 ──────────────────────────────────────────────────────────────────────────────
 rank 1 of 7: Needs you > review of you > clear > 1d old > XS
 sig  size XS (+3/-1 in 2 files)
 why  review requested of you · head 3fa91c2 · CI 2/2 passed · mergeable · seen
      2m ago
```

### A at 120 columns

```
 Review queue  account @octocat · github.com                                                          ⟳ updated 2m ago
 scope: account · review requests and PRs you opened · read-only · s: org acme
 ▶ ◆ Start here           7    NEEDS YOU 5
 STATUS                      ▶ acme/platform#412 Retry in webhook sender      ✓ 2/2   XS        review requested of you  1d
   ◔ Needs my review      2    acme/ledger#88    New form lib                 ✓ 2/2   XS ⑂#405  via team @acme/core      2d
   ✗ CI failing           1    octocat/hello#9   Bump dependencies            ✓ 2/2   S         approved, CI passing, m… 2d
   ▲ Changes requested    1    acme/mailer#57    Upgrade to Node 22           ✓ 2/2   M ⚠conf   changes requested        2d
   … Waiting on others    1    acme/platform#409 Shard the worker queue       ✗ 1/2   XS        1 of 2 checks failing    2d
   ✓ Ready to merge       1    WAITING ON OTHERS 1
   ? Unavailable data     1    acme/docs#31      Docs sweep                   ✓ 2/2   XS bot    waiting for a review     2d
                               STALE 1  no update in more than 14d
   total 7 loaded              acme/odd#5        No data PR                   ? n/a   ?         CI status unavailable +1 3w

 1 of 7 in Start here
 ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
 rank 1 of 7: Needs you > review requested of you (@alice is waiting) > clear (CI passing, mergeable) > 1d old > XS
 sig  size XS (+3/-1 in 2 files)
 why  review requested of you · head 3fa91c2 · CI 2/2 passed · mergeable · seen 2m ago
```

## Variant B: rank number column, no section headings

```
 [◆ Start 7]  ◔ Review 2   ✗ CI 1   ▲ Changes 1   … Waiting 1   ✓ Ready 1   ? Unknown 1
 ▶  1 platform#412 Retry in webhook… XS      you · review requested of you     1d
    2 ledger#88    New form lib      XS      you · via team @acme/core         2d
    3 hello#9      Bump dependencies S       you · approved, CI passing, m…    2d
    6 docs#31      Docs sweep        XS bot  wait · waiting for a review       2d
    7 odd#5        No data PR        ?       stale · CI status unavailable +1  3w
```

Pros: one line per PR. Cons: the section is a cryptic word on every row, eats title
width at 80 columns, and the number column says nothing the order does not already say.

## Why A

Section headings are the issue's own structure (Needs you / Waiting on others / Stale),
cost one line per section instead of columns on every row, and leave the title its width
at 80 columns. The number is still shown, on the rank line, next to the keys that explain
it. Picked in an unattended run against DESIGN_REFERENCES (secondary metadata gives way
before the title; status is glyph plus word, never colour alone).

## States

Empty, failed, partial and rate-limited states are unchanged from the committed variant B:
Start here is empty exactly when the queue is, and the "not all loaded" notice still
says what the ranking does not cover (it ranks only loaded rows).
