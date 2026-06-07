# lazyhub — Manual Test Plan

> **Purpose:** Verify the current `main` branch before a release candidate or
> after a broad bug-fix/testing pass. Tests are ordered by priority and blast
> radius — a failure in Section 2 is more urgent than a failure in Section 5.
>
> **How to use:** run top to bottom. Tick `[x]` for pass, `[FAIL]` with a one-line
> note for fail. When you finish, reply with just the failed items.

---

## Section 0 — Pre-flight setup

Confirm before starting. All later sections assume these.

- [ ] **Node & CLI**
  - [ ] `node --version` ≥ 20
  - [ ] `gh --version` prints a version (not "command not found")
  - [ ] `git --version` prints a version
- [ ] **Two test repos available:**
  - [ ] **R-GHCOM:** a github.com repo you have admin access to, with:
    - ≥ 10 open PRs (at least 1 draft, 1 conflicting, 1 with failing CI, 1 mergeable)
    - ≥ 5 closed PRs and ≥ 1 merged PR
    - ≥ 5 open issues, ≥ 2 closed issues
    - ≥ 15 branches (at least 1 protected, 1 with `j` or `k` in the name e.g. `feature/jwt-auth`)
    - ≥ 5 GitHub Actions runs (some failing)
    - ≥ 3 unread notifications
  - [ ] **R-GHE:** a GitHub Enterprise repo (`github.yourcompany.com` or similar) you have access to, cloned locally. Skip the GHE section if you don't have one.
- [ ] **Auth state**
  - [ ] `gh auth token` (no --hostname) prints a token OR errors cleanly
  - [ ] If GHE: `gh auth token --hostname <ghe-host>` prints a token
- [ ] **Config**
  - [ ] `~/.config/lazyhub/lazyhub.toml` exists (or let the app create it)
  - [ ] For AI tests, `ai.anthropicApiKey` is set (or `ANTHROPIC_API_KEY` env var)
- [ ] **Terminal**
  - [ ] Start ≥ 120 columns × ≥ 30 rows. Resize tests will shrink later.
- [ ] **Build artifact**
  - [ ] `npm install` clean
  - [ ] `npm run build` succeeds
  - [ ] `npm test` exits 0
  - [ ] `npm run test:coverage` exits 0 and writes reports to `coverage/`
  - [ ] Coverage thresholds hold for `src/**/*.{js,jsx}` (current floors: 50% statements, 58% branches, 45% functions, 50% lines)
  - [ ] `npm run lint` exits 0
  - [ ] On pull requests, CI posts a Vitest coverage summary comment and uploads the `coverage-report` artifact

- [ ] **Automated baseline on `main`**
  - [ ] Core unit/integration suites are present under `src/**/*.test.js`
  - [ ] Mocked TUI flow suites are present in:
    - `src/app.e2e.test.jsx`
    - `src/pane-flows.e2e.test.jsx`
    - `src/pr-workflows.e2e.test.jsx`
    - `src/settings-pane.e2e.test.jsx`

---

## Section 1 — 5-minute smoke test

If any of these fail, stop and report — the app is broken at the foundation.

### S-01 — Launch from a github.com repo clone
Run `cd /path/to/R-GHCOM && npx lazyhub` (or your launcher).
- [ ] App renders within ~2 s, no stack trace in stderr.
- [ ] Sidebar shows 5 panes; PRs active; repo name in status bar.

### S-02 — Pane cycling
Press `Tab` five times.
- [ ] PRs → Issues → Branches → Actions → Notifications → PRs (wraps).

### S-03 — PR detail → diff → back
`Enter` on first PR → `d` → `Esc` → `Esc` → back at PR list.
- [ ] Every transition paints within 1 s; no artifacts.

### S-04 — Quit
Press `q` at the PR list.
- [ ] App exits; terminal restored (your prompt is on a clean line, no leftover rendering).

---

## Section 2 — NEW fixes from this session (HIGH priority)

These are the changes made in the recent bug-hunt + the GHE auth fix. Regressions here are most likely.

### 2.1 — GHE auth auto-detection (bootstrap)

#### T-201 — GHE clone without `GH_HOST` exported
**Pre:** `unset GH_HOST`. Cd into your GHE clone (`R-GHE`). You are already logged in via `gh auth login --hostname <ghe-host>`.
1. `cd R-GHE`
2. Run `lazyhub`.
- [ ] App does **not** prompt for `gh auth login`.
- [ ] PR list loads against the GHE host.
- [ ] Status bar shows the correct `owner/repo` from the GHE remote.

