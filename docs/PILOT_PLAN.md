# Review Alpha pilot plan

This is the executable protocol for the learning gates in #134, run through #286. It adds no telemetry: every outcome is self-reported by a participant or observed in a session they agreed to. Nothing here is a result. The targets below are goals, and until sessions have happened no document, README or post may claim a pilot outcome.

Related: [ROADMAP.md](ROADMAP.md) (stages and the D12 expansion freeze), [RELEASING.md](RELEASING.md) (the `next` tag), [THREAT_MODEL.md](THREAT_MODEL.md). The Alpha go/no-go record (`ALPHA_READINESS.md`, in review as #641) holds the release and security gates; this plan does not replace them.

## Fill-in fields for the maintainer

Everything in `<angle brackets>` is the maintainer's to supply. Nothing is pre-filled on the maintainer's behalf.

| Field | Value |
|---|---|
| Pilot owner (recruits, runs sessions, counts) | `<name>` |
| Second person who checks the counts (or the owner re-reading the sheet cold) | `<name>` |
| Private sheet location (not in this repository) | `<link or path>` |
| Contact address for participants | `<email or handle>` |
| Pinned build | `lazyhub@26.6.3` (see [Pinned build](#pinned-build)) |
| Decision checkpoint date | `<date, on or before Jan 5>` |
| Continue / narrow / pivot criteria (written before the first session) | `<criteria>` |

## Goal and scope

Learn whether a maintainer who reviews agent-produced pull requests finds the review-first path (queue, evidence and diff, next action, return) useful enough to come back to. A coverage report that merely renders is not the test.

Learning gates, from #134 (kept as written):

1. Ten consenting maintainers inspect results.
2. Five of them complete a review task, unassisted, in a repository they choose.
3. Three return the following week.

In scope: the read-only Review Alpha journey over the participant's existing `gh` login. Out of scope: GitHub App or ruleset setup (optional approval stage, measured separately and never substituted by repository selection), Beta features, integrations, and any dashboard or usage tracking.

## Who qualifies

A participant should be:

- A maintainer who regularly reviews pull requests produced wholly or partly by coding agents (for example weekly or more often). Self-described is enough; do not ask for proof.
- Comfortable in a terminal and already logged in with `gh`.
- Reviewing a repository they are allowed to look at, either on screen with the maintainer present or alone.
- Primarily a solo maintainer or a very small team. Larger teams follow later.

Not a fit: people who only write code, people who do not review others' PRs, and anyone being asked as a favour who would rather not. Do not recruit by scraping contributor lists or mass-messaging. Reach out individually, to people the maintainer already has a reason to contact or who asked to try it.

## Pinned build

Participants install an exact version, never a floating tag, so that every session tests the same thing.

Preconditions the maintainer confirms before sending any invitation (the pilot does not start earlier):

- The candidate has been published and verified per [RELEASING.md](RELEASING.md) and #248, including provenance. `<yes / no, with date>`
- The containment and safety behaviour (#276) was checked against the published artifact, not only source. `<yes / no>`
- The candidate contains the features the script asks participants to use. `<yes / no>`

Check what is published before inviting anyone:

```
npm view lazyhub dist-tags
npm view lazyhub@26.6.3 version
```

Install instructions for participants. `26.6.3` is the Alpha candidate. Releases go to the `next` tag and stay there until the maintainer promotes them, so `latest` will not deliver it. Always use the explicit version:

```
npm install -g lazyhub@26.6.3
lazyhub --version        # should print 26.6.3
```

If the maintainer cuts a different candidate, replace `26.6.3` everywhere in the invitation and the sheet, and record the change. Do not mix versions within one session. Homebrew may lag npm, so do not offer it for the pilot unless the formula is confirmed to match the pinned version.

Tell participants the requirements: Node.js `>= 22.14` and the GitHub CLI logged in (`gh auth status`). Lazyhub uses their existing `gh` login and is read-only in this release. To limit exposure they may run with a fine-grained read-only `GH_TOKEN` as described in SECURITY.md. To remove it afterwards: `npm uninstall -g lazyhub`.

## Recruiting message template

Send individually. Edit the bracketed parts. Do not add claims about adoption or results.

> Subject: Would you try a terminal tool for reviewing agent-written PRs? (about 30 minutes, optional)
>
> Hi `<name>`,
>
> I'm `<your name>`, the maintainer of lazyhub, a terminal workspace for reviewing pull requests and their evidence. I'm looking for maintainers who review PRs written by coding agents, to try an early build and tell me honestly whether it helps. `<one sentence on why you are asking this person>`.
>
> What I'm asking: install one pinned version, then do one ordinary review in a repository you choose, about 30 minutes. You can do it alone and tell me how it went, or on a call with me watching your screen. I'd also like to check in about a week later.
>
> What I collect: your own answers and my notes from the session. The tool has no telemetry and I receive nothing automatically. I do not collect the contents of your repository, your PR text, code, tokens or logs, and please do not paste any. I keep notes in a private sheet that only I (and `<second person>`) can read. I only use your name or company if you say yes to that separately; otherwise you appear as "Participant 7".
>
> You can say no, stop at any point, skip any question, or ask me to delete your notes at any time, with no explanation. If you would rather not reply, I will not follow up more than once.
>
> If you are willing, reply "yes" and I'll send the install steps and a time. If you'd rather not, reply "no" or ignore this.
>
> Thanks, `<your name>` / `<contact>`

Consent record: the participant's written "yes" is the consent. Before an observed session, restate the same terms aloud and note in the sheet that they were accepted. Calls are not recorded unless the participant asks; the default is notes only.

Opt-out, applied immediately and without questions: mark the row "withdrawn" and delete the notes tied to that participant if they ask. A name or quote is removed from anything not yet published. If an aggregate count was already published, correct it rather than leaving it stale. Participants can also use the in-tool `lazyhub feedback`, which prepares a pre-filled issue with redacted diagnostics; they should read it before submitting and may decline.

## Session format

Two modes. Pick per participant; both count if the rules below are followed.

- **Observed** (preferred): a call with screen share, with the participant's consent. The maintainer says nothing about how to use the tool except the script's prompts.
- **Self-run**: the participant follows the script alone and reports back by message or form. Unassisted status is then self-reported and is labelled as such.

The participant installs the pinned version themselves, since installation is part of what is observed. Observe the first 10 minutes closely: how they launched (in a repo, outside, from a link, over SSH), the first screen they needed, and where they paused or asked for help.

## The unassisted review task

Read this to the participant, or send it as written.

> You will review one open pull request in a repository you choose, using lazyhub (and the browser if you want). Think aloud if we are on a call. There are no wrong answers; I am testing the tool, not you. Stop whenever you like.
>
> 1. **Install and start.** Install the pinned version and start lazyhub however you naturally would. Say what you expected to see.
> 2. **Find what needs you.** Find a pull request in your repository that you would actually review next. Say why it is the one.
> 3. **Look at the evidence.** Open it and say what you can tell about it: what changed, how fresh the information is, and what lazyhub can and cannot tell you. If anything looks uncertain or missing, say what you think it means.
> 4. **If CI is red,** find out why. If CI is green, skip this.
> 5. **Decide the next action.** Tell me what you would do next with this PR (approve, request changes, ask a question, leave it, hand it back) and what, if anything, would stop you. You may do the action itself in your normal GitHub workflow; lazyhub does not do it in this release.
> 6. **Return.** Go back to the queue. Say what you would look at next.
> 7. **Compare.** How would you have done this without lazyhub, and was it better, worse or the same?

Prompts the maintainer may use, and nothing else:

- "What are you expecting to happen?"
- "What would you do next?"
- "Is there anything you were looking for and could not find?"

Two comprehension checks at the end, because they test honest understanding of the product:

- "Does lazyhub enforce anything about approvals on this repository, or does it only observe?" (Correct: it observes. Coverage is advisory in this release.)
- "How sure is the tool about who or what wrote this PR?" (Correct: attribution can be uncertain, and the tool says so.)

### What "unassisted" means

A run is **unassisted** only if the participant reached step 5 (a stated next action about a PR they chose) without the maintainer telling them which key, screen or command to use, and without the maintainer fixing a problem for them that lazyhub needed fixed. Specifically:

- Reading on-screen help (`?`), the README or `lazyhub --help` is allowed and is not assistance.
- Any maintainer hint about where to go or what to press counts as assistance, however small. Record it with the time and what was said.
- A problem unrelated to the tool (their `gh` login expired) is noted as environment and they may resume. If the fix was required for lazyhub to work at all, mark the run "completed with help".
- A run that ends before step 5 is "not completed", whoever decided to stop. Record the reason.

## What is recorded and where

Recorded per participant in a private sheet held by the maintainer (a spreadsheet or document in the maintainer's own account, access limited to the owner and the second person). The sheet is never committed to this repository, attached to an issue or PR, or put in a gist or public board.

| Column | Notes |
|---|---|
| Pseudonym | "Participant 1" and so on. Real name or contact kept in a separate tab, only if needed to follow up. |
| Consent | Date, and whether it covers an observed call, self-run only, and naming. |
| Role fit | Reviews agent-produced PRs? How often, in their words. |
| Baseline | Current workflow and biggest friction, in a line. |
| Build and environment | Lazyhub version, OS, terminal, how they launched. |
| First 10 minutes | First screen they needed, where they paused or asked for help. |
| Time to first useful finding | Minutes from step 2 to a finding they call useful, or "none". |
| Task result | Unassisted completed / completed with help / not completed, and why. |
| Observed or self-run | Needed for honest counting. |
| Assistance log | Each hint: time and what was said. |
| Comprehension | Whether they answered the two checks correctly. |
| Misunderstandings and context switches | Short factual notes. |
| Saved effort | Their own estimate and reasoning, or "none". Labelled as an estimate. |
| Setup abandonment | Whether and why they stopped. |
| Return check | See below. |
| Issue links | Issues created from their feedback. |
| Withdrawn | Yes/no and date. |

In observed sessions, key presses for the top tasks may be noted for comparison with the budgets in #312. Do not infer them for self-run sessions.

Never recorded: the repository name unless the participant allows it, PR titles or bodies, code, diffs, comments, tokens, screenshots of private content, or logs. If a participant volunteers any of that, do not write it down; if it lands in the sheet by accident, delete it.

## Week-later return check

Seven days after the session (give or take two), send one short message, once. Do not nudge a second time.

> Hi `<name>`, one week on. Since our session, did you open lazyhub again for a real review? Yes or no is enough. If yes: roughly how many times, and for what? If no: what got in the way, or what would have made you? You can also say you'd rather not answer.

Record exactly one of:

- **Returned unprompted:** they used it again for real work before the check-in message. Self-reported is acceptable; note it as such.
- **Returned after the prompt:** they used it only after being asked. Not counted toward the gate.
- **Did not return:** their stated reason, in their words.
- **No answer:** not counted as returned. Do not infer from silence.

Because there is no telemetry, return is never inferred from tool data.

## Success thresholds and honest counting

| Gate | Target | Counts when |
|---|---|---|
| Inspect | 10 | A consenting participant opened a PR's evidence in the tool and described what it told them (observed or self-reported). |
| Unassisted review task | 5 | The run was marked "unassisted completed" under the definition above, in a repository the participant chose. |
| Return | 3 | "Returned unprompted" in the week-later check. |

Counting rules:

- Count participants, not sessions. One person who does the task twice is one.
- The three gates are reported separately. Do not merge them into one adoption figure.
- Do not count the maintainer, people who built the feature, or anyone paid or pressured to take part.
- Label self-reported results as such. The report says how many of the five were observed and how many self-reported.
- Do not round up, drop failed runs, retry a run until it passes, or add recruits only after seeing who did well. Record every attempt, including those that failed during install.
- Withdrawn participants are removed when they ask; the report says how many withdrew.
- The 10/5/3 targets are goals. If the pilot ends at, say, 6/2/1, the report says exactly that and the result is "gate not met", not "partial success". An unmet gate is an honest blocked or negative result and is recorded as one.
- Stars, downloads, launch excitement and requests to be told later are not evidence of repeat usefulness and are not counted.

The second person (or a cold re-read) checks the tally against the sheet before any number leaves it.

## Turning feedback into issues

- Within two working days of a session, the owner turns each distinct finding into a GitHub issue with no participant names, repositories or private details. Describe the behaviour neutrally: what the person tried, what they expected, what happened. Use the repository's existing templates and labels.
- Put the issue number in the sheet beside the pseudonym so findings are traceable without exposing identities.
- Merge duplicates: add a note to the existing issue instead of opening another.
- Findings about demand-gated work (changes since last inspection #294, multi-repo needs #317 and #318, integrations #297) are added as evidence to those issues. The pilot alone does not start that work; the decision checkpoint does.
- Anything that looks like a security or privacy problem goes through the private channel in SECURITY.md and is not described in a public issue or in this document.
- If a participant used `lazyhub feedback`, treat that issue as theirs and do not rewrite their words.

## Privacy

- No repository contents, PR text, diffs, code, tokens, logs or screenshots are collected. The tool sends nothing to the maintainer.
- Participants appear as pseudonyms. A name, company or quote is published only with their separate, explicit permission, recorded in the sheet.
- Published results are aggregate: counts, anonymous short themes, non-sensitive observations. With a small sample, avoid combinations (role, tool, location) that point to one person.
- The private sheet stays outside the repository. The final report contains only the aggregate.
- Participants may withdraw at any time, and notes are deleted on request.

## Timeline: Dec 1 to Jan 12

The pilot is a bounded window inside the two-stage launch in #629 (Dec 1 Review Alpha, Jan 12 v1.0). The dates assume the pinned build exists and the preconditions above are true. If they are not true by Dec 1, the start slides and the checkpoint is not extended silently: the maintainer records the new dates and reason in #286. The maintainer decides launch timing.

| Window | Activity |
|---|---|
| Until Nov 30 | Dry-run the script on a fixture repository with a collaborator (does not count toward any gate). Fix unclear wording. Fill in the fields above. Prepare the private sheet. |
| Dec 1 to Dec 5 | Confirm the pinned build and install steps. Send individual invitations (first batch). Record consent as replies arrive. |
| Dec 3 to Dec 19 | Run sessions. Aim for about ten participants. A second small batch around Dec 8 only if too few replied, never repeated to the same person. |
| Dec 10 to Dec 26 | Week-later return checks, each about seven days after its session. |
| Dec 22 to Jan 4 | Holiday pause: no new invitations. Finish issue triage from sessions. |
| By Jan 5 | Tally, second-person check, and the aggregate report in #286. Decision checkpoint: continue, narrow or pivot against the criteria written before the first session. |
| Jan 6 to Jan 12 | Fix or document anything the pilot found that blocks launch. The v1.0 plan in #629 proceeds only on the maintainer's decision, and the D12 expansion freeze stays until evidence supports a reviewed change. |

If ten participants are not reached by Dec 19, report the number actually reached. Do not extend the window to chase the figure without recording that it was extended.

## Reporting the result

When the window closes, post an aggregate report in #286 containing:

- The build and version tested, and the dates of the window.
- Participants approached, yes, no, no reply and withdrawn (counts only).
- The three gates as counted, each as "n of target", with observed versus self-reported.
- Aggregate observations: where people paused, common misunderstandings, comprehension-check answers as counts, reasons for not returning, and saved-effort remarks labelled as participants' own estimates.
- What was not measured, and the checkpoint decision.

No names, no private payloads, no telemetry, and no traction claims beyond those counts.
