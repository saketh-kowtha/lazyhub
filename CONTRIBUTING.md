# Contributing

Thanks for helping improve lazyhub. This page is the whole path: what the project is, what to set up, what kinds of changes fit, how to validate them, and what to expect from review.

## What lazyhub is (and is not)

Lazyhub is a keyboard-driven terminal UI (Node, Ink and React) over the GitHub CLI. It helps maintainers understand changes, make informed decisions and stay accountable for what ships, including when coding agents produce more of the work. Reads and writes go through `gh`; the app never talks to GitHub with a token of its own, has no telemetry, and the default agent capability is read-only.

It is not a plugin platform. It does not load community plugins, and nothing in a contribution may execute arbitrary commands. The locked decisions behind this are in [docs/ARCHITECT_DECISIONS.md](docs/ARCHITECT_DECISIONS.md); the security boundaries are in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md). If a change would move one of those, say so in the issue first.

## Set up and validate

Prerequisites:

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 20 or later (CI runs 22 and 20) | everything |
| npm | the one that ships with Node | `npm ci` |
| git | any recent version | cloning; tests use their own throwaway repos |
| tmux | optional | the tmux part of `npm run test:pty`; skipped when absent |
| GitHub CLI (`gh`) | not needed to develop or test | only when you run the real app against GitHub |

The tests never call the real `gh`, a browser, `git` or the clipboard: they use fixtures, a fixture-only `gh`, and a throwaway home directory. A test that starts one of those for real fails the run.

```sh
git clone https://github.com/saketh-kowtha/lazyhub.git
cd lazyhub
npm ci
npm run build
```

Run the whole gate before opening a pull request:

```sh
npm run lint && npm test && npm run build && npm run typecheck && npm run test:pty
```

CI's Check job runs the first four; `npm run test:pty` drives the built binary on a pseudo-terminal against a fixture `gh` and is required for anything that touches input or layout. Optional compatibility checks are available through `npm run test:portability`. Report only commands that you actually ran to completion.

## Where a contribution fits

Good, bounded contributions:

- **Fixtures and tests:** deterministic fixture data (`test/pty/fixtures.js`, `test/support/gh-shim/`), regression tests for a bug you reproduced, PTY flows.
- **Documentation:** corrections, clearer setup, accurate key and config references (docs describe TOML config only).
- **Compatibility reports:** a terminal, multiplexer, OS or `gh` version where something looks wrong, with the exact version and a screenshot or `lazyhub --debug-state` output (redacted).
- **Reviewed TOML examples:** keymaps, panes and themes that use keys the current schema supports. See [the configuration reference](docs/CONFIG_REFERENCE.md). An example never contains a shell command that runs arbitrary code and never implies that configuration grants write permission.

Needs an experienced reviewer and a maintainer-approved issue before any code: credentials, authorization, the gateway and approval path, the audit log, release and packaging, IPC and the daemon, and anything that changes what a write is allowed to do.

Not accepted: plugin or extension loading, a marketplace, telemetry or analytics of any kind, and drive-by refactors or dependency bumps.

## Avoid duplicated work

Search the open issues and pull requests first, read the complete issue and [the roadmap](docs/ROADMAP.md), and comment on the issue to say you are taking it. Check the existing code and `docs/bugs/` before starting: the problem may already be partly fixed or logged. Only issues that are truly bounded are labelled `good first issue`; `help wanted` marks work that is open but needs more context.

## How we work: the AGENTS protocols

[AGENTS.md](AGENTS.md) is the one instruction file for humans and AI sessions alike. Read it and its reading order, then follow the protocol that matches the change:

| Change | Protocol |
|---|---|
| Bug | **A:** a failing test that reproduces it first, the root cause, a minimal fix, a sweep of the sibling panes, and a `docs/bugs/<issue>.md` entry |
| UI or design | **B:** a committed ASCII mockup in `docs/mockups/` first, theme tokens only, and verification in the built binary |
| New capability | **C:** real behavior with tests, no mocks standing in for features |
| Performance | **D:** a measured baseline before, the same measurement after, in the pull request |

The hard invariants in AGENTS.md (everything GitHub goes through `runGh()`, `sanitize()` on every string from the API, `useTheme()` for colors, no process spawning in UI code, TOML-only config) are checked by lint and tests. Keep a change inside the files its issue names; if a needed file is not covered, explain the dependency in the issue or pull request instead of making an unrelated change.

## Fixtures and examples

Use the deterministic fixtures under `test/pty/fixtures.js` and `test/support/gh-shim/`, or the demo setup in [docs/demo/README.md](docs/demo/README.md). Demo recordings use fictional repository data and a fixture-only `gh`.

Never put access tokens, private repository content, real user names, or private payloads into fixtures, screenshots, recordings, logs or issue text. Redact before attaching anything.

## Pull requests and review

Keep a pull request focused. Describe the user-visible result, the behavior change, the validation you ran, the docs you updated, and any follow-up. Use `Fixes #n` only when every acceptance item of the issue is met; otherwise write `Part of #n` and list what is left.

Review happens as maintainer availability allows. There is no response-time promise and no staffing behind one; a quiet week is not a rejection. Small, well-tested pull requests that follow the protocols are reviewed fastest, and a request for changes is a normal outcome.

## Security

For a vulnerability or a security-sensitive report, use the private disclosure path in [SECURITY.md](SECURITY.md) (GitHub's private vulnerability reporting). Do not open a public issue containing credentials, exploit details or private data. The project's boundaries and known limits are in [the threat model](docs/THREAT_MODEL.md).

## Feedback

If you try this contributor path, voluntary feedback about setup friction is welcome in the related issue or pull request. Lazyhub does not collect contributor analytics, send telemetry, or recruit by outreach.
