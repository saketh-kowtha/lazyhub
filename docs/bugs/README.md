# Bug-fix log

One file per fixed bug, named by its GitHub issue number: `docs/bugs/<issue>.md`.
If a fix has no issue, use its PR number. Each fix adds its own file, so PRs
fixed in parallel never touch the same lines and never conflict here.

Entries up to B-91 are in `docs/ARCHITECTURE.md` §21.

## Format

```markdown
# <symptom, one line> (#<issue>)

- **Area:** prs | issues | branches | actions | notifications | logs | settings | config | app | ci | ...
- **Symptom:** what the user saw.
- **Root cause:** the exact line or pattern responsible.
- **Fix:** what changed.
- **Regression test:** `<file>` › `<test name>` (failed before the fix).
- **Sibling sweep:** the other panes checked for the same defect, and the result.
```

Before fixing a bug, search here (`grep -ril <keyword> docs/bugs`) and in §21
for the same bug class.
