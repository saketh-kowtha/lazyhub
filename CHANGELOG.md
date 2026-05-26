# Changelog

## v26.6.1

# lazyhub v26.6.1

This is a patch release with no user-facing changes.

---

**Full Changelog:** [`v26.6.0...v26.6.1`](https://github.com/your-org/lazyhub/compare/v26.6.0...v26.6.1)

---

## v26.6.0

# lazyhub v26.6.0

> **lazygit-style GitHub TUI** — minor release

---

## ✨ What's New

### 🧠 Neovim Integration (Phases 1 & 2)

lazyhub now ships a first-class Neovim integration — no separate plugin required.

**Phase 1** (`#95`) lays the foundation:
- **Ambient PR status** — see the PR state for the current branch directly in your editor without leaving it
- **Smart `:LazyHubPR` command** — opens the relevant PR context based on your cursor position and current branch
- **LazyExtras support** — opt-in via `lazyhub.nvim` in your LazyExtras config, just like any other extra

**Phase 2** (`#96`) goes deeper into the review workflow:
- **Inline review comments rendered in the buffer** — read review feedback right where the code lives
- **Reply and resolve threads without leaving Neovim** — full round-trip review actions from the editor

---

### 🤖 Pluggable AI Providers (`#94`)

Swap in your preferred AI backend — lazyhub no longer assumes a single provider:

| Provider | Notes |
|---|---|
| **Claude Code** | Anthropic's agentic CLI |
| **Codex** | OpenAI's CLI |
| **Gemini CLI** | Google's CLI |

Configure your provider once and all AI-assisted features (PR summaries, review suggestions, etc.) route through it automatically.

---

### 🐛 Bug Fixes

#### Self-Hosted GitHub Enterprise (`#97`)
A long-standing issue where GHES instances were silently broken due to a hardcoded `github.com` base URL has been fixed. If you're on GitHub Enterprise Server, PR interactions should now work correctly. Accompanying tests have been corrected as well.

#### UI Bugs & Enhancements (`#93`)
A batch of smaller UI polish fixes — layout inconsistencies, edge-case rendering bugs, and UX improvements across various panels.

---

## 📦 Installation / Upgrade

```sh
# Homebrew
brew upgrade lazyhub

# Go
go install github.com/yourusername/lazyhub@v26.6.0

# From source
git checkout v26.6.0 && make install
```

---

## 🔗 Full Changelog

`v26.5.0...v26.6.0` — [compare on GitHub](https://github.com/yourusername/lazyhub/compare/v26.5.0...v26.6.0)

| Commit | PR | Description |
|---|---|---|
| `dd2a18b` | #96 | feat(nvim): Phase 2 — inline review comments + reply/resolve from buffer |
| `97c8d5e` | #97 | fix(ghes): self-hosted PRs broken — hardcoded github.com + wrong tests |
| `5fe8e82` | #95 | feat(nvim): Phase 1 — ambient PR status, smart :LazyHubPR, LazyExtras |
| `6e28bfc` | #94 | feat(ai): pluggable AI providers — Claude Code / Codex / Gemini CLI |
| `668bca1` | #93 | UI bugs & Enhancements |

---

## v26.5.4

# lazyhub v26.5.4

## What's Changed

### 🐛 Bug Fixes

- Fixed bugs (#91) (97d624e)

---

**Full Changelog**: https://github.com/reacherhq/lazyhub/compare/v26.5.3...v26.5.4

---

> **Note:** This is a patch release. No breaking changes or new features are included.

---

## v26.5.3

# lazyhub v26.5.3

## What's Changed

### 🐛 Bug Fixes & Tests

- Fixed a failing test to improve reliability of the test suite (#89) (`40b8ec2`)

---

## Notes

This is a **patch release** with no user-facing functional changes. The fix addresses an internal test issue, helping maintain codebase stability and CI health.

**Full Changelog:** https://github.com/yourusername/lazyhub/compare/v26.5.2...v26.5.3

---

## v26.5.2

# lazyhub v26.5.2

## What's Changed

### 🐛 Bug Fixes

- Various bug fixes to improve stability and reliability (#87) (`0bc6cfa`)

---

**Full Changelog:** [`v26.5.1...v26.5.2`](https://github.com/yourusername/lazyhub/compare/v26.5.1...v26.5.2)

---

> **Note:** This is a patch release. No new features or breaking changes are included.

---

## v26.5.1

# lazyhub v26.5.1

> Patch release — bug fixes and AI code review improvements

---

## 🐛 Bug Fixes

- **General bug fixes** to improve overall stability and reliability ([#85](../../pull/85), `847b169`)
- **Improved AI code review accuracy** — the AI-assisted review feature now produces more precise and relevant feedback ([#84](../../pull/84), `37ded14`)

---

## 📦 Installation / Upgrade

```bash
# Homebrew
brew upgrade lazyhub

# Go
go install github.com/yourorg/lazyhub@v26.5.1
```

---

## 🔗 Full Changelog

[v26.5.0...v26.5.1](../../compare/v26.5.0...v26.5.1)

---

*No breaking changes. Safe to upgrade from any v26.5.x release.*

---

## v26.5.0

# lazyhub v26.5.0 Release Notes

## What's New

### 🔌 Deep IDE Integration
lazyhub now speaks directly to your editor. A new **IPC layer**, **MCP server**, **NeoVim plugin**, and **VSCode extension** let you open PRs, diffs, and issues without leaving your editor — or jump from lazyhub straight into the relevant file at the right line. (#77)

### 🤖 AI Features
New AI-powered capabilities have landed alongside a round of bug fixes. Details will be surfaced in the full changelog as the feature stabilises. (088fbd7)

### ⏳ Skeleton Loaders
All list and detail panes now show **skeleton loaders** while data is fetching, eliminating blank screens and layout shifts during slow network calls. (#75)

---

## Bug Fixes

### 🔀 Admin Force Merge
Two follow-up fixes stabilise the **admin force-merge flow** that was introduced in an earlier release. Edge cases around permissions and state transitions have been resolved. (#81, #82)

### 🛠️ 12 UX Fixes
A focused sweep across the `ghui-roadmap` board closed **issues #43–#57**, addressing a range of interaction bugs including focus traps, keybinding conflicts, scroll position resets, and rendering glitches. (#74)

### 🔧 API Fix — `autoMergeAllowed`
Removed an invalid `autoMergeAllowed` field from the `getRepoInfo` query that was causing GraphQL errors for some repository configurations. (#76)

---

## Other Changes

- Growth engine content is now locked behind a structured HTML layer for accuracy and consistency. (#42)
- General bug fixes across multiple subsystems. (688e0f8)

---

## Upgrade Notes

> **IDE integration** requires installing the companion plugin for your editor separately. See the [IDE Integration docs](#) for setup instructions for NeoVim and VSCode.

No breaking changes. This is a **minor** release — drop it in as a direct replacement for v26.4.x.

---

**Full Changelog:** [`v26.4.0...v26.5.0`](#)

---

## v26.3.4

# Release Notes — lazyhub v26.3.4

## 🔧 Bug Fixes & Infrastructure

This is a patch release focused on stabilizing the automated release pipeline. No user-facing functionality has changed.

### What changed

- **Fixed automated releases** — Resolved an issue where new version tags were not being created automatically on merge. The `tag.yml` workflow was not firing because release commits included a `[skip ci]` flag that unintentionally suppressed it.
- **Cleaned up release workflow** — Removed a broken sync job that was causing noise and potential failures in the CI pipeline.

---

### Why so many patch releases?

You may notice versions `v26.3.2` and `v26.3.3` in the commit history. These were intermediate attempts to fix the release automation — each uncovering the next issue in the chain. `v26.3.4` represents the fully working state of the pipeline going forward.

---

> **No action required.** If you're already on `v26.3.2` or `v26.3.3`, this update brings no functional changes. Upgrading is safe but optional.

---

## v26.3.3

# lazyhub v26.3.3 Release Notes

## 🔧 Bug Fixes & Maintenance

This is a patch release focused on internal stability improvements to the release pipeline.

### What's Changed

- **Fixed broken release workflow** — Removed a faulty sync job from the CI/CD release workflow that was causing issues with automated releases. This is an internal fix and has no impact on lazyhub's functionality, but ensures future releases are delivered more reliably. ([#38](../../pull/38))

---

### Other Changes

- Updated README and documentation via automated marketing sync ([#33](../../pull/33), [#34](../../pull/34))
- Merged miscellaneous fixes to main ([#36](../../pull/36))

---

> **Note:** This release contains no user-facing feature changes or bug fixes to lazyhub itself. If you are currently on v26.3.2, upgrading is optional but recommended to stay in sync with the latest release baseline.

**Full Changelog**: [`v26.3.2...v26.3.3`](../../compare/v26.3.2...v26.3.3)

---

## v26.3.2

# lazyhub v26.3.2

## What's Changed

This is a patch release containing internal maintenance and documentation updates.

### 📝 Documentation
- Automated README and docs updates to keep project documentation in sync with the latest changes (#33, #34)

### 🔧 Bug Fixes
- Merged a set of fixes into main (#36)

---

## Installation

Update via your package manager or grab the latest binary from the [releases page](../../releases).

```sh
# Example: direct binary update
lazyhub update
```

---

**Full Changelog**: [`v26.3.1...v26.3.2`](../../compare/v26.3.1...v26.3.2)

---

## v26.3.1

# Release Notes — lazyhub v26.3.1

> **Patch release** · PR [#31](../../pull/31) — _Release setup pipeline_

---

## What's New

### 🚀 Automated Release Pipeline
lazyhub now has a fully automated release and deployment pipeline. Releases are published automatically to both **npm** and **Homebrew** via tag-based triggers, making it easier to stay up to date through your preferred package manager.

### 🐛 Bug Fixes & Improvements
- **Branch rules** — Fixed a recurring issue with branch rule handling (tracked in [#26](../../issues/26), resolved via [#27](../../pull/27)).
- **General stability** — Multiple rounds of bug fixes improving overall reliability and edge-case handling.
- **UI enhancements** — Various lazyhub interface improvements and polish landed as part of [#21](../../pull/21).

---

## Under the Hood

- Fixed several workflow strategy and configuration bugs that were affecting CI reliability ([#22](../../pull/22), [#23](../../pull/23), [#24](../../pull/24), [#25](../../pull/25)).
- Switched to a **tag-based release strategy** for more predictable versioning and publishing.
- Updated `package.json` and supporting metadata to align with the new pipeline.

---

## Installing / Upgrading

**npm**
```bash
npm install -g lazyhub@26.3.1
```

**Homebrew**
```bash
brew upgrade lazyhub
```

---

**Full changelog:** [`v26.3.0...v26.3.1`](../../compare/v26.3.0...v26.3.1)

---

