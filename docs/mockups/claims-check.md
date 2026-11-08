# Claims check (#361)

Reached from PR detail with `V`. A full-screen view like the check-log viewer. Read-only.
The description is untrusted text: every string below is cleaned before it is drawn.

```
 Claims check  PR #12                       2 of 4 claims verified, 1 contradicted, 1 unverifiable
 ─────────────────────────────────────────────────────────────────────────────────────────────
 > ✓ verified      adds tests                    "Adds tests for the parser"          (body, line 3)
       1 test file changed; 3 test cases added.
         src/parser.test.js:41   it('parses empty input', () => {
         src/parser.test.js:52   it('rejects nested fences', () => {
   ✗ contradicted  no breaking changes           "No breaking changes."               (body, line 5)
       1 removed or changed export, CLI flag or config key: --json removed.
         src/cli.js:88   const opts = ['--json', '--quiet']
   ? unverifiable  performance                   "Improves performance"               (title)
       Performance claims need a measurement; wording alone is never evidence.
   ✓ verified      fixes #88                     "Fixes #88"                          (body, line 1)
 ─────────────────────────────────────────────────────────────────────────────────────────────
 Deterministic checks only. No AI was used.
 [j/k] select  [d] diff  [E] editor  [Esc] close
```

Rules the layout keeps:
- status is a word and a glyph, never colour alone; colours come from `useTheme()`;
- the selected claim is expanded with its reason and up to 8 evidence rows (`path:line` and the diff line);
- a verified claim always has at least one evidence row;
- notices (description too long, patches cut, file list capped) sit under the header, never hidden;
- `d` opens the PR diff; `E` opens the first evidence file at its line in `$EDITOR` (local checkout).
