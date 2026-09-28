# Scoop

This directory contains a bucket-ready manifest for `lazyhub`.

## Update

1. Verify the version is promoted to npm `latest`:
   `npm view lazyhub dist-tags`.
2. Update `version` and `url` in `lazyhub.json`.
3. Compute the tarball SHA256:
   `curl -fsSL https://registry.npmjs.org/lazyhub/-/lazyhub-<version>.tgz | sha256sum`.
4. Replace the existing hash with `sha256:<hash>`.
5. Test from a bucket checkout:
   `scoop install ./lazyhub.json && lazyhub --version`.

Windows support is gated by the repository `windows-smoke` CI job.
