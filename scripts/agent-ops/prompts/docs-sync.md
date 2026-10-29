# Job: docs-sync (daily, ops)

Make the docs and site match what merged to `main` since the last docs-sync PR. Find the last merged
`agent/docs-sync-*` PR, or look back 7 days if there is none.

1. For each merged PR, check whether user-facing behaviour, commands, keys, config or architecture
   changed. Check README.md, docs/CONFIG_REFERENCE.md (generated: run the generator, never hand-edit),
   docs/keybindings.html, docs/guide.html, docs/index.html and docs/FILE_MAP.md (`npm run docs:refresh`).
2. Describe only shipped behaviour, verified against source, and nothing planned as if it were done.
3. If the visible UI changed and `vhs` is installed, re-record only the affected tapes
   (`npm run demo -- <tape>`; see docs/demo/README.md).
4. Open one PR from `agent/docs-sync-<date>` with the label `agent:in-review`. If nothing needs
   changing, open nothing.

Don't edit AGENTS.md, SECURITY.md or docs/THREAT_MODEL.md. If one of them looks stale, list it in
the PR body.
