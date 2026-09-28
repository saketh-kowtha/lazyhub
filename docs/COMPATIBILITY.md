# Compatibility

lazyhub is a terminal UI, but several surfaces are depended on by scripts,
agents, and editor integrations. Treat the following as stable within a major
version.

## Never Break Silently

- CLI command names: `status`, `doctor`, `serve`, `mcp-server`, `--mcp`,
  `--debug-state`, `perf report`.
- Machine-readable output fields once documented in `CONTRACT.md`.
- MCP tool names and aliases listed in `CONTRACT.md`.
- TOML config keys shipped in `src/config/defaultConfig.toml`.
- Default panes: `focus`, `prs`, `issues`, `branches`, `actions`,
  `notifications`.
- Default keybinding action IDs in `[actions]` and default keymaps in
  `[keymaps]`.
- Exit behavior for status-bar commands: `lazyhub status` must not fail or hang
  when the cache is cold.

## TOML Config

Config keys are migrated, not silently removed. The migration mechanism is
`src/config/migrate.js`; removals require a major version unless a migration can
preserve behavior.

Question rule: if a future change asks "may I rename this TOML key?", the answer
is no within the same major version. Add the new key, migrate the old one, warn
for one minor release, then remove only in the next major.

## Deprecation Procedure

1. Announce the replacement in release notes.
2. Keep the old behavior working for one minor release.
3. Emit a warning when the deprecated path is used.
4. Remove only in the next major version.

## Exit Codes

Current state is inconsistent and intentionally documented as such:

- `lazyhub status` returns 0 for warm and cold cache, and 2 for invalid args.
- `--debug-state` exits 0 on success.
- MCP tool errors are encoded in JSON-RPC content with `isError: true`.

A stable error-code catalog is tracked separately; do not invent ad-hoc numeric
codes in new machine surfaces.

## JSON Schema Versions

New JSON-producing commands should include `schema_version`. Existing surfaces
without that field are compatibility gaps, not a precedent to copy.
