# Responsive layout mockups (#401)

Implements the "Responsive layout" section of `docs/DESIGN_REVAMP.md`. One variant per
breakpoint; the breakpoint is chosen from the terminal size by `computeLayout()`
(`src/hooks/useLayout.js`). Widths are in columns.

## wide (>= 110 cols): sidebar + list, preview allowed

```
╭───────────────────────╭───────────────────────────────────────────────────────────────────╮
│ ⌂ lazyhub             │ ⎇  Pull Requests 12                                               │
│ saketh-kowtha/lazyhub │───────────────────────────────────────────────────────────────────│
│ ───────────────────── │ open/closed/merged · mine [O]open [C]closed [M]merged [s]scope    │
│ ▎⎇ Pull Requests    2 │ ▎● #186  PTY harness fixture PR            @octocat       4mo     │
│  ⚑ Issues           3 │    ● #185  Fix the thing                   @hubot         1d      │
│  ⌥ Branches         4 │                        ╭──────────────────────────────────╮       │
│  ↯ Actions          5 │                        │ preview (hover popover, 52x15)   │       │
│  ✦ Notifications    6 │                        ╰──────────────────────────────────╯       │
│ ───────────────────── │                                                                   │
│ ? help · S cfg · E e… │                                                                   │
╰───────────────────────╰───────────────────────────────────────────────────────────────────╯
 ⎇  Pull Requests  ·  saketh-kowtha/lazyhub  ·  12 items                       ⟳ just now
───────────────────────────────────────────────────────────────────────────────────────────
 j/k nav │ Tab pane  ┊  Enter open │ d diff │ a approve │ m merge │ f filter  ┊  / search │ ? help
```

## medium (80-109 cols): sidebar, preview collapsed

The hover preview is drawn only if the pane can hold it (rows >= 23 and cols >= 70);
the footer drops its lowest-priority keys (the last ones) to stay on one row.

```
╭───────────────────────╭──────────────────────────────────────────────────────╮
│ ⌂ lazyhub             │ ⎇  Pull Requests 12                                  │
│ saketh-kowtha/lazyh…  │──────────────────────────────────────────────────────│
│ ────────────────────  │ open/closed/merged · mine [s]scope [@]author         │
│  ▣ Focus            1 │ ▎● #186  PTY harne…  @octocat      4mo               │
│ ▎⎇ Pull Requests    2 │    ● #185  Fix the thing  @hubot   1d                │
│  ⚑ Issues           3 │                                                      │
│  ...                  │                                                      │
╰───────────────────────╰──────────────────────────────────────────────────────╯
 ⎇  Pull Requests  ·  saketh-kowtha/lazyhub  ·  12 items         ⟳ just now
────────────────────────────────────────────────────────────────────────────────
 j/k nav  ┊  Enter open │ d diff │ a approve │ m merge │ f filter      │ ? help
```

## narrow (< 80 cols): no sidebar, one-row tab strip

The active pane shows its label, the others only their icon. Below 56 columns the tab
separators shrink to one space. Below 20 rows the footer is hidden (compact footer).

```
 ▣ │ ▎ ⎇ Pull Requests │ ⚑ │ ⌥ │ ↯ │ ✦
╭────────────────────────────────────────────────────────────────────╮
│ ⎇  Pull Requests 12                                                │
│────────────────────────────────────────────────────────────────────│
│ open/closed/merged · mine [s]scope [@]author                       │
│ ▎● #186  PTY harness fixture PR    @octocat      4mo               │
│    ⌥  feature/pty → main                                           │
╰────────────────────────────────────────────────────────────────────╯
 ⎇  Pull Requests  ·  saketh-kowtha/lazyhub  ·  12 items
──────────────────────────────────────────────────────────────────────
 j/k nav  ┊  Enter open │ d diff │ a approve │ m merge       │ ? help
```

## narrow and short (< 20 rows): compact footer

```
 ▣ ▎ ⎇ Pull Requests ⚑ ⌥ ↯ ✦
╭────────────────────────────────────────────────╮
│ ⎇  Pull Requests 12                            │
│────────────────────────────────────────────────│
│ open/closed/merged · mine [s]scope [@]author   │
│ ▎● #186  PTY har…  @octocat      4mo           │
╰────────────────────────────────────────────────╯
 ⎇  Pull Requests  ·  saketh-kowtha/lazyhub  ·  …
```

## too small (< 40 cols or < 10 rows)

```


         Terminal too small
            needs 40x10
             now 36x12


```

`q` still quits; the frame returns on its own as soon as the terminal grows.

## degraded banner (status bar, 80 cols)

The message is ellipsized; the retry hint is never dropped.

```
 ✦  focus                    GitHub API rate limit exc… - press r to retry
```

## help overlay (60x18)

Clamped to the pane area; rows that do not fit are clipped at the bottom, the title and
the close hint stay.

```
 ╭────────────────────────────────────────────────────────╮
 │ ⌨  Keyboard Reference                      [Esc] close │
 │ ⎇  Pull Requests list                                  │
 │ ────────────────────────────────────────               │
 │ j/k                 Move the cursor down               │
 │ r                   Refresh the active …               │
 │ ...                                                    │
 │ Config: ~/.config/lazyhub/lazyhub.toml                 │
 ╰────────────────────────────────────────────────────────╯
```
