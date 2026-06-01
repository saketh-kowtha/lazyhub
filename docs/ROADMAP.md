# Roadmap — V1 execution order

> Which issue do I pick next? This file answers that. Read top-to-bottom.
>
> **Conventions:**
> - **Tier N** = serial dependency layer. Don't start Tier N+1 until Tier N's blocking items merge.
> - **(parallel)** = issues in this tier can run concurrently across separate sessions.
> - **Block on #N** = wait for #N before starting.

## TL;DR — what to start now

If you have **one** session: **#130 (Phase E1 — TOML config loader).** It is the keystone; ~10 other issues block on it.

If you have **multiple** sessions running in parallel: **#130 + #139 + #145 + any Phase C UI step.** Those four tracks have no inter-dependency and unblock the largest downstream surface.

---

## V1 — the path to launch

### Tier 0 — Foundation (do FIRST, alone)

| # | Title | Why it's first |
|---|---|---|
| **#130** | Phase E1 — TOML config loader | Every config-aware feature blocks on this. Ship it first. |

After #130 merges, four parallel tracks open up.

---

### Tier 1 — Core unlockers (4 parallel tracks)

| Track | # | Title | Blocks |
|---|---|---|---|
| Config writer | **#131** | Phase E2 — Settings TOML round-trip | #70 (wizard), #132 |
| Testability | **#139** | Phase J2 — `executor.js` `runGh` refactor | #138, #140 |
| Daemon | **#145** | Phase K — `lazyhub serve` daemon | #146, #147, #148, #149, #67 |
| UI polish (any) | **#126**, **#127**, **#128**, **#129** | Phase C steps 5c, 6, 7, 8 | #134 (the polish bundle references these) |

UI Polish steps are independent of each other AND of the other Tier-1 tracks — perfect for parallel sessions on a quiet day.

---

### Tier 2 — Build on Tier 1 (parallel after Tier 1 merges)

| Depends on | # | Title |
|---|---|---|
| #130 | **#132** | Phase E3 — wire keymaps through TOML |
| #130 | **#66** | Phase E4 — custom tabs |
| #130 | **#133** | Phase E5 — `lazyhub doctor --config` |
| #130, #131 | **#70** | First-run setup wizard |
| #145 | **#146** | Phase L1 — error code catalog |
| #145 | **#147** | Phase L2 — idempotency |
| #145, #130 | **#148** | Phase L3 — permission scopes |
| #145, #148 | **#149** | Phase L4 — `--dry-run` |
| #139 | **#138** | Phase J1 — vitest coverage in CI |
| #139 | **#140** | Phase J3 V1 — top-5 flow integration tests |

---

### Tier 3 — Features (mostly parallel)

These have weaker dependencies — pick whatever delivers most user value next.

| # | Title | Notes |
|---|---|---|
| **#62** | Phase F — CLI args for state resumption | Standalone; unblocks #135 |
| **#68** | Phase G — AI Q&A tab | Becomes an MCP tool via #145 |
| **#65** | PR template auto-fill + draft toggle | Standalone |
| **#69** | Share AI review (copy / post) | Standalone |
| **#73** | CI checks interactive in PR detail | Standalone |
| **#71** | PR & issue age color coding | Trivial |
| **#45** | Auto-merge M-key footer fix | Half-shipped; small remaining scope |
| **#137** | ZWJ test flake | Bug, low priority |
| **#67** | Background auto-refresh | Needs #145 (daemon) |
| **#141** | Phase J5 — pre-publish smoke test | Independent CI tooling |

---

### Tier 4 — Editor integration

| # | Title | Block on |
|---|---|---|
| **#135** | Phase I.1 — VSCode extension | #62, #128 (embedded mode), ideally #145 |

---

### Tier 5 — Polish bundle (LAST in V1)

| # | Title | Why last |
|---|---|---|
| **#134** | Phase H — V1 polish bundle (README, license, distribution, theme install, FUNDING.yml) | The dual-audience README needs to reflect what actually shipped. Do this once everything above is in. |

After #134 merges → **cut V1 release**.

---

## V2 — depth (after V1 launches)

Defer until V1 is live and has a few weeks of real usage. Pick based on feedback.

| Bucket | Issues |
|---|---|
| Agent contract depth | #150 L5, #151 L6, #152 L7, #153 L8, #154 L9, #155 L10, #156 L11 |
| Enterprise foundation | #157 M1 (team server architecture spike) |
| Editor integrations | #136 JetBrains, #142 J3 full integration tests, #143 J4 gh contract tests, #144 J6 AI contract tests |
| BYO-LLM | **#168 Phase E6** — `openai-compatible` AI provider (covers Ollama / Groq / LM Studio / Azure OpenAI / OpenRouter / vLLM via one HTTP provider) |
| Auxiliary features | #51, #57, #61 Raycast (V3), #63 watch mode, #64 desktop notifications, #67 auto-refresh (if not done in V1), #72 team view |

---

## V3 — enterprise + marketplace + agentic depth

Only if demand surfaces. Do not start until V2 ships AND you see real interest.

| # | Title |
|---|---|
| **#158** | Phase M2 — hosted team server (enterprise tier) |
| **#159** | Phase M3 — marketplace |
| **#61** | Raycast extension |
| **#169** | Phase G2 — NLS-B: natural language workspace search (`/` triggers AI-translated `gh search`) |
| **#170** | Phase E7 — Full LiteLLM integration (gated — only if #168 + named providers are insufficient) |

---

## Recommended weekly cadence (for solo maintainer)

| Week | Focus |
|---|---|
| 1 | #130 (E1 TOML loader) |
| 2 | #131 (E2 writer) + #139 (executor refactor) in parallel |
| 3 | #145 (daemon) + #126–#129 polish steps in parallel |
| 4 | Tier 2 config (#132, #66, #133) + Tier 2 agent contract (#146, #147, #148, #149) |
| 5 | Tier 3 features by user-value priority (#62, #68, #65, #69, #73, #71) |
| 6 | #70 wizard + #138 coverage + #140 flow tests + #141 smoke test |
| 7 | #135 VSCode extension |
| 8 | #134 polish bundle + cut V1 release |

That's an 8-week V1 if executed serially. Aggressive parallel execution via multiple AI sessions could compress to 4–5 weeks.

---

## How to use this with fresh sessions

For any AI session picking up an issue:

1. Read **this file first** to confirm the issue isn't blocked by something open.
2. Then read the **`> Before you start:`** header in the issue body.
3. Then the issue body itself.
4. Then any architect doc the issue cites.

If you find an issue claims "block on #N" but #N is actually merged (or vice versa), update **this file** alongside your PR. ROADMAP drifts faster than ARCHITECT_DECISIONS — keep it honest.

---

## Out of scope for V1

For clarity, V1 explicitly does NOT include (these are V2+):
- Multi-org team view
- Live CI streaming
- Desktop notifications
- JetBrains plugin
- Raycast extension
- Hosted team server
- Theme/extension marketplace
- Any paid tier
