# lazyhub — CI/CD Simplification Spec (Phase D)

**Status:** Architect spec (Opus) — for Sonnet to execute after Phase A merges
**Mandate:** "I don't want overkill and too many pipelines. I want simple setup." — user

This is the target end-state for `.github/workflows/`. Audit current state against this; delete or merge anything that doesn't fit.

---

## 1. Principles

1. **Three workflows max.** If a use case needs a fourth, escalate to Opus.
2. **No LLM in CI.** Zero. Not for changelogs, not for review, not for commit messages, not for "smart" anything. Deterministic only.
3. **No bot-written commits/PRs.** No release-please, no auto-version-bump-PR, no auto-merge. Humans tag releases.
4. **No GitHub Actions Marketplace actions** beyond Anthropic-trusted set: `actions/checkout`, `actions/setup-node`, `actions/upload-artifact`, `actions/download-artifact`, `actions/github-script`. Anything else is a supply-chain risk + future maintenance burden. Pin to commit SHA, not version tag. *(Amended by [Decision 9](ARCHITECT_DECISIONS.md) / #138: `davelosert/vitest-coverage-report-action@v2` is the one sanctioned exception, used only to post the PR coverage comment.)*
5. **One workflow file per concern.** Don't nest unrelated jobs in one file.
6. **No matrix builds** unless a multi-platform binary is being shipped. Node 22 on ubuntu-latest is the build target. Period.
7. **Fail fast.** No `continue-on-error: true` unless explicitly justified in a comment.

---

## 2. The three workflows

### `ci.yml` — runs on every PR and push to `main`

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@<sha>
      - uses: actions/setup-node@<sha>
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck     # if a typecheck script exists; skip if not
      - run: npm test
```

**No** flaky-test retries.

> **Amended by [Decision 9](ARCHITECT_DECISIONS.md) / #138 (2026-06-08):** the original "no coverage upload, no GitHub-posting reporters" rule is superseded for coverage only. `ci.yml`'s `check` job now also runs `npm run test:coverage`, uploads the `coverage/` artifact, and — on PRs — posts a diff-aware Vitest coverage comment (comparing against base-branch coverage). Hard thresholds live in `vite.config.js` (statements 48, branches 58, functions 45, lines 48). This is a deliberate, scoped exception; do not generalize it to other reporters or external services.

### `release.yml` — runs on tag `v*`

Replaces the current `publish.yml`. Same logic, but:
- Remove any AI-touched bits if present
- Add explicit auth check before publish step (fail loudly if `NPM_TOKEN` missing, not silently skip)
- Keep the homebrew-tap formula push (it's lean and works)
- Add a `tag-protection` precondition: only run if pushed by a maintainer (use `if: github.actor == 'saketh-kowtha'` or repo CODEOWNERS check)

```yaml
name: Release
on:
  push:
    tags: ['v*']

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@<sha>
        with: { fetch-depth: 0 }
      - uses: actions/setup-node@<sha>
        with:
          node-version: 22
          registry-url: 'https://registry.npmjs.org'

      - run: npm ci

      - name: Verify NPM_TOKEN present
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          if [ -z "$NODE_AUTH_TOKEN" ]; then
            echo "::error::NPM_TOKEN secret is not set — cannot publish"
            exit 1
          fi

      - name: Publish to npm
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: npm publish --access public

      - name: Compute tarball SHA256 + push homebrew formula
        # ...existing logic, unchanged
```

Note the deliberate behaviour change: missing `NPM_TOKEN` now **fails** instead of silently skipping. The silent-skip behaviour is how the npm-not-publishing bug went undetected.

### `dependabot.yml` (not a workflow, but counts) — security only

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule: { interval: weekly }
    open-pull-requests-limit: 5
    # Security updates are auto-opened by GitHub regardless;
    # this config covers non-security minor/patch bumps.
    versioning-strategy: increase
    # No auto-merge. Human reviews every PR.
```

That's it. No grouped updates, no version-ignore lists, no allow-rules — keep it boring.

---

## 3. What to delete

Sonnet's audit should look for and delete:

- Any workflow file invoking `claude`, `anthropic`, `openai`, `chatgpt`, `gemini`, `gpt`, `llm`, `ai-review`, `pr-agent`, `auto-summary`, `auto-changelog`, `release-please`, `release-drafter`, `semantic-release`, `commitlint` (if it ever invokes a model), `codecov` (only if it adds noise without paid tier value)
- Any "bot" account with write access not used by the three workflows above
- Any scheduled (`on: schedule:`) workflow other than dependabot (those are usually cost sinks)
- Any `gh-pages` deployment workflow if there is no live docs site at that URL
- Any duplicate workflow that runs the same checks as `ci.yml` (e.g., a separate `test.yml`)

For each deletion, the audit PR description must list **what was deleted and why** — so the user can spot a mistake before merging.

---

## 4. What to preserve

- Existing branch protection rules (only enforced by GitHub UI/settings, not in workflows — but verify they're still set: require `ci.yml` passing before merge to main).
- CODEOWNERS file if present.
- The homebrew-tap formula push (it's clean, no LLM).
- Any custom GitHub Action defined *in this repo* (under `.github/actions/`) only if used by the three workflows. Otherwise delete.

---

## 5. Workflow audit checklist (Sonnet must produce this in the PR)

For each existing file in `.github/workflows/`:

| File | Triggers | Purpose | Verdict | Action |
|---|---|---|---|---|
| `ci.yml` | … | … | keep / rewrite / delete | … |
| `publish.yml` | … | … | rename to `release.yml`, modify per §2 | … |
| `<other>` | … | … | keep / delete | … |

Then: explicit list of files deleted, files added, files modified.

---

## 6. Acceptance criteria

- `.github/workflows/` contains exactly two files: `ci.yml`, `release.yml`. (Plus `.github/dependabot.yml`.)
- `git grep -ri -E "claude|anthropic|openai|gemini|gpt|llm|chat.?gpt" .github/` returns nothing.
- A test PR run completes in under 3 minutes (excluding queue time).
- A test release (push a `v0.0.1-test` tag to a throwaway branch) publishes successfully end-to-end, then is yanked from npm and the tag deleted.
- Branch protection on `main` requires `ci.yml / check` to pass — verified.
- npm publish failure mode: token missing → loud error, not silent skip — verified by removing `NPM_TOKEN` locally in a dry-run.

---

## 7. Out of scope

- Migrating to GitLab CI / Circle / Buildkite. Stay on GitHub Actions.
- Self-hosted runners. ubuntu-latest is fine.
- Caching beyond `actions/setup-node`'s built-in npm cache.
- Multi-version Node testing. Node 22 only.
- Notarized/signed binaries. We ship via npm + homebrew; npm doesn't sign, brew handles its own checksum.

---

*Opus signoff: deliberately boring. If Sonnet finds something "interesting" worth keeping, escalate before adding it back.*
