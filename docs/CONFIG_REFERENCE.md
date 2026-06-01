# lazyhub TOML Configuration Reference

This page is generated from the same TOML metadata lazyhub uses at runtime.

## Runtime Source

The single source of truth is `~/.config/lazyhub/lazyhub.toml`.

- `[theme]` selects the active theme.
- `[app]`, `[panes.*]`, `[features.*]`, `[layout]`, `[diff]`, `[editor]`, `[ipc]`, and `[ai]` provide app configuration.
- `[actions.*]` stores key bindings plus label/description metadata for help, docs, and AI guidance.
- `[state]` stores auto-managed runtime state migrated from the old `state.json`.

`[state]` is owned by lazyhub. Saves may rewrite that table tree at the end of
the file, so keep hand-written notes for runtime state inside the table itself
or in another user-owned section.

## Regeneration

Use `generateConfigReferenceMarkdown()` from `src/config/docs.js` to render a current reference from the loaded TOML config.
