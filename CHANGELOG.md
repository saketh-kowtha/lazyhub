# Changelog

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

