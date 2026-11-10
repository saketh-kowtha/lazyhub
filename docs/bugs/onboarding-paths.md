# Onboarding journeys, group C: where lazyhub is launched

Evidence: `src/launch-paths.test.js` (47 tests). Each case runs the real `bootstrap()` in a child
process inside a real throwaway git repo (temp dir, temp HOME, stub `gh`, `ssh` pinned to a temp
`~/.ssh/config`, stubbed `open`/`xdg-open`/`pbcopy`). Harness: `test/support/launch-harness.mjs`,
`launch-gh.mjs`, `launch-probe.mjs`. Red run: 9 failing tests before the fix; green after.

## Symptom / root cause / fix

1. A GitLab, Bitbucket or other non-GitHub `origin` stopped the launch with "gh is not logged in to
   gitlab.com", even with a saved default repository or `--repo`. `selectGhHost` treated every remote
   host as a candidate GitHub host, and `detectRepo` would have turned a GitLab path into `owner/name`.
   Fix: `pickRemote()` skips remotes on known other forges (`isForeignForge`).
2. Only `origin` was ever read. A clone whose only remote is `upstream` on a GHES host got no host
   (github.com was queried); a GitLab origin with a GitHub mirror remote was unusable.
   Fix: `pickRemote()` falls back to the other remotes (origin first, then `git remote -v` order).
3. `--repo owner/name` (or `owner/repo#N`) inside a clone whose remote host gh is not logged in to was
   fatal. An explicit repository now outranks the remote: a one-line note, github.com is used, and
   `GH_HOST=<host> lazyhub --repo ...` is named for enterprise.
4. Launching where nothing resolves and the account lists no repositories ended with the bare line
   "No repositories found." It now says to run inside a clone or use `lazyhub --repo owner/name`.

## Matrix

| Flow | Case | Result | Evidence |
|---|---|---|---|
| C1 | origin https/.git/no .git/trailing slash/credentialed/ssh/ssh:// /ssh over 443 | PASS | tests "C1/C7 remote URL shapes" |
| C2 | GHES remote, gh logged in (with or without github.com) | PASS | "C2" tests 1-2 |
| C2 | GHES remote, not logged in | PASS | exits 1, prints `gh auth login --hostname ghe.corp` |
| C2 | GHES remote, no login anywhere, no TTY | PASS | exits 1 with the same command |
| C2 | GHES clone whose only remote is `upstream` | FAIL then fixed (2) | red then green |
| C3 | non-git dir, saved default | PASS | |
| C3 | non-git dir, nothing saved, no repos | FAIL (UX) then fixed (4) | |
| C4 | no remote: saved default / nothing | PASS / fixed (4) | |
| C5 | GitLab https, GitLab ssh, Bitbucket origin | FAIL then fixed (1) | red then green |
| C5 | local-path remote | PASS | falls to saved default |
| C5 | plain ssh host (git.example.com) | PASS (by design) | asks for `gh auth login --hostname` / `GH_HOST`; unknown hosts may be GHES |
| C6 | fork origin + upstream | PASS | origin wins (`me/r`); see PR question |
| C6 | only non-origin remote | PASS (repo) / FAIL (host) fixed (2) | |
| C6 | GitLab origin + GitHub mirror | FAIL then fixed (2) | |
| C6 | switch remote in the UI | N/A | no remote switcher; `--repo` is the way |
| C7 | ssh alias to github.com / to GHES (ssh -G) | PASS | stub ssh pinned to temp config |
| C7 | unresolvable alias | PASS | asks for `GH_HOST`, does not guess |
| C7 | dotted repo names, `.github` | PASS | |
| C7 | GHES under a URL sub-path (`host/git/o/r`) | N/A, known limit | falls to saved default |
| C8 | subdirectory, linked worktree, submodule (own remote), bare, detached HEAD | PASS | |
| C9 | deleted (404) | PASS | classified `repo_not_found` naming `o/name`, next step shown |
| C9 | private/no access (403) | PASS | `forbidden`, fix `gh auth status` |
| C9 | renamed/transferred | PASS (reads) | gh follows the redirect; the stale name stays in config until the user changes it (follow-up) |
| C9 | archived | PASS (reads) | no archived badge in the UI (follow-up) |
| C10 | home dir, `/`, spaces + unicode path, symlinked path, unwritable HOME | PASS | |
| C11 | `--repo` over a clone / outside a repo / with GH_HOST | PASS | |
| C11 | `--repo` in a GitLab clone / in an unlogged GHES clone | FAIL then fixed (1, 3) | |
| C11 | URL reference (own host), bare `#N` outside a repo | PASS | exit 2 with guidance |
