# lazyhub TOML Configuration Reference

This page is generated from the same TOML metadata lazyhub uses at runtime.

## Runtime Source

The single source of truth is `~/.config/lazyhub/lazyhub.toml`.

- `[theme]` selects the active theme.
- `[app]`, `[panes.*]`, `[features.*]`, `[layout]`, `[diff]`, `[editor]`, `[ipc]`, and `[ai]` provide app configuration.
- `[ipc].allow_writes` (default `false`) lets editor integrations reply to and
  resolve PR review threads over the IDE socket. Reads and navigation always
  work. Local-only: a remote `config_url` cannot set it.
- `[actions.*]` stores key bindings plus label/description metadata for help, docs, and AI guidance.
- `lazyhub.toml` is sparse: it holds only what you chose. First run writes a comment header, never a copy of the defaults, so upgrades can change the default actions and keys. Copies written by older releases are recognised on load: an `[actions.*]` field or `[keymaps.*]` binding identical to a value lazyhub once shipped is ignored, and a binding to an unknown action id is ignored with a one-time notice. Your real customisations are kept, including actions you define yourself under `[actions.*]`. Re-setting a value to an old shipped default has no effect: it is indistinguishable from a frozen copy, so the current default applies.
- `[defaults].repo` (`"owner/name"`, default empty) is written once, when first-run
  onboarding completes (cancelling writes nothing). Precedence at startup: the
  repository named with `--repo owner/name` (this launch only, never saved), the
  repository picked in a first-run flow for this launch, then the repository
  detected from the current directory (remote URL or `gh repo view`), then
  `[defaults].repo`, then the interactive picker. The saved value is a fallback
  only: running lazyhub inside a repository always opens that repository. Edit or
  clear the key (and `repo_host`, the host it was saved under; a saved repo is ignored when `GH_HOST` differs) by hand, or rerun `lazyhub --onboarding`, to change it.
- `[ui].icons` (`auto` | `unicode` | `ascii`, default `auto`) controls the ASCII icon fallback. `auto` switches to ASCII on `TERM=linux` or `dumb`, a non-UTF-8 `LC_ALL`/`LC_CTYPE`/`LANG` (e.g. `C`), and legacy Windows consoles (no `WT_SESSION`/`TERM_PROGRAM`). Every symbol is replaced by an ASCII character of the same width.
- `[ui].no_color` (default `false`) drops all colors, keeping bold/inverse. The `NO_COLOR` environment variable (non-empty) does the same.
- `[ui].show_hints` (default `true`): `false` hides the footer key hints, the same layout as `[layout].compact_footer = true`.
- `[layout].preview_panel` (default `true`): `false` turns off the PR detail popover that floats over the PR list.
- `[features.prs].default_scope` (`mine` | `reviewing` | `all`, default `mine`) is the PR list scope on first launch; afterwards the last scope you used is remembered. `[defaults].pr_scope` is a retired alias, honoured only while `default_scope` is left at its default.
- Removed because nothing read them: `[ui].density`, `[ui].high_contrast` (pick the `lazyhub-high-contrast` theme instead) and `[diff].max_lines` (diffs are never cut off). Old files that still contain them load without a warning.
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

## Environment variables

- `LAZYHUB_GH_CONCURRENCY` (positive integer, default `4`) caps how many `gh`
  child processes lazyhub runs at once; extra calls queue first-in-first-out.
  Interactive `gh auth login` is never queued. This is a process-level knob, not
  a TOML key.

- `NO_COLOR` (non-empty) behaves like `[ui].no_color = true`. Color depth (truecolor, 256, 16) follows `COLORTERM`/`TERM`, and `FORCE_COLOR`/`--no-color` are honored.

## Regeneration

Use `generateConfigReferenceMarkdown()` from `src/config/docs.js` to render a current reference from the loaded TOML config.
