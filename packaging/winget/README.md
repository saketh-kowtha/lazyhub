# winget

winget submissions are maintainer-driven because the public `winget-pkgs`
repository owns review and merge timing.

## Prepare a Submission

1. Confirm the version is promoted to npm `latest`.
2. Copy `manifests/l/lazyhub/<version>/` into a fork of
   `microsoft/winget-pkgs`.
3. Replace the existing `InstallerSha256` with the SHA256 of
   `https://registry.npmjs.org/lazyhub/-/lazyhub-<version>.tgz`.
4. Run `winget validate manifests/l/lazyhub/<version>`.
5. Open the winget-pkgs PR.

The manifest uses the npm tarball as the installer payload and depends on Node.js
and GitHub CLI being present on the target machine.
