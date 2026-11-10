# Onboarding journeys: install and GitHub auth (groups A and B)

- **Area:** app (bootstrap, CLI entry, doctor)
- **Method:** each flow was driven against the built `dist/lazyhub.js` with a temporary HOME and XDG dirs, a stub `gh` first on PATH, and stub `open`, `xdg-open`, `pbcopy` and `git`. The real `~/.config/lazyhub` and the installed lazyhub were never touched. Install flows used `npm pack` and an install into a temporary prefix. Output was read with `cat -v`.
- **Expected (journey matrix):** a clear first screen in under 1 s, a one-line cause, the exact next step, never a stack trace, never prose on stdout in machine modes, exit codes documented.

## Matrix

Result is the state after this PR. FAIL rows were failing before it and have a regression test.

| Flow | Before | After | Evidence |
|---|---|---|---|
| A1 npm global install, first run | PASS | PASS | Packed tarball (56 files) installed with `npm install -g --prefix <tmp>`: `lazyhub --version` prints `26.6.3`, `--help` works, `doctor` runs from the symlinked bin; `defaultConfig.toml` and `yoga.wasm` are in `dist/`; `doctor` created nothing under HOME. |
| A2 npx / pnpm dlx / bunx | PASS | PASS | `npm exec --package=<tarball> -- lazyhub --version` prints `26.6.3`. pnpm and bunx run the same bin entry; not installed here. |
| A3 Homebrew install and upgrade | PASS | PASS | `scripts/homebrew-formula.mjs render` output passes `ruby -c`. The installed layout (`bin/lazyhub` symlink into `lib/node_modules/lazyhub/dist/lazyhub.js`) is what the formula's `std_npm_install_args` + `install_symlink` produces and was exercised above through a symlink. `depends_on "node"` covers Node missing. Release workflow: `promote.yml` requires `TAP_TOKEN` before moving the dist-tag, pushes the formula, then `check --wait 120` fails the promotion if the tap lags; `tap-check.yml` re-checks weekly (#472). `brew install` itself was not run (not against the real system). |
| A4 Node too old | FAIL | PASS | Node 18.17: `SyntaxError: Invalid regular expression flags` with a file URL and stack (the bundle uses the regex `v` flag, Node 20+). Now: `lazyhub needs Node.js 20 or newer; this is Node 18.17.0.` plus `Install a current Node (https://nodejs.org, or: nvm install 20)`, exit 1, stdout empty. |
| A5 Upgrade from an older version | PASS | PASS | A config with an unknown `[defaults]` key, a removed theme name and an unknown section: `doctor` reports "Schema validation has warnings" (no crash), launch starts, and the file is byte-identical afterwards (`cmp`). |
| A6 `--version`, `--help`, unknown flag, `doctor`, machine modes | FAIL | PASS | `--version`, `--help`, `--bogus` (exit 2 with usage), `status`, `--mcp` (stdout empty, one actionable stderr line, exit 1) were already right. FAIL 1: `doctor` on a fresh machine printed `X File missing` and exited 1 (and `--json` returned `ok:false`), although the first launch creates the file. FAIL 2: `restoreTerminal()` wrote `ESC[?1049l` and other reset escapes to a piped stdout even when the TUI never started (for example gh-missing exit), polluting machine output. FAIL 3: `doctor` never checked gh, although its usage says "check setup, auth". |
| A7 Installed but not on PATH | doc gap | PASS | README now says what to do on `command not found` (new terminal or `hash -r`, npm global bin on PATH). |
| B1 gh installed, logged in | PASS | PASS | Starts the TUI; 96 gh calls, no prompts. |
| B2 gh installed, not logged in | PASS | PASS | Non-TTY: `Not authenticated with github.com.` then `Run gh auth login first, or set GH_TOKEN to a valid token.`, exit 1. The TTY login flow is covered by `src/bootstrap.login.test.js` (mocked gh); a real interactive login was not run. |
| B3 token invalid or revoked | FAIL | PASS | `gh auth token` still prints a token, so the check passed; outside a repo the next step printed `No repositories found.` / `No repository selected. Exiting.` Now: `X You are not signed in to GitHub.` / `Run: gh auth login`, exit 1. |
| B4 gh not installed | PASS | PASS | `X gh (GitHub CLI) is not installed.` plus the per-OS install command, exit 1. |
| B5 gh too old (no `auth token`) | FAIL | PASS | `unknown command "token" for "gh auth"` was reported as "Not authenticated ... Run gh auth login". Now: `X Your GitHub CLI is too old for this lazyhub feature.` / `Update gh from https://cli.github.com (macOS: brew upgrade gh)`, exit 1, no login attempt. |
| B6 GHES-only login | PASS | PASS | Outside a repo with only `ghe.corp.example` logged in, startup picks that host and starts. |
| B7 multiple hosts and accounts | PASS | PASS | github.com plus GHES both logged in: starts on github.com; switching accounts is `gh auth switch` (lazyhub follows gh's active account). |
| B8 `GH_TOKEN` / `GH_HOST` env | PASS | PASS | With a realistic stub (`gh auth token` honours `GH_TOKEN`), `GH_TOKEN` set and no gh login starts the TUI. `GH_HOST=ghe.corp.example` with a login there starts; with no login prints `Not authenticated with ghe.corp.example.` and `gh auth login --hostname ghe.corp.example`, exit 1. |
| B9 missing scope / SSO not authorized | FAIL | PASS | Same collapse into "No repositories found" outside a repo. Now: `An organization has not authorized your gh token (SAML SSO).` / `Run: gh auth refresh -h github.com`, exit 1. Inside a repo the TUI failure notice already handled this. |
| B10 offline, DNS, proxy, TLS | FAIL | PASS | Same collapse. Now: `Cannot reach api.github.com. Check your network or githubstatus.com.`, exit 1. |
| B11 rate limited at startup | FAIL | PASS | Same collapse. Now: `GitHub API rate limit reached: GraphQL, 5,000 points per hour.` plus when to retry, exit 1. |
| B12 gh hangs | FAIL | PASS | A hung `gh --version` waited the 30 s default and was then reported as "not installed". Now bounded at 10 s (`BOOT_PROBE_TIMEOUT_MS`) with `gh did not respond within 10s. A keychain prompt or a slow credential helper may be waiting. Run gh auth status in this terminal ...`, exit 1. The same applies to a hung `gh auth token`, `doctor` and `--mcp`. |

Counts (19 flows, A1 to A7 and B1 to B12): before this PR 10 PASS, 8 FAIL (A4, A6, B3, B5, B9, B10, B11, B12) and 1 documentation gap (A7); after, 19 PASS, 0 FAIL, 0 NOT-APPLICABLE.

## Root causes and fixes

- **A4:** nothing checked `engines`; the bundle failed to parse on Node < 20. `bin/lazyhub.js` now loads `src/cli/node-guard.js` first (its own chunk, no dependencies).
- **B3, B9, B10, B11:** `listRepos()` caught every error and returned `[]`. `listReposDetailed()` now returns the `classifyGhFailure` result and `bootstrap()` prints cause plus the literal command (`formatFailureLines` prefers the command over hints that hold key placeholders).  An empty (successful) list keeps its existing wording; the launch-path work (#630) owns that message.
- **B5:** `checkAuth()` collapsed every failure to `false`. `checkAuthDetailed()` keeps the classification; `gh_too_old` stops before the login flow.
- **B12:** the startup probes used the 30 s default and mapped any failure to "not installed". They now use a 10 s timeout and a timeout is reported as its own cause.
- **A6:** a missing config is now `ok` ("defaults are in use (created on first launch)"); `doctor` adds `gh installed (<version>)` and `Logged in to <host>` or the classified cause and command (`src/cli/doctor/gh.js`); `restoreTerminal()` returns early when stdout is not a TTY.

## Regression tests (all seen failing before the fix)

- `src/bootstrap.onboarding.test.js`: B3, B9, B10, B11 (cause shown, not "No repositories found"), B5, B12 (both probes, timeout <= 10 s), `formatFailureLines`.
- `src/cli/node-guard.test.js`: unit tests for Node 16, 18, 19 rejected and 20, 22, 26 accepted, plus an end to end run of the built entry on an installed Node 16 or 18 (skipped when none is installed).
- `src/cli/doctor/gh.test.js`: missing config is OK, gh installed, missing, hung, not logged in.
- `src/crash.restore.test.js`: no escapes on a piped stdout, still restores a TTY.

## Sibling sweep

`headlessPreflight()` (`--mcp`) shares the probe and now reports a hung gh. The five panes read through the TUI failure notice (`useGhHealth`), which already classified these cases; the defect was only in the pre-TUI bootstrap path.

## Not fixed (follow-ups)

- **E3, non-TTY launch:** `lazyhub </dev/null >file` starts the full TUI and draws frames to stdout instead of refusing. Owned by the terminal/resume work.
- **F3, in-app `gh auth login`:** product decision, not built.
- **Wrong-account detection at startup:** `gh auth token` does not validate a token, so a revoked token inside a repo is only noticed by the TUI's failure notice on the first read, not at launch. A launch-time validation call costs a network round trip (D16 speed), so it needs a decision.
