# Consistent text cleanup for GitHub-provided content

- **Area:** app (shared helpers), prs, issues, branches, actions, notifications, logs
- **Symptom:** GitHub-provided text (titles, bodies, diffs, logs, annotations, names) was cleaned
  by several different helpers, some of them narrower than others, and a malformed numeric
  reference in entity decoding could throw.
- **Root cause:** `stripAnsi` and four local copies covered only a subset of control and
  invisible characters; `decodeHtmlEntities` converted any decimal reference without a range
  check, and diff text was decoded as if it were HTML.
- **Fix:** one text-cleanup pipeline in `src/utils-core.js` with a helper per kind of text
  (`sanitize`, `sanitizeBlock`, `sanitizeRaw`, `sanitizeLog`, `sanitizeCode`, `sanitizePath`),
  applied at render or in display-only parsers; entity decoding is single-pass and robust to
  malformed input; the local copies are removed.
- **Regression test:** `src/text-cleanup.test.js` (table, seeded property and size tests) and
  `src/render-checks/terminal-text.test.jsx` (renders each view with fields full of unusual
  characters, and checks that no file keeps its own copy of the cleanup).
- **Sibling sweep:** PRs, issues, branches, actions, notifications, logs, dialogs and the
  CLI watch-only report were checked for fields shown without the shared helpers.
