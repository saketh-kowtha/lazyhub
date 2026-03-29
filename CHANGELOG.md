# Changelog

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

