# Claims check (#361)

Reached from PR detail with `V`. A full-screen view like the check-log viewer. Read-only.
The description is untrusted text: every string below is cleaned before it is drawn.

```
 Claims check  PR #12                       2 of 4 claims verified, 1 contradicted, 1 unverifiable
 ─────────────────────────────────────────────────────────────────────────────────────────────
 > ✓ verified        adds tests                    "Adds tests for the parser"          (body, line 3)
       1 test file changed; 3 test cases added.
         src/parser.test.js:41   it('parses empty input', () => {
         src/parser.test.js:52   it('rejects nested fences', () => {
   ✗ contradicted    no breaking changes           "No breaking changes."               (body, line 5)
       1 removed or changed export, CLI flag or config key: --json removed.
         src/cli.js:88   const opts = ['--json', '--quiet']
   ? unverifiable    performance                   "Improves performance"               (title)
       Performance claims need a measurement; wording alone is never evidence.
   ✓ verified        fixes #88                     "Fixes #88"                          (body, line 1)
 ─────────────────────────────────────────────────────────────────────────────────────────────
 Deterministic checks only. No AI was used.
 [j/k] select  [d] diff  [E] editor  [A] AI pass  [Esc] close
```

After `A` (optional AI pass; only when pressed, only with a configured provider):

```
 Claims check  PR #12             2 of 5 claims verified, 1 contradicted, 2 unverifiable (1 AI-extracted)
 ─────────────────────────────────────────────────────────────────────────────────────────────
   ✓ verified        adds tests                    "Adds tests for the parser"          (body, line 3)
   ...
 > ? unverifiable AI other claim                   "It no longer drops events."         (body, line 7)
       A free-form claim found by the AI pass; no deterministic check covers it, so it is never verified.
 ─────────────────────────────────────────────────────────────────────────────────────────────
 AI pass: 1 new claim (marked AI), each checked against the diff like the rest. The AI decides no status.
 [j/k] select  [d] diff  [E] editor  [Esc] close
```

Rules the layout keeps:
- status is a word and a glyph, never colour alone; colours come from `useTheme()`;
- the selected claim is expanded with its reason and up to 8 evidence rows (`path:line` and the diff line);
- a verified claim always has at least one evidence row;
- notices (description too long, patches cut, file list capped, AI proposals dropped) sit under the header, never hidden;
- an AI-extracted claim carries `AI` before its label; its text is the description's own words, never the model's;
- a failed or unavailable AI pass says why in the footer ("AI pass failed: ...") and the deterministic result stays;
- `d` opens the PR diff; `E` opens the first evidence file at its line in `$EDITOR` (local checkout);
  `A` reuses the `diff.ai-review` binding, so a rebind of the AI review key moves it here too.
