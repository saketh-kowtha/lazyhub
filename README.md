# lazyhub

**Review pull requests, evidence and CI from your terminal.** A keyboard-driven GitHub workspace for maintainers who now review more agent-written PRs than they can read line by line. It uses the `gh` session you already have.

![lazyhub PR review demo](docs/demo/out/tour.gif)

[![CI](https://github.com/saketh-kowtha/lazyhub/actions/workflows/ci.yml/badge.svg)](https://github.com/saketh-kowtha/lazyhub/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/lazyhub?color=3fb950&label=npm)](https://www.npmjs.com/package/lazyhub)
[![Node.js ≥20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Homebrew](https://img.shields.io/badge/brew-install-orange?logo=homebrew)](https://github.com/saketh-kowtha/homebrew-tap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why

When coding agents open PRs faster than you can read them, the hard part is not clicking Approve. It is knowing which PR needs you, what it really changes, and whether its description is true. lazyhub puts that in one place:

- **Find what needs you.** A review queue lists PRs that wait on you and says why for each row.
- **See the evidence.** Facts, sources, freshness and the exact head commit inspected, read-only.
- **Check the story.** Compare the claims in a PR description with the diff, and trace red CI to the changed lines.

The core review journey needs no AI provider, GitHub App or agent. What it shows comes from `gh`, and it writes to GitHub only when you press a write key yourself.

## Install

Requirements: Node.js 20 or later and the [`gh` CLI](https://cli.github.com/), authenticated with `gh auth login` (check with `gh auth status`). If no session is found, an interactive start opens the GitHub CLI login flow.

```sh
npm install -g lazyhub                  # npm
brew install saketh-kowtha/tap/lazyhub  # Homebrew
npx lazyhub                             # try it without installing
```

npm and Homebrew are the supported channels. A published release can lag `main`, so a feature below may be missing from an older install: check `lazyhub --version` and `lazyhub --help`.

If your shell says `lazyhub: command not found` right after installing, open a new terminal or run `hash -r`, and make sure the npm global bin directory (`npm prefix -g`, then its `bin` folder) is on your `PATH`.

## 60-second quick start

```sh
cd path/to/a-github-repo
lazyhub
```

1. First run only: pick a repository in the short setup (rerun any time with `lazyhub --onboarding`). The `Focus` pane opens with your review requests, your open PRs and your assigned issues.
2. `g q` opens the review queue. `j`/`k` move, `Enter` opens a PR.
3. In the PR, press `e` for evidence, `f` if CI is red, `V` to check the description's claims, `d` for the diff.
4. `?` shows the keys for the current view. `:` opens the command palette. `q` goes back.

Other ways in: `lazyhub owner/repo#123` (also `'#123'`, `123` or a PR/issue URL) opens an item directly and read-only; `lazyhub --repo owner/name` opens another repository for that launch without saving it; `:` then "Switch repository" changes it without restarting.

## What you can do

### Triage: find work that needs you

- **Review queue** (`g q`): open PRs that request your review or that you opened, each with the reason it needs attention. `]`/`[` change status group, `Enter` opens the PR, `o` opens it in the browser, `+` loads more.
- **Focus, PRs, Issues, Branches, Actions and Notifications** panes (`g h`, `g p`, `g i`, `g b`, `g a`, `g n`, or `1`-`9`). Lists page through what GitHub returns and say so when GitHub's own search cap applies, for example `1000 of 5000`.
- **Fewer key presses.** Row actions work without opening the PR (`a` approve, `x` request changes, `c` comment, `m` merge, `l` labels, `b` checkout; destructive ones still confirm). The PR state filter is remembered per repository, and the PR scope (mine, reviewing, all) is remembered across launches.
- **Smart Enter** is opt-in: set `[state] smartEnter = true` and `Enter` on an open PR row jumps to the failed check log, the diff (when your review is requested) or the conflict summary. By default `Enter` opens the plain PR detail.
- **Collision radar** (`K` in a PR): other open PRs that touch the same files, plus a suggested merge order. Add your own generated files with `[features.prs].generated_files`.

### Review: understand the change

- **Review evidence** (`e`): read-only facts, their sources, how fresh they are, and the head commit that was inspected. Opening a PR from the queue lets you return to the queue.
- **Review story** (`s`): a guided step-by-step walkthrough of the diff (`n`/`p` step, `Enter` opens the diff at the file, `Space` expands the noise step).
- **Claims check** (`V`): finds claims such as "adds tests" in the description and marks each verified, contradicted or unverifiable against the changed files and patches, with evidence. It is deterministic and uses no AI. Prose that is not a recognised claim is ignored.
- **Diff** (`d`): files load per file, unified or split (`w`), file tree (`T`), file jump (`t`), comment threads (`{`/`}`), inline comment, edit and delete (`c`, `e`, `Ctrl+X`), open in `$EDITOR` (`E`).
- **Comments** (`v`): reply, edit, resolve (`z`), filter, jump to the line in the diff (`J`).
- **HTML in PR and issue bodies** (details, tables, lists, links, images as alt text) renders as formatted text through a strict allowlist. Scripts, styles, iframes and forms are dropped with a visible marker, and nothing is fetched. Issue comments still render as plain text.

### CI: why is it red?

- **Why CI is red** (`f` in a PR or its checks): the failing check, a log excerpt and the PR lines that likely caused it. In a log, `f` switches between the failure excerpt and the full log.
- **Checks** (`c`): per-check log (`Enter`), browser (`o`), re-run (`Ctrl+R`). The Actions pane lists workflow runs with logs, re-run and cancel.

### AI (optional)

- `A` in the diff runs an AI review; `Ctrl+A` opens a read-only assistant. AI output is labelled as AI and is never posted to GitHub automatically.
- Providers: Claude Code, Codex, Gemini CLI, the Anthropic API, or an OpenAI-compatible endpoint (`[defaults] ai_provider`).
- **Existing subscriptions.** For Claude Code run `claude setup-token` and export `CLAUDE_CODE_OAUTH_TOKEN`. For Codex, `lazyhub ai login enable codex` (asks for consent first) uses its own subscription login, and `lazyhub ai login disable codex` revokes it at once. `lazyhub ai status` shows each provider and why one is unavailable. Login mode for Gemini CLI is not implemented yet.
- **MCP server:** `lazyhub --mcp` serves GitHub reads over stdio to MCP clients. It is read-only: every model- or agent-originated write is disabled. Review-specific MCP tools (queue, evidence, why-red, claims) are not shipped yet.

## Keys

Press `?` in any view for the authoritative list. `Space` is the leader key; `:` or `Space Space` opens the command palette.

| Where | Keys |
|---|---|
| Everywhere | `?` help, `:` palette, `,` settings, `Tab`/`Shift+Tab` next/previous pane, `1`-`9` jump to pane (list views), `g h/p/i/b/a/n/q` go to Focus/PRs/Issues/Branches/Actions/Notifications/queue, `q` back (quits at the root), `Esc` back (never quits), `Ctrl+A` AI assistant |
| Lists | `j`/`k` move, `gg`/`G` top/bottom, `/` search, `r` refresh, `Enter` open |
| PR list | `d` diff, `a` approve, `x` request changes, `c` comment, `m` merge, `X` close, `l` labels, `A` assignees, `R` reviewers, `b` checkout, `y` copy URL, `o` browser, `f` cycle state filter, `O`/`C`/`M` open/closed/merged, `s` cycle scope, `@` author, `p` preview, `n` new PR |
| Review queue | `Enter` open, `o` browser, `]`/`[` group, `+` more |
| PR detail | `e` evidence, `s` story, `V` claims, `K` collisions, `f` why red, `c` checks, `d` diff, `v` comments, `C` conflicts / CI, `D` draft/ready, `B` base branch, `E` editor, plus `a` `x` `m` `X` `l` `A` `R` `o` |
| Review story | `n`/`p` next/previous step, `Enter` open diff, `Space` expand |
| Checks | `Enter` log, `o` browser, `Ctrl+R` re-run, `Esc` back |
| Diff | `]`/`[` file, `}`/`{` thread, `t` file jump, `T` tree, `w` split/unified, `n`/`N` match, `g l` go to line, `c` comment, `e` edit, `Ctrl+X` delete, `A` AI review, `v` comments, `E` editor |
| Comments | `c` reply, `e` edit, `Ctrl+X` delete, `z` resolve, `f` filter, `J` jump to diff |
| Issues | `n` new, `X` close, `l` labels, `A` assignees, `f` filter, `O`/`C` open/closed, `s` sort, `y` copy URL, `o` browser; in detail `c` reply, `Q` quote, `e` edit, `n` show new comments |
| Branches | `Enter` checkout, `n` new, `p` push, `Ctrl+X` delete |
| Actions | `Enter`/`l` logs, `Ctrl+R` re-run, `X` cancel, `F` clear branch filter |
| Notifications | `Enter` open, `u` mark read, `U` mark all |

Defaults live in [`src/config/defaultConfig.toml`](src/config/defaultConfig.toml) and can be overridden under `[actions.*]` and `[keymaps.*]` in your config.

## Configuration

Configuration is TOML at `~/.config/lazyhub/lazyhub.toml`, created when first-run setup completes. For example:

```toml
[theme]
name = "lazyhub-dark"

[defaults]
repo = "owner/name"

[state]
smartEnter = true   # opt in: Enter jumps to the failed log, diff or conflicts
```

See [docs/CONFIG_REFERENCE.md](docs/CONFIG_REFERENCE.md) for every key and default. Custom panes and tabs are declared in TOML, and their filters are translated to `gh` arguments by lazyhub. `[state]` is written by lazyhub itself, so keep hand-written notes elsewhere in the file.

## Privacy and security

- **No telemetry.** No analytics or crash reporting is sent. Data goes only to GitHub through `gh`, and to an AI provider only if you use an AI feature.
- **GitHub text is untrusted.** PR titles, bodies, comments and branch names are sanitized for terminal control characters before display, and AI prompts treat them as data. AI CLIs run with tools off, an empty temporary working directory and a minimal environment (no GitHub token).
- **Read-only agent surface.** The MCP server and the in-app assistant offer read-only tools only. Writes you start from the panes still confirm first.
- **Honest limits.** lazyhub reports what it can observe through GitHub. Local work that was never pushed is invisible to it, and incomplete or stale observations are reported as gaps. No GitHub App or required check currently enforces approval; the optional approval stage is future work.
- `LAZYHUB_PERF=1 lazyhub` records local timings, and `lazyhub perf report` summarises them.

See [SECURITY.md](SECURITY.md), [the threat model](docs/THREAT_MODEL.md) and [the coverage contract](docs/CONTRACT.md).

## Performance

The screen is not fully cleared and redrawn, and lists and diffs page instead of loading everything at once. The numbers below come from `npm run test:perf` and `npm run vitals`: a PTY drives the built binary at 80x24 against a fake `gh` with a fixed 300 ms per call, on a fixture of 5,000 PRs, 2,000 issues and a 3,000-file diff (macOS, Node 22). Method and budgets are in [docs/PERF_BUDGETS.md](docs/PERF_BUDGETS.md).

| Metric | Measured | Budget |
|---|---|---|
| Cold PR list, key to first rows (one `gh` round trip) | about 410 ms | 1,200 ms |
| Key to first frame (skeleton) | about 1 ms | 400 ms |
| Key press to next frame, p95 | 8 ms | 100 ms |
| Warm re-open of a visited list | 22 ms | 100 ms |
| Frames that cleared the screen | 0 of 66 | 0 |
| Peak memory over the whole run | 150 to 225 MB | 512 MB |

These are fixture numbers, not a promise about your network. One known gap: re-opening a PR detail you just left still makes one `gh` call (an expected-fail baseline in the vitals harness).

## GitHub Enterprise Server

lazyhub uses `gh`, so a host you have run `gh auth login --hostname` for works. The host is taken from the repository's remote, or set it explicitly: `GH_HOST=github.example.com lazyhub --repo owner/name`. A saved `[defaults].repo` is ignored when `GH_HOST` differs from the host it was saved under. PR and issue URLs on your configured host are accepted as references.

## Troubleshooting

Run `lazyhub doctor` (add `--json` for scripts). It checks the config file, that `gh` is installed, that you are logged in and the review-coverage evidence. `lazyhub doctor --coverage --repo owner/name` and `lazyhub watch-only --repo owner/name` print read-only reports of what lazyhub could observe. `lazyhub feedback` prepares a pre-filled issue with redacted diagnostics, and `lazyhub status` prints review, CI and notification counts. `lazyhub --help` lists every command.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the fixture-based development setup, contribution scope, validation commands and security guidance. The [roadmap](docs/ROADMAP.md) shows the active stage and work order. Demo recordings are made with [VHS](docs/demo/README.md) against a fixture `gh`.

## License

MIT © [Saketh Kowtha](https://github.com/saketh-kowtha)
