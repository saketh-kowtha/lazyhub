# Agent ops

How lazyhub uses AI coding agents to build, review and maintain itself, and the limits that keep a
human in charge of everything that ships.

## Roles

| Role | Default tool | Does | Never |
|---|---|---|---|
| **Builder** | Claude Code | Implements `agent:ready` issues, answers reviews, files CI-failure tickets (`ci-triage`) | Merge, tag, publish, change settings |
| **Reviewer** | Codex | Reviews every agent PR, pushes small fixes, sets `agent:ready-to-merge` or `agent:changes-needed` | Merge, tag, publish |
| **Ops** | Claude Code (Gemini CLI once installed) | Docs and site sync (`docs-sync`), weekly digest with proposals (`digest`), release prep on demand (`release-prep`) | Merge, tag, publish, act on its own proposals |
| **Maintainer** | You | Applies `agent:ready`, merges, pushes release tags, approves proposals | |

The reviewer must use a different tool from the builder, so a second model family checks the first
one's work. Roles map to tools in `scripts/agent-ops/config.json`, so one, two or three tools all work.

## Label state machine

```
issue:  agent:ready ──▶ agent:in-progress ──▶ agent:in-review ─┐
                                   └─(no PR)─▶ agent:blocked     │
PR:     agent:in-review ──reviewer──▶ agent:ready-to-merge ──▶ maintainer merges
               ▲               └────▶ agent:changes-needed ──builder──┐
               └──────────────────────────────────────────────────────┘
        after 3 review rounds, or any unexpected stop ──▶ agent:blocked (maintainer)
```

- **Trust boundary.** An issue is picked up only if the latest `agent:ready` label was applied by a
  login in `maintainers`. The orchestrator checks the issue timeline, so a stranger's label doesn't count.
- **Scope.** The orchestrator touches only PRs on `agent/*` branches.
- **Untrusted input.** Agents receive an item number, never its text. They read issues and PRs
  themselves and treat them as data (`scripts/agent-ops/prompts/common.md`).

## Orchestrator

`scripts/agent-ops/orchestrator.mjs` is a plain Node script, not an AI. Each tick it:

1. reads the board with `gh`;
2. plans jobs (`lib.mjs`, unit-tested). The priority order is review, fix, build, then scheduled
   jobs. Each tick has a job limit (`maxJobsPerTick`) and each role has a daily cap (`dailyCap`);
3. runs each agent CLI headless in a throwaway worktree of `origin/main`, with a timeout;
4. moves labels based on the outcome. Anything unexpected becomes `agent:blocked`, with a comment.

It writes its state, logs and worktrees to `~/.local/share/lazyhub-agent-ops` (0700 directories,
0600 files), and only one run happens at a time.

| Scheduled job | Role | When |
|---|---|---|
| `ci-triage` | builder | Daily |
| `docs-sync` | ops | Daily |
| `digest` | ops | Mondays (proposals marked post-launch until January 2027) |
| `release-prep` | ops | Manual: `--job release-prep` |

## Safety layers

1. **GitHub enforces merges and publishing** (the layer that matters):
   - Agents act as a separate bot account with write access but not admin.
   - Branch protection on `main` requires the CI checks and the maintainer's approving review.
   - npm publishing happens only in CI through trusted publishing (#248), after a maintainer pushes a tag.
2. **Claude Code deny list:** the orchestrator passes a settings file that denies `gh pr merge`,
   releases, tags, force pushes, pushes to `main`, `npm publish` and `npm version`. This was verified
   by a headless run that tried `gh pr merge --help` and was refused. Codex has no equivalent setting,
   so its limit is layer 1.
3. **Prompts:** the AGENTS.md rules, no co-author lines, and neutral security wording. Prompts are the
   weakest layer and are never relied on alone.

## Install (macOS)

1. **Bot account** (recommended before the first real tick):
   - Create the GitHub account and invite it with **Write** access.
   - Create a fine-grained token for it, scoped to this repo, with Contents, Pull requests and
     Issues read/write.
   - Store the token in your login keychain and export it as `AGENT_OPS_GH_TOKEN` in `~/.zprofile`,
     for example `export AGENT_OPS_GH_TOKEN=$(security find-generic-password -s lazyhub-agent-ops -w)`.

   Without the bot account, agents act as you, and only branch protection stands between them and a
   merge.
2. **Branch protection on `main`:** require the CI checks and one approving review, and don't allow
   bypass for the bot.
3. **Labels:** `node scripts/agent-ops/labels.mjs`.
4. **Tool logins:** sign in to Claude Code and Codex once interactively (`claude`, `codex login`). For
   ops on Gemini, install the CLI with `npm i -g @google/gemini-cli`, sign in, check the flags in
   `config.json` against `gemini --help`, remove `"unverified"`, and set `roles.ops.tool` to `"gemini"`.
5. **First run:** `node scripts/agent-ops/orchestrator.mjs --dry-run`, then label one small issue
   `agent:ready` and run `node scripts/agent-ops/orchestrator.mjs` by hand.
6. **Schedule** (every 30 minutes):
   - Copy `scripts/agent-ops/com.lazyhub.agent-ops.plist` to `~/Library/LaunchAgents/`.
   - Replace `REPO_PATH`, `NODE_PATH` and `HOME_PATH` in it.
   - Load it with `launchctl load ~/Library/LaunchAgents/com.lazyhub.agent-ops.plist`.
   - To pause, run `launchctl unload` on the same file.

## Operating it

- **Stop everything:** `launchctl unload ~/Library/LaunchAgents/com.lazyhub.agent-ops.plist`.
- **See what the next tick would do:** `--dry-run`.
- **A blocked item:** read the comment and the local log named in it, then fix the issue text or
  relabel it `agent:ready`.
- **Subscription limits:** lower `dailyCap` or `maxJobsPerTick`. Set `roles.<role>.model` to choose a
  model per role (the top model for hard work, lighter models for routine jobs).
- **Router experiment (optional, later):** a local decision model such as Laya
  (`convaiinnovations/laya`) can suggest issue type, model tier and CI-failure class. Calibrate it on
  the repo's labelled history first, keep it only if it beats keyword rules, and let it suggest, never
  decide.
