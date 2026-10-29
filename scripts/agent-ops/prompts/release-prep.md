# Job: release-prep (manual, ops)

Prepare, but don't perform, the next release, following docs/RELEASING.md exactly.

1. Determine the version per docs/RELEASING.md's scheme, and the changes since the last tag
   (`git describe --tags --abbrev=0`).
2. Branch `agent/release-prep-<version>`. Update the version files and the changelog/release notes as
   RELEASING.md describes, grouped as Features, Fixes, Security (neutral wording) and Internal.
3. Run the gate and the release smoke scripts that RELEASING.md lists, and record the results.
4. Open the PR with the label `agent:in-review`. The body ends with the exact commands the
   maintainer runs after merging (tag and push). Never create or push the tag yourself.