#### T-202 — `GH_HOST` explicitly set wins
1. `export GH_HOST=<ghe-host>` in a github.com clone (`R-GHCOM`).
2. Run `lazyhub`.
- [ ] App uses the exported host (will show GHE data / error, not github.com).
- [ ] `unset GH_HOST` afterwards.

#### T-203 — Vanilla github.com clone still works
1. `unset GH_HOST` in `R-GHCOM`.
2. Run `lazyhub`.
- [ ] PR list loads from github.com normally.

#### T-204 — Not-logged-in error shows the right hostname
1. `gh auth logout --hostname <ghe-host>` (or equivalent for the GHE host).
2. Cd into `R-GHE`, `unset GH_HOST`, run `lazyhub`.
- [ ] Error message references the GHE host by name and says `gh auth login --hostname <ghe-host>`.

---

### 2.2 — ConfirmDialog: `j`/`k` don't hijack required-text typing

#### T-210 — Delete a branch containing `j` or `k` in its name
**Pre:** `R-GHCOM` has a remote branch like `feature/jwt-auth` or similar. Do **not** delete one you care about.
1. Tab to Branches → navigate to the `…j…` or `…k…` branch → press `D`.
2. In the confirm dialog type the **full branch name exactly**, including the `j`/`k`.
- [ ] All characters appear in the typed field, including `j` and `k`.
- [ ] The **Yes/No** cursor does **not** jump when you type `j` or `k`.
- [ ] Pressing `Enter` when the typed text matches actually deletes.

#### T-211 — Non-requireText dialogs still allow j/k nav
1. Merge a PR (`m` on a mergeable PR → pick `--squash` → `Ctrl+G`) — a normal ConfirmDialog is shown.
2. With no `requireText`, use `j`/`k`/`←→` to move between Yes/No.
- [ ] `j`/`k` move cursor (old behaviour preserved when requireText is not set).

---

### 2.3 — Branches: checkout-of-current-branch no longer warns via dialog

