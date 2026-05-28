# lazyhub docs

Architect specs, decisions, and reference material. Start here if you're picking up an issue cold.

## Reading order for a fresh session

1. **`ARCHITECT_DECISIONS.md`** — locked cross-cutting decisions (license, daemon, scopes, etc.)
2. **`GLOSSARY.md`** — definitions for every domain term (skim, jump back when you hit an unknown term)
3. **`FILE_MAP.md`** — concept → owning files crosswalk (skim, jump back when you need "where is X?")
4. The issue body (`gh issue view <N>`) — already cites which of the docs below to load
5. Whatever doc the issue cites (`DESIGN_REVAMP.md`, `POLISH.md`, etc.)

## Doc map

| Doc | Purpose | Read when |
|---|---|---|
| `ARCHITECT_DECISIONS.md` | Locked cross-cutting decisions | Every fresh session |
| `ARCHITECTURE.md` | High-level codebase architecture | Onboarding to the codebase; before cross-cutting refactors |
| `GLOSSARY.md` | Authoritative definitions for every domain term | Whenever an unfamiliar term appears |
| `FILE_MAP.md` | Concept → owning files crosswalk | Before greping; answers "where is X?" |
| `DESIGN_REVAMP.md` | Visual design system, tokens, screen layouts | Any UI / theme issue |
| `CI_SIMPLIFICATION.md` | Phase D CI design | Touching `.github/workflows/` |
| `MANUAL_TEST_PLAN.md` | Pre-release smoke test steps | Before tagging a release |
| `POLISH.md` | UX polish backlog | Phase H, Phase C step 8 |
| `AI_PROVIDERS_SPEC.md` | AI provider abstraction contract | Touching `src/ai/providers/` |
| `NVIM_INTEGRATION_SPEC.md` | nvim plugin contract (CLI args + IPC) | Touching the nvim plugin or embedded mode |
| `TEST_PLAN.md` | Legacy test plan (likely superseded by MANUAL_TEST_PLAN.md — verify before relying on it) | (Legacy) |
| `homebrew.md` | Homebrew tap setup notes | Touching the tap |

## Notes

- Cross-references between docs in this folder use bare filenames (relative resolution).
- Cross-references **from the issue board, README, or any path outside `docs/`** use the `docs/` prefix.
- If you add a new architect doc, update the table above and the doc map in `ARCHITECT_DECISIONS.md`.
- `TEST_PLAN.md` predates `MANUAL_TEST_PLAN.md` — flagged for the maintainer to dedupe or delete.

## Maintenance

Regenerate `FILE_MAP.md` after any major source refactor:

```bash
npm run docs:refresh
```

This walks `src/`, reads each file's JSDoc header, and rewrites `FILE_MAP.md`. Commit the result alongside the refactor.
