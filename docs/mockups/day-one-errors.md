# Mockup: day-one failure messages and teaching empty states

Issue #313, with #177 (queue states) and #129/#146 (out of scope here). Protocol B
step 1. Every case says what happened in plain language, names the thing involved
(org, scope, host, time) and gives the exact next step. Nothing is implemented.

## What exists today (checked in the source)

- `src/bootstrap.js` prints plain terminal text when `gh` is missing (with per-OS
  install commands) or when `gh auth token` fails, before the TUI starts.
- `src/features/onboarding/flow.js` has `classifyFailure(err)` returning one of
  `no_gh | auth | rate_limit | permission | error`; it matches `rate limit` and not SAML,
  scope names, reset times, or network errors separately.
- `src/hooks/useGhHealth.js` tracks a degraded state for the status bar.
- Pane components show raw `error.message` (see `src/features/tabs/pane.jsx`: `⚠ {error.message}`).

So #313 extends `classifyFailure` next to `runGh()` into a shared classifier and gives
the UI one component to render it; the mockups below are that component's outputs.

## Message anatomy (all cases)

1. Glyph plus plain-language cause, one line. Glyph is paired with a word, never color
   alone: `✗` blocked (`status.error`), `⚠` degraded (`status.warning`), `◷` waiting
   (`status.info`), `⊘` offline (`fg.subtle`).
2. What is affected and what is not ("Other organizations are unaffected").
3. The fix as a literal command in `fg.default`, copyable with `y`. Never a URL that
   contains a credential or one-time token: the SSO page is opened with `o`, not printed.
4. Footer keys that work now (`r` retry, `y` copy, `o` open, `?` details).
5. All text passes `sanitize()`; tokens, `Authorization` headers and URLs with
   credentials are stripped before display or logging.

## Detection (expected shapes; to be captured into fixtures per #313)

| Case | Detected from | Names |
|---|---|---|
| gh missing | spawn `ENOENT` for `gh` | none |
| gh too old | `gh --version` below the minimum in `docs/COMPATIBILITY.md` | both versions |
| Not signed in | `gh auth token` exits non-zero for the host (as `checkAuth()` does today) | host |
| Wrong host | `origin` host (SSH aliases resolved by `detectHostFromRemote`) differs from every signed-in host | both hosts |
| SAML SSO | 403 / GraphQL error text "Resource protected by organization SAML enforcement" | owner of the failing repo |
| Missing scope | GraphQL "requires one of the following scopes" or REST 403 "not accessible by personal access token" | scope when the message lists it, else "a missing scope" |
| Rate limit | 403/429 "API rate limit exceeded"; reset from `x-ratelimit-reset` or `gh api rate_limit` (which is not counted) | limit family (core, search, GraphQL) and local reset time |
| Secondary limit | "secondary rate limit" with `retry-after` | seconds and local time |
| Offline | "error connecting to api.github.com" | host |
| Not found vs no access | 404 on a repo (GitHub does not distinguish) | repo |
| Partial | any of the above for a subset of repos in one refresh | repos |

## 1. gh missing or too old (before the TUI exists, plain terminal)

```
$ lazyhub

  ✗ The GitHub CLI (gh) is not installed, so lazyhub cannot read GitHub.

    Install it:     brew install gh        (macOS)
                    https://cli.github.com (other systems)
    Then run:       gh auth login
    Then run:       lazyhub

  lazyhub only reads through your own gh login. Nothing was changed.
```

```
$ lazyhub

  ✗ Your GitHub CLI is too old: gh 2.12.0 found, 2.40.0 or newer needed.
    (versions shown are illustrative; the real minimum comes from COMPATIBILITY.md)

    Update it:      brew upgrade gh        (macOS)
                    https://cli.github.com (other systems)
    Then run:       lazyhub
```

## 2. Not signed in

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ lazyhub · first run                               github.com · not signed in │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ ✗ You are not signed in to GitHub.                                           │
│                                                                              │
│ lazyhub uses your existing gh login and never asks for a token itself.       │
│                                                                              │
│ In another terminal run:                                                     │
│     gh auth login                                                            │
│                                                                              │
│ Pick GitHub.com, HTTPS, then "Login with a web browser". Come back here      │
│ and press r; no restart needed.                                              │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
 r check again │ y copy command │ q quit (nothing was changed)
