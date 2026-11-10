# Onboarding journeys D, E, F: resume, terminal environment, first run

Method: PTY runs of the built `dist/lazyhub.js` in a throwaway HOME (config, sockets and cache never
touched the real ones), a stub `gh` (`test/support/gh-shim`, plus knobs for "not logged in", "repo gone",
"Actions off"), stub `git`, `open`, `xdg-open`, `pbcopy`. Screens were captured through a small terminal
emulator and logs read with `cat -v`.

PASS = behaved as expected before this PR. FIXED = failed, failing test written first, now passes.

## D. Resume journeys

| Flow | Result | Evidence |
|---|---|---|
| D1 second launch | PASS (repo, PR scope, PR state filter). Pane and cursor are not remembered, by design today. | `[defaults].repo` loaded from a non-git cwd; seeded `[state] prScope="all"` and `prFilters = ["merged"]` restored on launch. App always opens on the default pane (Focus). See question 1. |
| D2 saved repo no longer accessible | PASS | List shows "x/y was not found, or your account cannot see it", `[r] retry`, no crash, other panes still reachable. Does not say the repo came from `[defaults].repo` (see question 2). |
| D3 corrupt or odd config | PASS | Invalid TOML, unknown keys and tables, wrong value types, empty `active_panes`, unknown pane only, binary garbage, config path is a directory, file mode 000, wrong-typed `[state]`: all start on defaults, no stack trace, file left byte-for-byte. |
| D4 config from a newer version | PASS | `schema_version = "99"`, unknown tables, unknown state keys, bad scope values: starts, file not rewritten or truncated. |
| D5 leftovers and two instances | FIXED | Two instances run side by side; the pointer names the newest, and is removed when the last one quits. Before: `ipc-<pid>.sock` and `.token` files of killed runs accumulated forever (7 files after three SIGKILLs and relaunches). Now pruned at start when the pid is gone. A squatting regular file at `daemon.sock` only shows "running without the background helper". |
| D5b quit with the editor socket open | FIXED (found while testing D5) | `q` and Ctrl+C left the process alive in the alternate screen whenever the editor socket bound (the default; the PTY suite only passed because its long temp path made the bind fail silently). Now the launcher exits when Ink unmounts. |
| D6 auth changed since last run | PASS (+F3) | Logged out: "Not authenticated with github.com", then the opt-in sign-in prompt (F3). Caches are scoped by account fingerprint (#520). |

## E. Terminal environment

| Flow | Result | Evidence |
|---|---|---|
| E1 too small / resized | PASS (app), FIXED (first-run screen) | 30x8, 39x10, 40x9 show "Terminal too small / needs 40x10 / now WxH"; 40x10 and up draw. Resize 30x8 to 100x30 to 35x9 to 100x30 recovers each time with no stale text; Enter while too small does nothing. First-run screen was taller than 10 to 15 row terminals (2 full clears, 3 scrolls at 40x10) and had no too-small message. |
| E2 colour and TERM | PASS (app), FIXED (first-run screen) | `TERM=dumb` and `linux`: ASCII; `NO_COLOR`, `FORCE_COLOR=0`: 0 colour codes; `FORCE_COLOR=1`: colour; 256-colour and truecolor depth follow `TERM`/`COLORTERM`. First-run screen ignored `NO_COLOR` (93 colour codes) and ASCII mode. |
| E3 not a TTY, CI | FIXED | Before: piped stdin/stdout drew the TUI (alt-screen codes) on stdout and hung until killed; with `CI` set Ink printed a raw-mode error on stdout. Now: nothing on stdout, one line on stderr with the next step, exit 1, in 80 ms. `CI=true` in a real terminal blanked the UI (Ink draws only the final frame under CI); now draws normally. |
| E4 tmux, screen, SSH, Windows Terminal | PASS (env), N/A (WSL, Windows) | `TERM=screen`, `tmux-256color` plus `TMUX`, `SSH_TTY`/`SSH_CONNECTION`, `WT_SESSION`, unset and empty `TERM`: all start and quit cleanly. Windows and WSL not testable on this machine. |
| E5 non-UTF-8 locale | PASS (app), FIXED (first-run screen) | `LANG=C`, `POSIX`, `en_US.ISO-8859-1`: ASCII; UTF-8 and unset: Unicode. |
| E6 Ctrl+C or q | PASS after D5b | Ctrl+C 700 ms in (gh slow) and Ctrl+C in a running app: exit 0, alternate screen left, cursor shown, no stack. Ctrl+C at the sign-in prompt: exit 1 with the command. |

## F. First-run guidance

| Flow | Result | Evidence |
|---|---|---|
| F1 first-run screen | PASS | Explains read-only use, repo list, search; `q` writes nothing (no config dir created); choosing a repo saves `[defaults].repo`; third launch skips it; `--onboarding` shows it again. |
| F2 empty states | PASS, one FIXED | PRs ("No open pull requests by you" plus `s` hint), Issues, Notifications, Branches are clear. Actions with Actions switched off showed "Your gh login cannot read this, run gh auth status", which is wrong; now "GitHub Actions is turned off for this repository" with where to enable it. |
| F3 in-app login | FIXED (maintainer decision) | Before: the launcher ran `gh auth login --web` without asking, and had its own token paste prompt. Now: opt-in `[y/N]` prompt, `gh auth login [--hostname H]` with the terminal handed to gh, no token handling by lazyhub; no or Ctrl+C or EOF prints the exact command and exits 1; never without a terminal. |
| F4 help discovery | PASS | Footer shows `? help`; `?` opens the keyboard reference for the active pane. |

## Fixes and tests (each test seen failing first)

- E3: `nonInteractiveMessage` in `src/cli/usage.js` (unit, `src/cli/usage.test.js`) and `runNonTtyFlow`, `runCiEnvFlow` in `test/pty/run.js`.
- D5b/E6: `renderApp({ onExit })` in `src/app.jsx`, used by `bin/lazyhub.js`; `runQuitFlow` (PTY, short HOME so the socket binds).
- D5: `pruneStaleEndpoints` in `src/ipc.js`; `src/ipc.test.js`.
- E1/E2/E5 first run: `onboardingLayout` in `src/features/onboarding/flow.js`, `terminalStdout()` in `runOnboarding`; unit test plus `runFirstRunTerminalFlow` and the NO_COLOR assertion in `runFirstRunFlow`.
- F2: `src/executor/classify.js`; `src/executor/classify.test.js`.
- F3: `confirmLogin` and `runLoginFlow` in `src/bootstrap.js`; `src/bootstrap.login.test.js`.

## Open product questions

1. Remember the last pane and cursor across launches? Recommendation: no for the cursor; yes for the pane behind an opt-in `[app] restore_last_pane`.
2. When the saved repo is gone, say it came from `[defaults].repo` and offer the repository switcher? Recommendation: yes, one added line.
3. A stale `~/.lazyhub-socket` after a hard kill still names a dead socket until the next launch. Editor clients should treat ENOENT/ECONNREFUSED as "no running instance". Recommendation: document it for the nvim plugin; no server change.
