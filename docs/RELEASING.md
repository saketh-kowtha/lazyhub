# Releasing

lazyhub uses staged npm releases. Tags publish to `next`; a separate manual
promotion moves a soaked build to `latest` and updates Homebrew.

## Normal Flow

1. From a clean `main`, run `npm version patch`, `npm version minor`, or
   `npm version major`.
2. Push the commit and tag: `git push && git push --tags`.
3. The `Release` workflow (after approval of the `npm-publish` environment)
   builds and publishes `lazyhub@<version>` with
   `npm publish --tag next --provenance` via OIDC trusted publishing, then runs
   `scripts/release-smoke.mjs` against the published tarball, then creates the
   GitHub prerelease. No npm token is used anywhere.
4. Let the `next` build soak for 3-7 days.
5. Run the `Promote` workflow manually. Enter the version twice.
6. Promotion verifies the live `gh pr list` smoke path, moves
   `lazyhub@<version>` to `latest`, and updates the Homebrew tap.

## npm Trusted Publisher Setup (one-time, maintainer)

Workflows pin npm 11.21.1. Requirements (from docs.npmjs.com/trusted-publishers): npm CLI >= 11.5.1 and
Node >= 22.14 to publish; npm CLI >= 11.21.0 (or >= 12.2.0) for `npm dist-tag`
over OIDC; the job needs `id-token: write`; GitHub-hosted runners only. The
workflow filename and environment name are case-sensitive and are **not
validated when saved** (mismatches only fail at publish time). Provenance is
generated automatically for public repo + public package; the workflow also
passes `--provenance` explicitly.

1. GitHub: Settings -> Environments -> New environment `npm-publish`. Add
   required reviewers (the maintainer) and restrict deployment to `v*` tags
   plus `main` (promote runs from `main`). Disable self-review bypass if more
   than one maintainer exists.
2. npmjs.com: package `lazyhub` -> Settings -> Trusted Publisher -> GitHub
   Actions. Create **two** entries (workflow filename is bound per entry):
   - Org/user `saketh-kowtha`, repo `lazyhub`, workflow `release.yml`,
     environment `npm-publish`, permission: `npm publish`.
   - Same repo, workflow `promote.yml`, environment `npm-publish`,
     permission: `npm dist-tag`.
   A new configuration must complete a publish within 2 days or it expires.
3. Run the prerelease exercise below and confirm it passes.
4. Only then: npm package Settings -> Publishing access -> "Require two-factor
   authentication and disallow tokens". Revoke the old automation token on
   npmjs.com and delete the `NPM_TOKEN` repository secret. Do this last, so a
   misconfigured publisher can still be recovered.

If `npm dist-tag` over OIDC turns out to be unavailable for your setup, the
honest fallbacks are: run the promotion locally with `npm dist-tag add` under
your own 2FA login (no stored secret), or keep a narrowly scoped granular token
for promote.yml only, held in a separate environment with required reviewers
and a short expiry. Do not reintroduce a broad automation token.

## Prerelease Exercise (before the pilot)

1. On a branch from `main`: `npm version prerelease --preid=rc` (e.g.
   `26.6.3-rc.0`), merge it, then push that tag only.
2. Approve the `npm-publish` environment. Confirm `publish`, `smoke`, and
   `github-release` jobs pass.
3. Run locally to double-check: `node scripts/release-smoke.mjs <version>`.
4. Confirm the package page shows the "Built and signed on GitHub Actions"
   provenance badge and `npm view lazyhub@<version> dist.attestations` is set.
5. Run `Promote` with the rc version only if you want to exercise dist-tag over
   OIDC; roll `latest` back afterwards (see Rollback).

## Self-contained package (no runtime dependencies)