```

## 3. Wrong host (GHES)

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ lazyhub · first run                              ghe.acme.io · not signed in │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ ✗ This repo is on ghe.acme.io, but gh is only signed in to github.com.       │
│                                                                              │
│ Signed in:      github.com                                                   │
│ Needed:         ghe.acme.io        (from the origin remote here)             │
│                                                                              │
│ In another terminal run:                                                     │
│     gh auth login --hostname ghe.acme.io                                     │
│                                                                              │
│ Hosts are never mixed: lazyhub will show ghe.acme.io on its own. To see      │
│ github.com instead, press h and choose it.                                   │
╰──────────────────────────────────────────────────────────────────────────────╯
 r check again │ y copy command │ h choose host │ q quit
```

## 4. SAML SSO not authorized (names the org)

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                      ⚠ partial · 2m ago │
│ scope: account · involves me                                  s change scope │
├──────────────────────────────────────────────────────────────────────────────┤
│ [◔ Review 3]  ✗ CI 2  ▲ Changes 1  … Waiting 3  ✓ Ready 1                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ platform#412  Retry in webhook sender         review requested · 2d        │
│   ledger#88     Fix invoice rounding            re-requested · 1d            │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⚠ The organization acme has not authorized your gh token (SAML SSO).         │
│   Its repositories are hidden from this list: acme/billing and 2 others.     │
│   Fix:  gh auth refresh -h github.com                                        │
│         then choose "Authorize" for acme in the browser page that opens.     │
│   Other organizations are unaffected.                                        │
╰──────────────────────────────────────────────────────────────────────────────╯
 r retry │ y copy command │ o open GitHub token page │ ? details
```

## 5. Missing token scope (names the scope)

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                      ⚠ partial · 2m ago │
│ scope: account · involves me                                  s change scope │
├──────────────────────────────────────────────────────────────────────────────┤
│ [◔ Review 3]  ✗ CI 2  ▲ Changes 1  … Waiting 3  ✓ Ready 1                    │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ platform#412  Retry in webhook sender         review requested · 2d        │
│   ledger#88     Fix invoice rounding            re-requested · 1d            │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⚠ Your gh token lacks the read:org scope, so team review requests            │
│   (for example @acme/core) are not shown.                                    │
│   Fix:  gh auth refresh -h github.com -s read:org                            │
│   Direct review requests and your own PRs are still listed.                  │
╰──────────────────────────────────────────────────────────────────────────────╯
 r retry │ y copy command │ ? details
```

## 6. Rate limit with local reset time

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                          ◷ cache 4m old │
│ ◷ GitHub API rate limit reached: search, 30 requests per minute.             │
├──────────────────────────────────────────────────────────────────────────────┤
│ [◔ Review 4+]  ✗ CI 2  ▲ Changes 1  … Waiting 3+  ✓ Ready 1                  │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ platform#412  Retry in webhook sender         review requested · 2d        │
│   ledger#88     Fix invoice rounding            re-requested · 1d            │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ ◷ Resets at 14:32 your time (in 6m). lazyhub will refresh by itself then.    │
│   Nothing is lost: the list above is the last good result.                   │
│   Other API limits: core 4,812 of 5,000 left, GraphQL 4,950 of 5,000 left.   │
╰──────────────────────────────────────────────────────────────────────────────╯
 r retry at 14:32 │ ? details
```

Secondary limit (shorter, retry shown):

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ PR #412 · Conversation                                         ◷ slowed down │
├──────────────────────────────────────────────────────────────────────────────┤
│ ◷ GitHub asked lazyhub to slow down (secondary rate limit).                  │
│   Retrying in 45s, at 14:27. Reading continues from the cache meanwhile.     │
│   Cause is usually many requests in a short burst; no action needed.         │
╰──────────────────────────────────────────────────────────────────────────────╯
 r retry now │ ? details
```

