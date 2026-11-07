# Homebrew Tap

Lazyhub is available via the `saketh-kowtha/homebrew-tap` tap.

## Installation

```bash
brew install saketh-kowtha/tap/lazyhub
```

## Formula

The formula is rendered from [`packaging/homebrew/lazyhub.rb.tmpl`](../packaging/homebrew/lazyhub.rb.tmpl) by `node scripts/homebrew-formula.mjs render <tarball-url> <sha256> <version>`. Its test runs `lazyhub --version` and expects exit 0 and the package version in the output (an older formula expected exit 1, which only passed on a build that wrongly started the TUI).

## How the tap is updated

Only the `Promote` workflow (`.github/workflows/promote.yml`) updates the tap, as part of moving a soaked `next` build to `latest`. The tag-driven `Release` workflow publishes to `next` and does not touch the tap.

1. `Require TAP_TOKEN` fails the run before the npm dist-tag moves when the secret is missing, so a promotion is never green with Homebrew left behind.
2. The dist-tag is moved (skipped when the version is already `latest`, so a rerun can still bring the tap up to date).
3. The formula is rendered from the template and pushed with `TAP_TOKEN`.
4. `node scripts/homebrew-formula.mjs check --wait 120` fails the run unless the tap carries the npm `latest` version.

The `Tap check` workflow runs the same comparison every Monday (and on demand), so a stale tap is noticed within a week. Run it yourself with `node scripts/homebrew-formula.mjs check`.

## If the tap is behind

Run `Promote` again for the current npm `latest` version (enter it twice). It skips the dist-tag step, pushes the formula and verifies it. Updating `Formula/lazyhub.rb` by hand with the tarball URL and SHA256 is the fallback.
