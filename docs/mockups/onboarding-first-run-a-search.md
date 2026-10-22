# Mockup: first-run onboarding, variant A + search / windowed list

Issues #280 (repository selection stays visible and searchable) and #290
(persist the chosen repo). Extends `onboarding-first-run-a-stepper.md`, step 1
only; step 2 (report) and the error panel are unchanged. Same single bordered
panel, accent (`ui.selected`) only on: active step, focused row, primary key.

Why this layout (DESIGN_REVAMP / DESIGN_REFERENCES): one column, no new chrome,
list is a scrolling window sized from the terminal rows so the focused row can
never fall below the fold; the search line reuses the dim/selected token pair
used by other filter prompts; footer lists exactly the keys that have handlers.

Row budget at 24 rows: border 2, header 1, stepper 1, intro 2, prompt 1,
search 1, range 1, footer rule + hints 2 = 11 fixed, plus one spare row so the
frame never fills the screen (+1 each when the list-unavailable notice or a
lookup message shows). The window gets the rest, never fewer than 3 rows.

## Step 1, 80x24, 31+ repositories, scrolled (selected row 14 stays in view)

```
╭──────────────────────────────────────────────────────────────────────────────╮
│ lazyhub · first run · octocat                       watch-only · read-only   │
│ [1 Repository] › 2 Report                                                    │
│ lazyhub will only READ through your existing gh login. It installs nothing,  │
│ creates no checks, changes no rulesets and writes nothing to GitHub.         │
│ Pick a repository to observe:                                                │
│   acme/ledger                                                                │
│   acme/mailer                                                                │
│   acme/metrics                                                               │
│   acme/ops                                                                   │
│ ▶ acme/platform                                                              │
│   acme/search                                                                │
│   acme/web                                                                   │
│   octocat/hello-world                                                        │
│   octocat/spoon-knife                                                        │
│ / search · type owner/name to look up any repository                         │
│ 5-13 of 31                                                   │
╰──────────────────────────────────────────────────────────────────────────────╯
 / search │ j/k move │ Enter observe │ q quit (nothing is written)
```

## Search active, matches loaded repos

```
│ Pick a repository to observe:                                                │
│ ▶ acme/platform                                                              │
│   acme/platform-docs                                                         │
│ Search: plat_                                                                │
│ 1-2 of 2 matching (31 loaded)                                                │
╰──────────────────────────────────────────────────────────────────────────────╯
 Up/Down move │ Enter observe │ Esc clear search
```

## Search active, repository beyond the first page (validated owner/name)

A synthetic last row appears only when the text is a valid `owner/name` that
is not already listed. Enter runs one read-only `gh repo view` to confirm the
repository exists and is readable, then continues to the report with the
canonical name from GitHub. Failure keeps the user here with a message.

```
│ Pick a repository to observe:                                                │
│ ▶ look up other-org/rarely-used on GitHub (read-only)                        │
│ Search: other-org/rarely-used_                                               │
│ Checking other-org/rarely-used (read-only)...                                │
╰──────────────────────────────────────────────────────────────────────────────╯
 Up/Down move │ Enter observe │ Esc clear search
```

Failure line (in `ci.fail`): `other-org/rarely-used was not found, or your gh login cannot read it.`

## Empty states

```
│ No repositories found for this account.                                      │   (no list, no search text)
│ No loaded repository matches "zzz". Try owner/name to look one up.           │   (filter, no match, not owner/name)
```

Tokens: border `ui.border`; title/active step/focused row/hint keys
`ui.selected`; rows and search text `ui.muted`; range line and hints `ui.dim`;
lookup failure `ci.fail`; list-unavailable notice `ci.pending`.