## 7. Offline

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com              ⊘ offline · cached 14m ago │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⊘ Cannot reach api.github.com. Check your network or githubstatus.com.       │
│   Showing the last good result from 14:02. It refreshes when you are back.   │
│   Reading works. Anything that needs GitHub is disabled until then.          │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ platform#412  Retry in webhook sender         review requested · 2d        │
│   ledger#88     Fix invoice rounding            re-requested · 1d            │
╰──────────────────────────────────────────────────────────────────────────────╯
 r retry now │ Enter review (cached) │ ? details
```

## 8. Partial data

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                        ⚠ 12 of 14 repos │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▶ platform#412  Retry in webhook sender         review requested · 2d        │
│   ledger#88     Fix invoice rounding            re-requested · 1d            │
├──────────────────────────────────────────────────────────────────────────────┤
│ ⚠ 2 repositories did not load; the rest are complete and usable.             │
│     acme/billing   SAML SSO not authorized for acme   (gh auth refresh)      │
│     acme/legacy    not found, or you have no access   (ask an admin)         │
│   Counts above may be low until these load.                                  │
╰──────────────────────────────────────────────────────────────────────────────╯
 r retry failed │ ? details
```

Repo not found versus no access (GitHub gives one answer for both, so the message says so):

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ acme/legacy                                                       github.com │
├──────────────────────────────────────────────────────────────────────────────┤
│ ✗ acme/legacy was not found, or your account cannot see it.                  │
│   GitHub returns the same answer for both on purpose. Check the spelling,    │
│   then ask an owner of acme for access. If acme enforces SAML SSO, run       │
│       gh auth refresh -h github.com                                          │
╰──────────────────────────────────────────────────────────────────────────────╯
 r retry │ y copy command │ q back
```

## 9. Teaching empty states

An empty list names the cause (nothing matched, versus nothing exists) and the next
action as a key. Three examples:

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Home · account @octocat · github.com                      ⟳ updated just now │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ No review requests · nothing needs you right now.                            │
│                                                                              │
│ Checked 14 repositories on github.com at 14:02.                              │
│                                                                              │
│ /      search every PR in scope                                              │
│ s      change scope: org acme, org octocat, set work                         │
│ g p    browse all PRs, including closed                                      │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
 / search │ s scope │ g p browse PRs │ ? help
```

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ Search · "webhook retry" · scope: account                         github.com │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ No PRs match "webhook retry" in this scope (open and closed).                │
│                                                                              │
│ Try:                                                                         │
│     fewer words                 webhook                                      │
│     another scope               s                                            │
│     GitHub qualifiers           author:maria-lopez  label:bug                │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
 Esc clear │ s scope │ ? search syntax
```

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ acme/docs#77 · 3 Checks                                         head 5be0a41 │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│ No checks reported for this commit.                                          │
│                                                                              │
│ This repository has no workflows that ran on this PR. If you expected CI:    │
│     o   open the repository Actions tab                                      │
│     2   see whether the commits are on the right branch                      │
│                                                                              │
╰──────────────────────────────────────────────────────────────────────────────╯
 1-4 section │ o browser │ Esc queue │ ? help
```

## Recommendation

Ship one shared message component fed by an extended `classifyFailure`, rendered as
an inline banner under the header when the rest of the screen is still usable (cases
4 to 8) and as a full panel only when nothing can load (cases 1 to 3). This keeps the
queue useful during partial failure, which is the common day-one situation in
organizations.

## Open questions for the maintainer

1. Minimum `gh` version: take it from `docs/COMPATIBILITY.md` or probe for the features
   lazyhub needs? The 2.40.0 above is illustrative.
2. Is `h` (choose host) the right key in the wrong-host panel, given hosts are never
   mixed? Alternative: list hosts as rows under the message.
3. May lazyhub open the SSO authorization page itself (`o`), or only print the command?
   Opening is more helpful but launches a browser from a read-only tool.
4. Should rate-limit detail show other families (core, GraphQL) as drawn, or only the
   one that tripped? Showing them costs one uncounted `gh api rate_limit` call.
5. Secondary-limit auto-retry: #313 excludes backoff policy changes. Is a single timed
   retry shown here acceptable, or should the message only say when to press `r`?
