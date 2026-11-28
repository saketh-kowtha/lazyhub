# Launch plan: Review Alpha, then v1.0

This is the plan for #629: a small Review Alpha first, then a broad v1.0 launch. It names the gates each stage must pass, the checklists, the channels to use and the signals used to judge whether the launch worked.

It works with three other documents:

- [ALPHA_READINESS.md](ALPHA_READINESS.md): the evidence record for the Alpha gates (#134). This plan does not repeat its rows; it points at them.
- [PILOT_PLAN.md](PILOT_PLAN.md): the consented pilot (#286) that runs inside Stage 1.
- [ROADMAP.md](ROADMAP.md): product direction, stages and the D12 freeze. If this plan and the roadmap disagree, the roadmap wins.

## Principles

1. **Gates, not dates.** #629 names target windows: Review Alpha around Dec 1, 2026 and v1.0 around Jan 12, 2027. They are targets. A stage starts when its gates pass and the maintainer is satisfied with the build after using it. If a gate is not met, the date moves and the new date and reason go in #629. Nothing is announced early to meet a date.
2. **Every public claim is true for the version people install.** A feature is described as available only once it is in a published release on npm (and Homebrew, if Homebrew is offered). Work on `main` or in an open issue is described as planned, or not at all.
3. **No telemetry, ever** (AGENTS.md invariant 6). The launch is measured only with signals people choose to give, or with aggregate public counts that lazyhub does not collect: npm download counts, GitHub stars, issues and pull requests, `lazyhub feedback` reports that users submit themselves, and pilot results. No analytics, tracking links, pixels or install pings are added for the launch.
4. **No funding or sponsorship asks.** Launch posts, the README and the site ask people to try the tool and report what they find. They do not ask for money, sponsorship or donations.
5. **No traction claims.** Counts are reported as counts. Stars and downloads are not called evidence of usefulness; the pilot gates are (ROADMAP "Success signals").
6. **Neutral security wording.** Public text says what SECURITY.md says: how to report privately, what lazyhub can access, and how to run with least privilege. Launch copy never describes a past or open report beyond what is already published as an advisory.

## Where things stand (2026-11-27)

Observed facts, not a re-run of the readiness gates:

| Item | Observed |
|---|---|
| Published version | `26.6.3` on npm, on both `latest` and `next` (`npm view lazyhub dist-tags`) |
| Provenance | `npm view lazyhub@26.6.3 dist.attestations` returns an SLSA provenance attestation |
| Published commit | `gitHead` `04b642c` (#649); `main` is ahead only by release-script and demo-recording commits |
| Homebrew | `saketh-kowtha/tap` formula at `26.6.3` |
| Lead demo | `docs/demo/out/tour.gif` re-recorded around queue, evidence and why-red (#645, refreshed by #650) |
| Open gate issues | #134, #177, #248, #286, #295 (and #472, whose symptom is no longer visible on the tap) |
| Pilot | protocol written (#642); no session reported |

`ALPHA_READINESS.md` still records the 2026-11-15 NO-GO. Re-run its evidence against the pinned build before the Stage 1 decision.

## Stage 1: Review Alpha

**Audience:** terminal-oriented maintainers who review agent-written pull requests (ROADMAP "First audience").
**Goal:** learn whether the read-only review journey is useful enough to come back to. Reach is not the goal.
**Target window:** around Dec 1, 2026, after the gates below.

### Entry gates (all required)

- [ ] **Pinned build published and verified.** One exact version, published through the provenance workflow, with the post-publish smoke passing (ALPHA_READINESS rows 2 and 3; RELEASING.md).
- [ ] **Containment checked on the published artifact**, not only in source (row 1, #276).
- [ ] **Read-only journey passes** on the pinned build: `npm run test:pty` and `docs/MANUAL_TEST_PLAN.md` Sections 1 and 1b (row 4, #295).
- [ ] **Queue scope decision recorded** (row 5, #177): either the in-repo, org and set scopes on `main` satisfy the #134 amendment, or the maintainer narrows the requirement in #134.
- [ ] **Copy audit passed** (row 11, #285): README, the Pages site (`docs/*.html`) and `lazyhub --help` describe only what the pinned build does, including the "Review Alpha: what it is and isn't" section.
- [ ] **Homebrew matches npm** for the pinned version, or Homebrew is left out of Alpha posts (#472).
- [ ] **SECURITY.md** private reporting is enabled and the incident and deprecation steps in RELEASING.md are current (rows 10 and 14).
- [ ] **Maintainer has used the pinned build** on a real repository and is satisfied with it.

### Launch checklist

1. Re-run the ALPHA_READINESS evidence against the pinned version and update its verdict.
2. Record the signal baseline in #629 (see [Signals](#signals-and-how-to-read-them)).
3. Publish GitHub release notes for the pinned version: what it does, what it does not do (copy the README Alpha section), how to install it and how to report problems.
4. Send the first pilot invitations, one person at a time (PILOT_PLAN "Recruiting message template").
5. After the first pilot sessions confirm install and first run work, post in the community channels below. Post once per channel.
6. Triage incoming issues within a few days. Label pilot findings as PILOT_PLAN "Turning feedback into issues" says.

### Channels

| Channel | Use | Notes |
|---|---|---|
| Individual pilot invitations | the pilot gates | Consent first. No scraping of contributor lists, no mass messages (PILOT_PLAN). |
| GitHub release notes | the record of what shipped | Linked from every post. |
| r/commandline | a soft "I built this, feedback welcome" post | Follow the subreddit's self-promotion rules. |
| r/neovim | the same post, framed around the terminal review flow | Mention the editor integration only if its docs match the pinned build. |
| Terminal Trove | a listing submission | Use the README description and the fixture GIF. |

Not used in Stage 1: Show HN, broad social pushes, paid promotion, newsletters asked for coverage, and any channel that needs tracking links.

### Post template (Stage 1)

> **lazyhub: review agent-written pull requests from the terminal (Review Alpha)**
>
> lazyhub is a keyboard-driven TUI over the `gh` CLI. It lists the PRs that need you and says why, shows the evidence for a PR (facts, sources, what is unknown), explains why CI is red, and checks a description's claims against the diff. The review views are read-only, and it has no telemetry.
>
> It is an alpha. It does not enforce approvals, does not say whether a change is safe, and its agent surface is read-only. `npm install -g lazyhub@<pinned version>`; it needs Node.js 20+ and `gh auth login`.
>
> I'd like to hear where it confused you or got something wrong: issues, or `lazyhub feedback`.

Fill in the pinned version. Do not add features that are not in that version.

### Exit gates: Stage 1 to Stage 2

- [ ] Pilot report posted in #286 with the 10/5/3 counts as measured, and a checkpoint decision (continue, narrow or pivot). An unmet gate is reported as unmet.
- [ ] Every blocker found in Stage 1 is fixed in a release or documented as a known limit.
- [ ] No unresolved security report affecting the current release.
- [ ] Maintainer decision recorded in #629 to go ahead with Stage 2, and with which scope.

## Stage 2: v1.0

**Audience:** the broader developer audience, including people using coding agents.
**Goal:** a stable, documented release that people can adopt without the maintainer present.
**Target window:** around Jan 12, 2027, after the gates below.

### Entry gates

- [ ] Stage 1 exit gates met.
- [ ] **Scope agreed with the roadmap.** #629 lists Stage 2 work: MCP review tools (#603), a Claude Code plugin (#604), hand-off to a coding agent (#605), claims check (#361), collision radar (#360, closed), the lazyhub Gate Action (#607), the vitals package and write-up (#608), and lazyhub.dev with `/llms.txt` and MCP registry listings (#628). ROADMAP keeps agent integrations and packaging beyond npm and Homebrew behind pilot evidence (D12). Each item goes in v1.0 only if the pilot evidence and a recorded decision support it. Items that are not ready are left out of the launch, not announced as coming.
- [ ] **Everything in the launch copy is in the v1.0 release**, verified on the published artifact the same way as Stage 1.
- [ ] **Version and stability promise decided:** what "v1.0" means for the version number (the package uses `26.x` versions today) and which keys, config and MCP tools are considered stable.
- [ ] **Agent surfaces reviewed** against THREAT_MODEL.md for any new MCP tool, plugin, hand-off or Action, with the default still read-only (invariant 16).
- [ ] Pages site and README re-audited against the release; demo re-recorded if the journey changed.
- [ ] Maintainer has used the release candidate and is satisfied.

### Launch checklist

1. Publish the release through the provenance workflow and verify it.
2. Update the README, the Pages site and release notes in one pass.
3. If #628 shipped: the domain points at the site, `/llms.txt` describes only shipped behavior, and the registry listings name the read-only tools that exist.
4. Record the signal baseline again in #629 on launch day.
5. Post to the broad channels below, at a time the maintainer can answer questions for the rest of the day.
6. Watch issues for install and first-run failures for the first week and fix them first.

### Channels

| Channel | Use | Notes |
|---|---|---|
| Show HN | the main launch post | Plain title ("Show HN: lazyhub, review agent-written PRs in the terminal"). The post says what it does and does not do; the maintainer answers comments. |
| GitHub release notes and README | the source of truth | Every post links here. |
| lazyhub.dev, `/llms.txt`, MCP registries | discovery by people and agents | Only if #628 shipped; listings describe read-only tools only. |
| The Stage 1 channels | a follow-up post | Only if there is real news since the Alpha post. |
| The engineering write-up (#608) | a separate post | Only if the package and write-up shipped. |

## Signals and how to read them

There is no telemetry, so most of the path from "saw it" to "uses it weekly" is not observable. The plan measures what can be measured without watching anyone, and says what it cannot measure.

| Step | Signal | Source | How to read it |
|---|---|---|---|
| Interest | GitHub stars | repository page | A bookmark, not usage. Never cited as evidence of usefulness. |
| Install | npm downloads per week | `https://api.npmjs.org/downloads/point/last-week/lazyhub` | Includes CI runs, mirrors and `npx` tries. Compare whole weeks against the recorded baseline; do not compare single days. Homebrew tap installs are not counted anywhere. |
| First use | install and first-run issues, `lazyhub feedback` reports | GitHub issues | Each one is a person who got far enough to report. Count reports, not people's details. |
| Usefulness | pilot "inspect" and "unassisted task" gates | #286 report | The primary evidence (10 and 5 targets, PILOT_PLAN). |
| Repeat use | pilot week-later return | #286 report | The only repeat-use evidence (target 3). Not inferred from downloads. |
| Contribution | issues and PRs from people other than the maintainer | GitHub | Reported as counts per week. |

Not measured: page views, visitors, clicks, how many installs are opened, how long people use it, and who they are.

How to record:

- Before each stage and then weekly for four weeks, add one comment to #629 with the date, weekly npm downloads, star count, and counts of new issues, feedback reports and outside PRs. Counts only: no names, handles, repository names or quotes without permission.
- The Stage 2 decision uses the #286 pilot report. The other counts are context.

## Pause and rollback

- **A launch claim turns out to be untrue:** fix the README, site and release notes first, then add a correction under the original post. Promotion pauses until the copy is fixed.
- **Install or first run is broken for a published version:** follow RELEASING.md (rollback, deprecation), then post the fixed version under the original posts.
- **A security report arrives:** handle it through the private process in SECURITY.md. Promotion pauses while a report affecting the current release is unresolved. Public posts say only what a published advisory says.

## Not part of this plan

- Telemetry, analytics, tracking links or install pings of any kind.
- Funding, sponsorship or donation asks.
- Paid promotion, scraping contributor lists, or messaging people who did not ask to be contacted.
- Market-size, adoption or comparison claims, including about other projects named lazyhub.
- Announcing roadmap work as shipped, or announcing it as coming on a date.