#### T-220 — Enter on the current branch
1. Tab to Branches. The row marked `►` is your current branch.
2. Move cursor to it → press `Enter`.
- [ ] Status banner says `Already on "…"`; **no** ConfirmDialog appears.
- [ ] No `git checkout` runs (your shell's git status is unchanged afterwards).
- [ ] No React warning text in stderr.

#### T-221 — Enter on a different branch still prompts
1. Move cursor to a non-current branch → press `Enter`.
- [ ] ConfirmDialog opens; `y` checks it out, `n` cancels.

---

### 2.4 — MultiSelect / FuzzySearch: letters go to the filter, not to jumps

#### T-230 — Filter the label list by "bug"
**Pre:** Label list contains "bug", "enhancement", "good first issue" or similar.
1. Tab to PRs → `Enter` on a PR → `l` (labels dialog).
2. Type `b` then `u` then `g`.
- [ ] The filter field shows `bug` (all three letters typed).
- [ ] The list filters to labels containing "bug".
- [ ] The cursor does **not** jump to the top on `g`.

#### T-231 — Ctrl+g / Ctrl+G still jump in MultiSelect
With the labels dialog still open and a filtered list:
1. Press `Ctrl+g` → cursor should go to top of filtered results.
2. Press `Ctrl+G` → cursor should go to the bottom.
- [ ] Both Ctrl shortcuts work.

#### T-232 — Fuzzy search PRs by a query containing `g` or `G`
1. `/` in PR list → type a partial query that contains `g` (e.g., `feature/g` or `bug`).
- [ ] All characters land in the search box.
- [ ] Results filter accordingly.

#### T-233 — Ctrl+g / Ctrl+G in fuzzy search
1. With the fuzzy dialog open and multiple results → `Ctrl+g` / `Ctrl+G`.
- [ ] Cursor jumps top/bottom of results.

#### T-234 — Footer hints are accurate
- [ ] MultiSelect footer reads: `[type] filter  [↑↓] nav  [Ctrl+g/G] top/bot  [Space] toggle  [Enter] confirm  [Esc] cancel`
- [ ] FuzzySearch footer reads: `[↑↓ / Ctrl+jk] navigate  [Ctrl+g/G] top/bottom  [Enter] select  [Esc] cancel`

---

### 2.5 — AIAssistant: scroll keys don't hijack typing

#### T-240 — Type a prompt containing j/k/g/G
**Pre:** AI provider configured (anthropic / openai / ollama). If not, skip.
1. From any view press `Ctrl+A`.
2. Type: `merge pr #42 gently, thanks` (contains `g`, `k`, `j` depending on wording).
- [ ] Every letter lands in the prompt; message history does **not** scroll as you type.

#### T-241 — Scroll history
After sending a few messages so the history overflows:
1. `↑` / `↓` — scroll should work.
2. `PageUp` / `PageDown` — scroll to top/bottom.
3. `Ctrl+j` / `Ctrl+k` — scroll by one.
4. `Ctrl+g` / `Ctrl+G` — top / bottom.
- [ ] All the above move the history.
- [ ] `j` or `k` alone (with focus on the prompt) is typed, does **not** scroll.

---

### 2.6 — PR comments pane: `J` jumps to diff (new binding)

#### T-250 — J jumps to the diff at the comment line
**Pre:** PR with at least one inline comment thread.
1. Open PR detail → `v` (comments).
2. Navigate (`j`/`k`) to a thread → press **`J`** (capital).
- [ ] View switches to diff; cursor is near the commented line.

#### T-251 — `g` in comments still does gg-to-top
1. Back in comments view, press `g` then `g` quickly.
- [ ] Cursor moves to the first thread (gg jump works; `g` alone does not jump-to-diff anymore).

#### T-252 — Help overlay documents `J`
1. `?` while in comments view.
- [ ] Help row shows `J` labelled "jump to this line in diff".
- [ ] `g` is NOT in the help for comments view anymore.

---

### 2.7 — Settings: mouse + aiReview toggles don't warn

Watch stderr / DEBUG logs while doing this. Any "Cannot update a component while rendering" warning is a FAIL.

#### T-260 — Toggle mouse support
1. `S` → navigate to **Mouse Support** → `Enter`.
- [ ] Value flips Enabled ↔ Disabled immediately.
- [ ] No warnings in stderr.
- [ ] No full-screen blink / re-mount of the settings pane.
- [ ] Toggle again; value flips back.

#### T-261 — Toggle AI Code Review
1. `S` → navigate to **AI Code Review** → `Enter`.
- [ ] Value flips immediately; no warnings.

#### T-262 — Non-toggle options still open dialogs
1. `S` → **Theme** → `Enter` → ThemePicker opens → `Esc`.
2. `S` → **Active Panes** → `Enter` → MultiSelect opens → `Esc`.
3. `S` → **AI Provider** → `Enter` → provider editor opens → `Esc`.
- [ ] Each opens the correct dialog; `Esc` returns to settings list.

---

### 2.8 — ThemePicker: current theme highlighted correctly

#### T-270 — Cursor lands on the current theme
1. `S` → Theme → `Enter`.
- [ ] Cursor is on the **current** theme row (not on row 0 unless current is row 0).
- [ ] The row labelled `(current)` matches the cursor row.

#### T-271 — With an unknown theme in config, cursor falls back to row 0
1. Edit `~/.config/lazyhub/lazyhub.toml` to set `"theme": "not-a-real-theme"`.
2. Relaunch → `S` → Theme.
- [ ] Cursor lands on row 0, no crash.
- [ ] Revert your config change afterwards.

---

### 2.9 — Editor spawn: alt-screen restore

#### T-280 — Editor opens from FormCompose (create issue body)
**Pre:** `$EDITOR` set to a terminal editor (e.g. `vim` or `nano`). GUI editors don't exercise this path — skip if you only have VS Code.
1. Issues pane → `n` (new issue).
2. Tab to the Body field → press `Ctrl+E`.
- [ ] Terminal switches out of the TUI cleanly; editor runs full-screen.
- [ ] Type some text → save & quit.
- [ ] lazyhub returns cleanly; **no** split between editor output and Ink render.
- [ ] The text you typed appears in the body field.

#### T-281 — Editor opens from PR comments reply
**Pre:** PR with a comment thread.
1. Open comments view → `r` on a thread (reply).
2. Press `e` while the reply box is open.
- [ ] Alt-screen exits cleanly; editor opens; save & quit.
- [ ] Terminal restores without artifacts.
- [ ] Edited text appears in the reply box.

#### T-282 — Editor opens from diff comment compose
Already fixed previously (B-46). Verify still works.
1. Diff view → `c` on a `+` line → press `e`.
- [ ] Same clean exit/return as above.

---

### 2.10 — CustomPane: `G` on empty list doesn't crash

#### T-290 — G on an empty custom pane
**Pre:** Add a custom pane to `~/.config/lazyhub/lazyhub.toml` that returns an empty array, e.g.:
```json
"customPanes": {
  "empty-test": {
    "label": "Empty",
    "icon": "∅",
    "command": "gh api repos/{repo}/deployments --jq '[]'"
  }
}
```
And ensure `"empty-test"` is in `"panes"`. Restart.
1. Tab to the Empty pane → press `G`.
- [ ] App does not crash; cursor stays valid (doesn't become -1).
- [ ] Press `j` / `k` — no crash.
- [ ] Remove the test pane from config afterwards.

---

### 2.11 — Sanitized titles in dialogs

#### T-2A0 — Merge OptionPicker shows sanitized title
**Pre:** A PR whose title contains an ANSI-ish sequence. If you can't create one safely, skip or use a title with HTML entities.
1. PR list → select that PR → `m`.
- [ ] Picker title is plain text; no color bleed, no escape codes visible.

#### T-2A1 — Close PR ConfirmDialog shows sanitized title
1. PR detail → `X` (close).
- [ ] Confirm message uses sanitized title.

---

### 2.12 — Diff admin-merge flow doesn't corrupt the commit message

#### T-2B0 — Admin merge with back/forward between pickers
**Pre:** Admin access on R-GHCOM with a PR that can be admin-merged.
1. PR list → select → `m` → pick `--admin` → type a commit message `"hello"` → Enter.
2. In the next picker, pick `--squash`.
3. **Back** — press `Esc` or the cancel action to return to the admin-method picker.
4. Pick `--merge` this time → on confirm dialog, press `y`.
- [ ] The merge actually executes with `--admin --merge`.
- [ ] The commit message on GitHub is `"hello"` (preserved across the back-forward).
- [ ] No `[object Object]` ever appears in any UI element or resulting commit.

*(If you don't want to actually merge, cancel at the final `y`; the absence of `[object Object]` in the confirm dialog message is the key observable.)*

---

### 2.13 — 404 error detection on HTTP 404 in stderr

#### T-2C0 — Open a stale PR that was externally deleted
1. In PR detail, externally delete the PR on GitHub (`gh pr close` + delete, or use API).
2. In lazyhub, press `r` to refresh the detail.
- [ ] Error message reads **"Resource not found"**, not a generic failure.

---

## Section 3 — Regression sweep of existing features (MEDIUM priority)

One pass through the core flows to confirm nothing obvious broke.

### 3.1 — PR list

#### T-301 — j/k/↑/↓ navigation
- [ ] Moves cursor; list scrolls at boundaries.

#### T-302 — gg / G
- [ ] `gg` to top, `G` to bottom work.

#### T-303 — `f` filter cycle
- [ ] open → closed → merged → open.

#### T-304 — `O` / `C` / `M` direct filter keys (default bindings)
- [ ] Each jumps directly to that state's list.

#### T-305 — `s` scope cycle
- [ ] all → own → reviewing → oldest → all; list updates.

#### T-306 — `@` author search
- [ ] Opens author filter; applying narrows list; empty submission shows all.

#### T-307 — `/` fuzzy search by title
- [ ] Filters in real time.

#### T-308 — `/` fuzzy search by author login
- [ ] Typing an author name filters; no `[object Object]`.

#### T-309 — `y` copy URL
- [ ] Clipboard contains the PR URL (paste into terminal to verify).

#### T-310 — `o` opens browser
- [ ] Default browser opens the PR.

#### T-311 — CI badge formatting
- [ ] Passing: `✓`.
- [ ] Failing: `✗ N/total` with a space between `✗` and `N`.
- [ ] Pending: `● N/total`.

#### T-312 — Draft PRs render correctly
- [ ] `⊘` badge, italic title.
- [ ] No duplicate "Draft" label.

#### T-313 — Side panel for hovered PR (≥ 100 cols)
- [ ] Right-side panel updates as cursor moves.

---

### 3.2 — PR detail

#### T-320 — Enter opens detail; Esc goes back
- [ ] Works.

#### T-321 — All advertised keys do something
- [ ] `d` diff, `v` comments, `m` merge, `a` approve, `x` request changes, `X` close, `D` draft toggle, `B` base change, `l` labels, `A` assignees, `R` reviewers, `r` refresh, `o` browser.
- [ ] None silently swallow input.

#### T-322 — `c` enters CI checks mode
- [ ] Header row highlights; `j/k` move between checks; failing sorted first.
- [ ] `l` on a check opens the annotations log.
- [ ] `Enter`/`o` opens check URL.
- [ ] `R` triggers a re-run (check message appears).
- [ ] `Esc` exits checks mode (falls back to scroll mode).

#### T-323 — `C` on CONFLICTING PR opens conflict view
- [ ] Only triggers when `mergeable === 'CONFLICTING'`.
- [ ] Does NOT trigger on `UNKNOWN` / `MERGEABLE`.

#### T-324 — `C` on mergeable PR → Actions filtered to PR's branch
- [ ] Pane switches to Actions; header shows branch filter.

#### T-325 — `/` search + Esc clears filter first
- [ ] First Esc clears active filter, second Esc goes back.

#### T-326 — Help hint line in detail
- [ ] Bottom hint shows relevant keys, `[?] help` and `[Esc] back`.

---

### 3.3 — Diff view

#### T-330 — `j/k/gg/G` scroll
- [ ] Works.

#### T-331 — `[` / `]` prev/next file
- [ ] Jumps by file-header boundaries.

#### T-332 — `f` fuzzy file jump
- [ ] Dialog opens; selection jumps diff.

#### T-333 — `:` go-to-line
- [ ] Prompts for a line; jumps there.

#### T-334 — `/` find
- [ ] Filter shows `N matches`; `n`/`N` cycle matches.

#### T-335 — `s` split/unified toggle
- [ ] Toggles. Layout correct on both.

#### T-336 — `t` file tree
- [ ] Tree renders with `+add/-del` counts; Enter on a file jumps.

#### T-337 — `c` on a `+` line posts a comment
- [ ] Dialog lets you type; `Ctrl+G` sends; GitHub shows the comment.

#### T-338 — `A` triggers AI review (if configured)
- [ ] Spinner, then review pane with suggestions (or empty/positive summary).

#### T-339 — Large-diff warning
- [ ] For a diff > 5000 LOC combined: warning page; `Enter` loads, `o` opens browser, `Esc` back.

---

### 3.4 — Issues

#### T-340 — Load / navigate / filter cycle (open↔closed)
- [ ] Works.

#### T-341 — `n` new issue → Ctrl+G submits
- [ ] New issue created on GitHub; `r` refresh shows it.

#### T-342 — `x` close issue
- [ ] Confirm with sanitized title; closes on y.

#### T-343 — `l` labels / `A` assignees
- [ ] Add + remove diff applied.

#### T-344 — `o` opens browser
- [ ] Works.

#### T-345 — Issue detail: `r` reply uses `gh issue comment`
- [ ] Reply posted; shows on GitHub as an issue comment.

#### T-346 — Issue detail: `o` open in browser
- [ ] Works.

---

### 3.5 — Branches

#### T-350 — List up to 100 branches; protected `🔒`; current `►`; `PR` indicator
- [ ] All shown.

#### T-351 — `n` create branch with valid name
- [ ] Branch created & checked out; `►` moves.

#### T-352 — `n` create branch — invalid names rejected
Try each: `my branch`, `my~branch`, `my:branch`, `my?branch`, `my[branch`, `..hidden`, `branch.lock`, `-leading`, `trailing.`.
- [ ] Each rejected with an error status; no `git checkout -b` runs.

#### T-353 — `D` delete branch — message specifies "remote"
- [ ] Message explicitly mentions "remote branch" and "local branch is unaffected".
- [ ] Typing confirmation (T-210 already covered requireText typing).

#### T-354 — `p` push current branch
- [ ] `git push origin HEAD` runs; status confirms or errors cleanly.

---

### 3.6 — Actions

#### T-360 — List loads with status + branch + time
- [ ] Works.

#### T-361 — Enter / `l` opens log viewer; `Esc` closes
- [ ] Log viewer navigable with j/k/gg/G and filterable with `f`.

#### T-362 — `R` re-run
- [ ] Status confirms.

#### T-363 — `X` cancel with confirm
- [ ] Confirm dialog; cancels on y.

#### T-364 — Branch filter set via `C` from PR; cleared by `x`, or by Tab away/back
- [ ] On Tab-away-and-back, filter is cleared (not stale).

---

### 3.7 — Notifications

#### T-370 — Load / navigate / sanitized titles
- [ ] No ANSI leakage.

#### T-371 — `m` marks one; `M` marks all
- [ ] `M` makes a **single** API call (watch with `gh api --verbose` or check rate-limit headers).

#### T-372 — Enter on PullRequest notification routes to PR list/detail
- [ ] Navigates correctly.

---

### 3.8 — Help overlay

#### T-380 — `?` opens; `?`/`Esc`/`Enter` closes
- [ ] All three close keys work.

#### T-381 — Wide terminal ≥ 90 cols
- [ ] Shows context-specific + global keys in two columns.

#### T-382 — Narrow terminal < 90 cols
- [ ] Global keys column hidden; no overflow.

---

### 3.9 — Settings and theme

#### T-390 — Theme change applies live
- [ ] Colors across all components update.

#### T-391 — Theme persists across restart
- [ ] Relaunch → same theme.

#### T-392 — AI Provider editor: Anthropic / OpenAI / Ollama
- [ ] Each cycle shows correct fields.
- [ ] `s` saves; `Esc` cancels.
- [ ] API key fields masked on display.

---

## Section 4 — Edge cases (MEDIUM priority)

### T-401 — Empty PR list
1. Apply `merged` filter in a repo with zero merged PRs.
- [ ] Empty-state message; `G` doesn't crash; cursor stays at 0.

### T-402 — Empty issues / branches / notifications
- [ ] Each pane handles empty state without crashing.

### T-403 — 500-char PR title
- [ ] Truncated cleanly at edge; no overflow.

### T-404 — Null author on a deleted account
- [ ] Row renders; no `[object Object]`; fuzzy search by author doesn't crash.

### T-405 — UNKNOWN mergeable state
- [ ] Badge = `●` (open) not `⚡`; `C` does nothing (doesn't open conflict view).

### T-406 — Config with invalid JSON
1. Corrupt the config file.
- [ ] App launches on defaults.
- [ ] Restore your config afterwards.

### T-407 — Terminal resize during use
1. While app is running, drag terminal from 120 → 80 → 120 cols.
- [ ] Layout reflows; no crash.

### T-408 — Long-running editor session
1. Open editor via `Ctrl+E` in a FormCompose; leave it open for 2 minutes; save & exit.
- [ ] App resumes cleanly.

---

## Section 5 — Failure scenarios (MEDIUM priority)

### T-501 — `gh` not installed
Rename `gh` (e.g. `mv $(which gh) /tmp/gh.bak`) → run `lazyhub`.
- [ ] Clear install instructions; exits 1; no stack trace.
- [ ] Restore `gh` afterwards.

### T-502 — Logged out
`gh auth logout` (careful) → run `lazyhub`.
- [ ] Login flow offered or clear error.
- [ ] Re-login afterwards.

### T-503 — Rate limit
Trigger by rapid `r` on PR list, or set a low PAT.
- [ ] Error explicitly says "GitHub API rate limit exceeded".

### T-504 — 404 on deleted resource (covered in T-2C0)
- [ ] Seen "Resource not found".

### T-505 — Network failure during diff load
Disable network briefly while pressing `d` on a PR.
- [ ] Error message; app remains responsive.

### T-506 — AI network failure
Block api.anthropic.com; press `A` in diff.
- [ ] Network error message; no hang.

### T-507 — AI missing API key
Unset key in config + env; press `A`.
- [ ] "No API key" error; no network call.

### T-508 — Token redaction in error messages
Trigger a `gh` error whose stderr contains a long random-looking string (token-like).
- [ ] The visible error message replaces long strings with `[REDACTED]`.

### T-509 — ErrorBoundary isolates a broken view
(Not easily reproducible manually — skip unless you can cause one.)

### T-510 — Persistent error + next-key refresh
1. Trigger a persistent error (failed merge).
2. With error visible, press `r`.
- [ ] First `r` dismisses the error AND triggers refresh in one press.

---

## Section 6 — Report template

When you finish, reply with only:

```
Setup:
- Node: <version>
- gh:   <version>
- R-GHCOM: <owner/repo>
- R-GHE:   <owner/repo> or "skipped"

Failures:
- <test id> — <one line on what went wrong + what you observed>
- <test id> — …

(If all pass: "All pass, Section 2.x areas verified.")
```

That's enough for me to act on. No need to paste full logs unless a stack trace shows up — just the trace in that case.