`build.js` bundles every runtime dependency (ink, react, execa, highlight.js,
...) into `dist/`, and `package.json` has no `dependencies`: they are build
inputs under `devDependencies`. `npm install -g lazyhub` therefore resolves no
packages; users run exactly the lockfile-pinned build that CI tested and that
provenance covers. Code splitting still keeps the TUI and highlight.js out of
non-TUI commands (#302).

- Assets the bundled code reads at runtime are copied into `dist/` by
  `build.js`: `defaultConfig.toml` and `yoga.wasm` (Ink's layout engine).
- `dist/THIRD_PARTY_LICENSES` is generated from the esbuild metafile (every
  bundled package's license text) and ships in the tarball.
- `ink/build/devtools.js` is stubbed (it only loads under `DEV=true` and needs
  the uninstalled optional `react-devtools-core`).
- CommonJS-only lazy loading must use literal `require()` calls (see
  `src/highlight-loaders.cjs`); `createRequire` or computed requires are not
  bundled and would break the packed install.
- `scripts/packed-install-smoke.mjs` (run in CI on Linux, macOS and Windows)
  packs the tree, installs it into an empty prefix with a temp HOME and checks
  nothing else was installed. `src/cli/lazy-load.test.js` asserts `dist/` only
  imports relative files and Node builtins.

## Dependency Graph (one lockfile for CI, release, promote)

Every workflow installs with `npm ci --no-audit --no-fund` from the committed
`package-lock.json`. Nothing deletes or regenerates it. `npm ci` fails if the
lockfile and `package.json` disagree, and every job then runs
`node scripts/record-toolchain.mjs --verify-clean`, which logs (and writes to
the job summary) the Node and npm versions, platform, and SHA-256 of
`package-lock.json` / `package.json`, and fails if either differs from the
committed copy. `release.yml` runs it before the build and again after, so a
changed graph fails before `npm publish`. Compare the lockfile hash in the CI
run for the tagged commit with the one in the Release run.

Why CI used to delete the lockfile: it was a workaround for npm's optional-deps
bug (npm/cli#4828). A lockfile generated on macOS could omit the Linux native
bindings of rollup/rolldown/esbuild, so `npm ci` failed on ubuntu-latest. The
committed lockfile now lists the bindings for every platform
(`@rollup/rollup-*`, `@rolldown/binding-*`, `@esbuild/*`), so the workaround is
no longer needed. Verify with a clean checkout:

```bash
npm ci --os=linux --cpu=x64      # also: --os=win32 --cpu=x64, --os=darwin --cpu=arm64
ls node_modules/@rollup node_modules/@rolldown   # the matching binding is present
```

Regenerating a portable lockfile (only when dependencies change, never in CI):

```bash
rm -rf node_modules package-lock.json
npm install --package-lock-only
npm ci && git diff --stat package-lock.json
```

Then check that the platform bindings above are still listed in
`package-lock.json` (`grep -c 'rollup-linux-x64-gnu\|rollup-win32-x64-msvc\|binding-linux-x64-gnu\|binding-win32-x64-msvc' package-lock.json`)
before committing. Do not hand-edit the lockfile.

## Verification

```bash
npm view lazyhub dist-tags
npm view lazyhub@next version
npm view lazyhub@latest version
```

Before promotion, `next` should point at the new release and `latest` should
remain unchanged.

## Rollback

Move `latest` back to the previous good version:

```bash
npm dist-tag add lazyhub@<previous-version> latest
```

`npm dist-tag` works over OIDC from `promote.yml`; locally it needs your own
2FA login.

Then rerun the Homebrew update from the `Promote` workflow for the previous
version, or update the tap formula manually with that tarball URL and SHA256.

## Hotfix Exception

A hotfix may go straight to `latest` only when the maintainer decides the risk
of waiting is worse than the release risk. Run `Promote` immediately after the
tag workflow publishes to `next`; the workflow requires typing the version twice
to make the exception deliberate.

## Deprecating a Bad Release

Published versions cannot be replaced. Deprecate and move tags instead:

```bash
npm deprecate lazyhub@<bad-version> "Broken release; use <good-version>"
npm dist-tag add lazyhub@<good-version> latest   # and `next` if needed
```

Use `npm unpublish` only inside npm's unpublish window and for a security
emergency. Then ship a fixed patch through the normal flow.

## Revoking Access After a Suspected Compromise

1. Delete the trusted publisher entries on npmjs.com (Settings -> Trusted
   Publisher) so no workflow run can publish; re-add after remediation.
2. Revoke any npm tokens (npmjs.com -> Access Tokens) and rotate `TAP_TOKEN`.
3. If an OAuth/GitHub App integration was involved, revoke it: GitHub ->
   Settings -> Applications (user) or the org's Installed GitHub Apps ->
   Configure -> Suspend/Uninstall, and revoke authorized OAuth Apps.
4. Review `npm-publish` environment deployment history and the Actions run log
   for the suspect version; use the provenance attestation to identify the
   exact commit and workflow run that built the tarball.
5. Deprecate affected versions (above) and publish a fixed release.
