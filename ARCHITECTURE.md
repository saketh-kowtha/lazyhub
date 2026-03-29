# lazyhub — Architecture & Point of Truth

> **Purpose of this file:** Single source of truth for any AI coding assistant or human contributor. Read this before touching any file. It documents every architectural decision, every known bug (with root cause + fix), and every invariant.

---

## 1. The Core Vision
lazyhub is a terminal-based UI for GitHub, heavily inspired by the keyboard-driven UX of `lazygit`.
- **Pure ESM**: Modern Node.js architecture.
- **Ink-Powered**: React-based TUI framework.
- **gh-CLI First**: All GitHub operations MUST happen via the official `gh` CLI.

---

## 2. Elite CI/CD & Staging Strategy

We use an **Enterprise Staging Model** to ensure 100% stable production releases.

| Branch | Action | Purpose |
| :--- | :--- | :--- |
| **Feature** | PR to `main` | Primary integration area. |
| **`main`** | **Release PR** | When ready to ship, `workflow_dispatch` opens a PR from `main` to a new release branch. |
| **`release`** | **Promotion** | Merging the release PR into `main` triggers production deploy. |

### The "Circular Sync" Pattern
To prevent merge conflicts and "branch drift":
1. **Prep**: Bot opens PR from `main` -> `release` with AI docs + version bump.
2. **Deploy**: Merging `release` -> `main` creates Tag + Publishes.
3. **Sync**: Bot automatically opens a **Sync PR** from `main` back to `release` to keep staging in sync with production.

---

## 3. Branch Protection (Ruleset enforced)

| Setting | `main` | `release` |
|---|---|---|
| Required checks | Test (Node 20/22), Dependency audit | same |
| strict (up-to-date) | `false` | `true` |
| Required reviews | 1 approval, dismiss stale | + admin review |
| Linear history | yes | yes |
| Force push | **BLOCKED** | **BLOCKED** |
| Deletions | blocked | blocked |
| enforce_admins | yes | yes |

---

## 4. Required Secrets

| Secret | Used by | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | `release.yml`, `claude-review.yml` | AI Code Reviews & Release Notes |
| `GEMINI_API_KEY` | `release.yml`, `growth-engine.yml` | AI Architecture Docs & Marketing |
| `NPM_TOKEN` | `publish.yml` | `npm publish` authorization |
| `TAP_TOKEN` | `publish.yml` | Homebrew formula updates |
| `GITHUB_TOKEN` | all workflows | GitHub Actions built-in |

---

## 5. Development Invariants

1. **`executor.js` is the only file that calls `gh`** — enforced by `no-restricted-imports`.
2. **`useTheme()` not `import { t }`** — always use the hook in components.
3. **FuzzySearch always gets objects**, never strings.
4. **GraphQL integer variables use `-F`**, string variables use `-f`.
5. **`notifyDialog(true/false)`** must be called by any component that opens/closes a dialog.
6. **`ErrorBoundary` wraps every view branch** in `app.jsx`.
7. **`sanitize()`** every string from GitHub API before rendering in Ink components.
8. **`ai.js` is the only file for Anthropic API calls**.

---

## 6. Quality Control (Deterministic)

- **Dead Code:** Run `npx knip` to find unused files and exports.
- **Architectural Linting:** `npm run lint` enforces the "Executor Pattern".
- **Validation:** Always run `npm test` before any PR merge.

---

## 21. Complete bug fix log (reference)

... [Previous B-01 through B-14 content preserved] ...
