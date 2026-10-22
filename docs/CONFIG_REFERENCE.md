# lazyhub TOML Configuration Reference

This page is generated from the same TOML metadata lazyhub uses at runtime.

## Runtime Source

The single source of truth is `~/.config/lazyhub/lazyhub.toml`.

- `[theme]` selects the active theme.
- `[app]`, `[panes.*]`, `[features.*]`, `[layout]`, `[diff]`, `[editor]`, `[ipc]`, and `[ai]` provide app configuration.
- `[actions.*]` stores key bindings plus label/description metadata for help, docs, and AI guidance.
- `[defaults].repo` (`"owner/name"`, default empty) is written once, when first-run
  onboarding completes (cancelling writes nothing). Precedence at startup: the
  repository picked in a first-run flow for this launch, then the repository
  detected from the current directory (remote URL or `gh repo view`), then
  `[defaults].repo`, then the interactive picker. The saved value is a fallback
  only: running lazyhub inside a repository always opens that repository. Edit or
  clear the key (and `repo_host`, the host it was saved under; a saved repo is ignored when `GH_HOST` differs) by hand, or rerun `lazyhub --onboarding`, to change it.
- `[state]` stores auto-managed runtime state migrated from the old `state.json`.
- `[ai.second_opinion]` controls cross-model review routing for agent-authored
  PRs. It defaults to `enabled = true`; `[ai.second_opinion.map]` maps detected
  author families such as `copilot`, `claude`, `codex`, and `gemini` to a
  preferred reviewer provider.
- `[agent]` `default_scope` defaults to `read-only`; requesting a broader scope
  produces a config warning and grants no agent write authority.

`[state]` is owned by lazyhub. Saves may rewrite that table tree at the end of
the file, so keep hand-written notes for runtime state inside the table itself
or in another user-owned section.

## Regeneration

Use `generateConfigReferenceMarkdown()` from `src/config/docs.js` to render a current reference from the loaded TOML config.
