# Mockup: review queue scope (this repo, account, org, repository set)

Issue #177 amendment 2026-10-22. Protocol B step 1. Implements the "Launched inside a
git repo" state of `review-queue-account-wide.md` (variant B, chosen by the maintainer),
and adds the org and repository-set scopes the same amendment asks for. One variant:
the amendment already fixes the behaviour, and the committed variant B chrome is reused
unchanged, so only the scope row and the empty state text differ.

## Behaviour

- Launched in a clone (or with `--repo`): starts on `repo owner/name`. Launched anywhere
  else (saved default, first-run picker, `owner/repo#N`, outside a repo): `account`.
- `s` cycles `repo` (only when launched in a clone), `account`, one `org` per owner
  (the launch repo's owner and `[queue].orgs`), one `set` per `[queue.sets]` entry, then
  wraps. The scope row always names the current scope and the next one.
- Each scope is its own search, kept in memory per host and scope: cycling back to a
  fresh scope makes no gh call; `r` refreshes the current scope only.
- Outside a clone the last scope is remembered (`[state].queueScope`). A repo scope is
  where you are, not a preference, so it is never saved and always wins at launch.
- Read-only everywhere. Hosts are never mixed (the query runs on `GH_HOST`).

## Config

```toml
[queue]
orgs = ["acme"]

[queue.sets]
work = ["acme/api", "acme/web", "acme/ledger"]
```

## Launched in a clone, 80 columns

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Review queue  repo acme/platform · github.com               ⟳ updated 2m ago │
│ scope: repo acme/platform (from this directory) · read-only · s: account     │
│ [◔ Review 1]  ✗ CI 1  ▲ Changes 0  … Waiting 1  ✓ Ready 0                    │
│ ▶ platform#412  Retry in webhook sender         review requested · 2d        │
│                                                                              │
│ 1 of 1 in Needs my review                                                    │
│ ─────────────────────────────────────────────────────────────────────────────│
│ why  review requested of you Oct 20 · head 3fa91c2 · CI 9/9 · seen 2m ago    │
╰──────────────────────────────────────────────────────────────────────────────╯
 j/k move │ Enter open │ o browser │ ]/[ group │ s scope │ + more │ r refresh
```

## After `s`: account, then org, then set

```
│ Review queue  account @octocat · github.com                 ⟳ updated 2m ago │
│ scope: account · review requests and PRs you opened · read-only · s: org acme│

│ Review queue  org acme · github.com                         ⟳ updated 1m ago │
│ scope: org acme (every repo in acme) · read-only · s: set work               │

│ Review queue  set work · github.com                         ⟳ updated 1m ago │
│ scope: set work (3 repos) · read-only · s: repo acme/platform                │
```

## Nothing configured outside a clone

```
│ scope: account · review requests and PRs you opened · read-only · no org or  │
│ set in [queue] config                                                        │
```

`s` does nothing here (one scope), and the row says where to add more.

## Empty in a scope

```
│ Nothing needs your attention here.                                           │
│ No open pull request requests your review or was opened by you in repo       │
│ acme/platform on github.com.                                                 │
│ s changes the scope (next: account); r checks again.                         │
```

Account keeps the existing wording ("... opened by you on github.com").

## 120 columns

Same as `review-queue-account-wide.md` variant B: the status sidebar and CI column are
unchanged; only the title (`repo acme/platform` instead of `account @octocat`) and the
scope row change.
