# lazyhub

**A terminal workspace for reviewing GitHub changes.** lazyhub helps maintainers inspect pull requests, diffs, review comments and checks from the keyboard, using the GitHub CLI session they already have.

![lazyhub PR review demo](docs/demo/out/tour.gif)

[![CI](https://github.com/saketh-kowtha/lazyhub/actions/workflows/ci.yml/badge.svg)](https://github.com/saketh-kowtha/lazyhub/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/lazyhub?color=3fb950&label=npm)](https://www.npmjs.com/package/lazyhub)
[![Node.js ≥20](https://img.shields.io/badge/node-%3E%3D20-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Homebrew](https://img.shields.io/badge/brew-install-orange?logo=homebrew)](https://github.com/saketh-kowtha/homebrew-tap)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Review a change in your terminal

On current `main`, lazyhub provides the established GitHub workflow: browse pull requests, open their details, inspect a diff and conversation, read checks, and use the available review actions. It also has Issues, Branches, Actions and Notifications panes. The `Focus` pane is the default starting view.

The current main branch also includes a read-only first-run report and local coverage diagnostics. The first-run flow starts automatically on an interactive first launch (or with `lazyhub --onboarding`). Run `lazyhub <reference>` (such as `owner/repo#123`, `#123`, `123` or a PR/issue URL) to open a pull request or issue directly, `lazyhub watch-only --repo owner/name` to inspect GitHub-visible PR activity, `lazyhub doctor --coverage --repo owner/name` for a local coverage report, or `lazyhub feedback` to prepare a redacted diagnostics report. These reports describe what lazyhub could observe; they do not block, approve or enforce work. GitHub-side observation cannot see local work that was never pushed, and incomplete or stale observations are reported as gaps.

The optional App-based approval stage is future work. No GitHub App or required check currently enforces Lazyhub approval. AI review, editor integrations and existing management actions are separate features; they are not required for the read-only review reports.

The npm and Homebrew packages are the supported install channels. Their published versions can lag repository `main`; the review reports and commands above are available only in releases that include them. Check the installed release and its `--help` output if a command is unavailable.

## Install

Requirements: Node.js 20 or later and the [`gh` CLI](https://cli.github.com/). Authenticate with `gh auth login` before starting, or let an interactive lazyhub startup open the GitHub CLI login flow if no session is found. Check the session with `gh auth status`.

```sh
npm install -g lazyhub
```

Or install with Homebrew:

```sh
brew install saketh-kowtha/tap/lazyhub
```

Run `lazyhub` inside a GitHub repository to use that repository, pass a PR or issue reference such as `lazyhub owner/repo#123` or `lazyhub '#123'`, or provide `--repo owner/name` to commands that accept it. On first run (or with `lazyhub --onboarding`), lazyhub guides you through choosing a repository and creates `~/.config/lazyhub/lazyhub.toml` when setup completes; cancelling leaves no first-run selection behind. See [the TOML configuration reference](docs/CONFIG_REFERENCE.md).

## A read-only report

```sh
lazyhub watch-only --repo owner/name
lazyhub doctor --coverage --repo owner/name
```

`watch-only` reads PR timelines, commits, reviews and checks through `gh`. It requires no AI provider, GitHub App or agent/MCP configuration. The doctor report adds local repository identity and evidence about known alternate paths. Both are read-only and local. They describe observed evidence, not proof that every path was seen or controlled. See [the coverage contract](docs/CONTRACT.md) and [the threat model](docs/THREAT_MODEL.md).

## Navigate

Use `j`/`k` to move, `Tab` to switch panes, number keys `1`–`9` or `g` (`g h`, `g p`, `g i`, `g b`, `g a`, `g n`) to jump directly to a pane, `Enter` to open an item, `:` (or `<Space><Space>`) for the command palette, and `?` for the current view's help. In a pull request, inspect the conversation and checks or press `d` to open the diff. The help overlay is the source for available actions in each view.

The app keeps its existing GitHub management features, including review and merge actions. These actions are separate from the read-only reports and follow the confirmation shown in the interface.

`LAZYHUB_PERF=1 lazyhub` records local performance data; `lazyhub perf report` summarizes it. No analytics or crash reporting is sent. More about local data and disclosure is in [SECURITY.md](SECURITY.md).

## Configuration

Configuration is TOML, stored at `~/.config/lazyhub/lazyhub.toml`. For example:

```toml
[theme]
name = "lazyhub-dark"

[defaults]
repo = "owner/name"
```

See [docs/CONFIG_REFERENCE.md](docs/CONFIG_REFERENCE.md) for supported keys and defaults. Custom panes are declared in TOML; their command filters are translated to `gh` arguments by lazyhub. See the configuration reference for the current schema.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the fixture-based development setup, contribution scope, validation commands and security guidance. Start with [the roadmap](docs/ROADMAP.md) to see the active stage and work order.

## License

MIT © [Saketh Kowtha](https://github.com/saketh-kowtha)
