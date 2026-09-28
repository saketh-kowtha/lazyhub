# Releasing

lazyhub uses staged npm releases. Tags publish to `next`; a separate manual
promotion moves a soaked build to `latest` and updates Homebrew.

## Normal Flow

1. From a clean `main`, run `npm version patch`, `npm version minor`, or
   `npm version major`.
2. Push the commit and tag: `git push && git push --tags`.
3. The `Release` workflow builds and publishes `lazyhub@<version>` with
   `npm publish --tag next`.
4. Let the `next` build soak for 3-7 days.
5. Run the `Promote` workflow manually. Enter the version twice.
6. Promotion verifies the live `gh pr list` smoke path, moves
   `lazyhub@<version>` to `latest`, and updates the Homebrew tap.

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

Then rerun the Homebrew update from the `Promote` workflow for the previous
version, or update the tap formula manually with that tarball URL and SHA256.

## Hotfix Exception

A hotfix may go straight to `latest` only when the maintainer decides the risk
of waiting is worse than the release risk. Run `Promote` immediately after the
tag workflow publishes to `next`; the workflow requires typing the version twice
to make the exception deliberate.
