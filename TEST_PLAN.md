# lazyhub — Test Strategy

Goal: actively find bugs and edge cases before users do. Not just coverage numbers — tests that would have caught every bug already filed in the issue tracker.

Current state: executor, ai, bootstrap, and utils have unit tests. Zero component tests. Zero integration tests. Zero property-based tests. The entire UI layer is untested.

---

## Strategy overview

Four complementary layers, each catching a different class of bug:

| Layer | What it catches | Tools |
|-------|----------------|-------|
| 1. Executor contract tests | Wrong gh CLI args, silent failures, error parsing | vitest + execa mock |
| 2. Component render tests | Broken layout, wrong states, missing keys, text overflow | ink-testing-library |
| 3. Property-based tests | State machine violations, unrecoverable UI states, invariant breaks | fast-check + vitest |
| 4. AI-generated scenario matrix | Combinations no human thinks to write | Claude API + vitest codegen |

Run order in CI: 1 → 2 → 3 → 4. Layers 1-2 must be fast (<10s). Layers 3-4 can be slower, run on PR only.

---

## Layer 1 — Executor contract tests

**What:** Every function in `executor.js` tested against mocked `execa` output. Not just happy path — every documented error code and every `catch` path.

**Philosophy:** If `gh pr merge` fails with a specific GitHub error message, the executor must surface it, not swallow it. Every `catch { /* ignore */ }` in the codebase represents an untested failure path.

### Test matrix per executor function

For each function test:
1. Happy path — correct gh args, correct JSON parsing
2. Empty response — `stdout: ''` → should return null or `[]`, never crash
3. Malformed JSON — `stdout: 'not json'` → should throw with descriptive message
4. Non-zero exit code → should throw `GhError` with `stderr`, `args`, `exitCode` preserved
5. Rate limit error (`stderr` contains "rate limit") → error message must mention rate limiting
6. Auth error (`stderr` contains "401" or "authentication") → error must indicate auth failure
7. Not found (`exitCode: 1`, stderr "not found") → should throw, not return null silently
8. Network timeout (`stderr` contains "context deadline") → specific timeout message

### Known gaps to fix first

These are executor paths that currently have zero test coverage and are known to swallow errors:

```
enableAutoMerge  — no test, error swallowed in detail.jsx
disableAutoMerge — no test, error swallowed in detail.jsx
addLabels        — no test, error swallowed in detail.jsx
removeLabels     — no test, error swallowed in detail.jsx
requestReviewers — no test, error swallowed in list.jsx
reviewPR         — no test
getBranchProtection — no test
```

### Example: what a good executor test looks like

```js
// Currently missing — should be added
describe('enableAutoMerge', () => {
  it('throws when repo has auto-merge disabled', async () => {
    mockExeca({ exitCode: 1, stderr: 'Pull request auto merge is not allowed for this repository' })
    await expect(enableAutoMerge('owner/repo', 42, 'squash'))
      .rejects.toThrow(/auto merge is not allowed/)
  })

  it('throws with exit code on unknown failure', async () => {
    mockExeca({ exitCode: 1, stderr: 'GraphQL error' })
    await expect(enableAutoMerge('owner/repo', 42, 'squash'))
      .rejects.toBeInstanceOf(GhError)
  })

  it('resolves with no error on success', async () => {
    mockExeca({ stdout: '{}' })
    await expect(enableAutoMerge('owner/repo', 42, 'squash')).resolves.not.toThrow()
  })
})
```

---

## Layer 2 — Component render tests

**What:** Render each component with `ink-testing-library` across all meaningful state combinations and assert on the terminal output string. Catches broken layout, wrong loading states, missing hints, empty state problems.

**Tool:** `ink-testing-library` is already installed. Use `render()` from it.

### States to test for every list pane (PRs, Issues, Branches, Actions, Notifications)

```
loading=true,  items=[]       → shows loading text, no crash
loading=false, items=[]       → shows empty state with action hints
loading=false, items=[1]      → renders item, correct fields visible
loading=false, items=[100]    → renders only visible window, no overflow crash
error=<Error>, items=[]       → shows error with retry hint
loading=false, items=[], terminal_cols=40   → narrow layout, no crash
loading=false, items=[], terminal_cols=220  → ultra-wide, no crash
```

### States to test for PR detail

```
pr.state=OPEN,   pr.isDraft=false  → merge/approve hints visible
pr.state=OPEN,   pr.isDraft=true   → merge blocked, draft indicator visible, M key hint absent
pr.state=MERGED                    → no merge/approve hints shown
pr.state=CLOSED                    → close hint absent
pr.checks=[]                       → Checks section absent, no empty header
pr.checks=[{failing}]              → ✗ icon with count visible
pr.body=null                       → no Description header rendered
pr.body=<2000 char string>         → does not crash, truncates safely
pr.title=<100 char string>         → truncates in header, does not break layout
pr.mergeable=CONFLICTING           → conflict warning visible
pr.mergeStateStatus=BLOCKED        → blocked warning visible
pr.autoMergeRequest=<obj>          → auto-merge active indicator visible, M shows disable hint
scrollY=0                          → M hint visible in hint line
scrollY=5                          → M hint still visible (regression: currently broken)
```

### States to test for LogViewer (Actions logs)

```
lines=[]                           → shows empty state, no crash
lines=[<500 lines>]                → scrolls correctly, no overflow crash
lines=[<line with ANSI codes>]     → ANSI stripped, no raw escape chars in output
lines=[<line starting with ##>]    → rendered as bold step header
lines=[<line with "error">]        → rendered in fail color
filterQuery="xyz", no matches      → shows "no results" not blank screen
```

### The height regression test (issue #43)

This is the most critical single test to write. It would have caught the existing bug:

```js
it('detail view fills terminal height', () => {
  const { lastFrame } = render(<App />, { rows: 40, columns: 100 })
  // navigate to detail view
  // assert the rendered output has exactly 40 rows, not fewer
  const lines = lastFrame().split('\n')
  expect(lines.length).toBe(40)
})
```

### Footer key tests

For every view, assert that:
1. The `?` key is always present in the footer
2. The `Esc`/`q` key is always present
3. Footer never wraps to more than 1 line at 80 columns
4. Footer never shows duplicate keys

```js
it('detail footer fits in 80 columns without wrapping', () => {
  const { lastFrame } = render(<App />, { columns: 80 })
  // navigate to detail
  const footerLine = lastFrame().split('\n').at(-1)
  expect(footerLine.length).toBeLessThanOrEqual(80)
})
```

---

## Layer 3 — Property-based tests

**What:** Instead of writing fixed test cases, define invariants that must always hold and let `fast-check` generate hundreds of random input combinations to find violations.

**Install:** `npm install --save-dev fast-check`

### Invariants — things that must ALWAYS be true

These are the rules. If any test run violates one, it's a bug.

**Navigation invariants:**
- From any view, pressing `q` or `Esc` enough times always reaches the list view or exits cleanly. Never gets stuck.
- Tab always moves to the next pane. Shift+Tab always moves to the previous. After N tabs you return to where you started (circular).
- Number keys 1-9 always jump to the correct pane index without crashing.
- `?` always toggles the help overlay regardless of current view.

**Data invariants:**
- Rendering a PR row never crashes regardless of which fields are null/undefined (author, title, checks, labels, updatedAt can all be missing).
- Rendering an empty list never shows a cursor at position -1 or position > 0.
- `cursor` is always `>= 0` and `< items.length` after any navigation.
- `scrollOffset` is always `>= 0` and `<= Math.max(0, items.length - visibleHeight)`.

**State machine invariants:**
- `dialog` being set always causes `notifyDialog(true)` to be called.
- `dialog` being cleared always causes `notifyDialog(false)` to be called.
- No two dialogs can be open simultaneously.
- `loading=true` and `error!=null` never coexist.

### Example: property test for navigation

```js
import fc from 'fast-check'

it('cursor always stays within bounds after arbitrary navigation', () => {
  fc.assert(fc.property(
    fc.array(fc.constantFrom('j', 'k', 'G', 'g', 'r'), { maxLength: 200 }),
    fc.integer({ min: 0, max: 500 }), // item count
    (keys, itemCount) => {
      const { cursor, scrollOffset } = simulateNavigation(keys, itemCount, visibleHeight=20)
      expect(cursor).toBeGreaterThanOrEqual(0)
      expect(cursor).toBeLessThan(Math.max(1, itemCount))
      expect(scrollOffset).toBeGreaterThanOrEqual(0)
    }
  ))
})
```

### Example: property test for PR row rendering

```js
it('PRRow never crashes on any combination of null/undefined fields', () => {
  fc.assert(fc.property(
    fc.record({
      number:    fc.oneof(fc.integer(), fc.constant(null)),
      title:     fc.oneof(fc.string(), fc.constant(null), fc.constant(undefined)),
      state:     fc.constantFrom('OPEN', 'MERGED', 'CLOSED', null, undefined, 'INVALID'),
      isDraft:   fc.oneof(fc.boolean(), fc.constant(null)),
      author:    fc.oneof(fc.record({ login: fc.string() }), fc.constant(null)),
      updatedAt: fc.oneof(fc.date().map(d => d.toISOString()), fc.constant(null)),
      statusCheckRollup: fc.oneof(fc.array(fc.record({ conclusion: fc.string() })), fc.constant(null)),
    }),
    (pr) => {
      expect(() => render(<PRRow pr={pr} isSelected={false} t={mockTheme} />)).not.toThrow()
    }
  ))
})
```

### Example: property test for escape invariant

```js
it('Esc from any view always navigates back without crash', () => {
  fc.assert(fc.property(
    fc.array(fc.constantFrom('Enter', 'd', 'm', 'l', 'A', 'v', '/'), { maxLength: 10 }),
    (actions) => {
      const app = renderApp()
      actions.forEach(key => app.press(key))
      // Now press Esc repeatedly — should always resolve to list view
      for (let i = 0; i < 15; i++) app.press('Escape')
      expect(app.currentView()).toMatch(/list|root/)
      expect(app.hasDialog()).toBe(false)
    }
  ))
})
```

---

## Layer 4 — AI-generated scenario matrix

**What:** Use an LLM to generate test cases from a description of the app's views, state, and known bugs. The model generates scenarios humans wouldn't think to write — especially combinations and boundary conditions.

**When to run:** On-demand (not every CI run). Re-run when adding a major new feature or after a bug batch.

### How it works

1. Feed the model: list of all views, all key handlers per view, all known state variables, and the list of known bugs from the issue tracker
2. Ask it to generate a scenario matrix: `[view] × [state] × [action] → [expected outcome]`
3. Output: a vitest test file with all scenarios as `it()` blocks, each with a comment explaining the edge case
4. Review generated tests, discard ones that are trivially covered, add the rest

### Prompt template

```
You are writing tests for lazyhub, a terminal GitHub TUI built with React/Ink.

VIEWS AND THEIR STATE:
- PR list: { items: PR[], loading, error, cursor, filterState: open|closed|merged, dialog: null|merge|fuzzy|labels|... }
- PR detail: { pr: PR|null, loading, error, scrollY, dialog: null|merge|labels|assignees, searching }
- Diff view: { diff: string|null, loading, files: [], cursor, scrollY, dialog: null|aiReview|comment }
[... full state description ...]

KNOWN BUGS (these were real bugs, generate tests that would catch similar ones):
- Detail view box was missing height={rows}, content didn't fill terminal (issue #43)
- Auto-merge error was silently swallowed, no user feedback (issue #44)
- Footer hint for M key disappeared when user scrolled (issue #45)
- ANSI codes showed as raw characters in log viewer (issue #48)

INVARIANTS THAT MUST HOLD:
[... list from Layer 3 ...]

Generate 40 vitest test cases covering state combinations, boundary conditions, and edge cases
that would NOT be written by a developer writing happy-path tests. Format as:

describe('<component>', () => {
  it('<specific edge case description>', async () => {
    // setup
    // action
    // assertion
  })
})

Focus on: null/undefined field handling, narrow terminal sizes, empty states during loading transitions,
dialog state leaks, key conflicts between modes, scroll position boundary conditions.
```

### Running the generator

```js
// scripts/generate-tests.mjs
// Run: node scripts/generate-tests.mjs > src/__generated__/ai-scenarios.test.js
// Review output before committing — delete any test that is trivially covered elsewhere

import Anthropic from '@anthropic-ai/sdk'
// ... sends the prompt above, writes output to test file
```

Generated tests go in `src/__generated__/` and are committed. Re-generate when adding features.

---

## Fixture library

All tests share a central fixture file so edge cases are defined once and reused across all layers.

**`src/__fixtures__/github.js`**

```js
// PR states
export const PR_OPEN_CLEAN       = { number: 1, title: 'feat: add thing', state: 'OPEN',   isDraft: false, mergeStateStatus: 'CLEAN',      mergeable: 'MERGEABLE',   checks: CHECKS_ALL_PASS, ... }
export const PR_OPEN_DRAFT       = { number: 2, title: 'wip: half done',  state: 'OPEN',   isDraft: true,  mergeStateStatus: 'DRAFT',       mergeable: 'MERGEABLE',   checks: [], ... }
export const PR_OPEN_BLOCKED     = { number: 3, title: 'fix: thing',      state: 'OPEN',   isDraft: false, mergeStateStatus: 'BLOCKED',     mergeable: 'MERGEABLE',   checks: CHECKS_FAILING, ... }
export const PR_OPEN_CONFLICTING = { number: 4, title: 'merge conflict',  state: 'OPEN',   isDraft: false, mergeStateStatus: 'CONFLICTING', mergeable: 'CONFLICTING', checks: [], ... }
export const PR_OPEN_BEHIND      = { number: 5, title: 'behind base',     state: 'OPEN',   isDraft: false, mergeStateStatus: 'BEHIND',      mergeable: 'MERGEABLE',   checks: CHECKS_ALL_PASS, ... }
export const PR_MERGED           = { number: 6, title: 'merged pr',       state: 'MERGED', isDraft: false, ... }
export const PR_CLOSED           = { number: 7, title: 'closed pr',       state: 'CLOSED', isDraft: false, ... }

// Null field variants — every optional field absent
export const PR_MINIMAL          = { number: 8, title: null, state: 'OPEN', isDraft: false, author: null, labels: null, checks: null, body: null, updatedAt: null }

// Extreme data
export const PR_TITLE_VERY_LONG  = { ...PR_OPEN_CLEAN, title: 'a'.repeat(300) }
export const PR_MANY_CHECKS      = { ...PR_OPEN_CLEAN, checks: Array.from({ length: 50 }, (_, i) => ({ name: `check-${i}`, conclusion: i % 3 === 0 ? 'failure' : 'success' })) }
export const PR_MANY_FILES_DIFF  = { ...PR_OPEN_CLEAN, changedFiles: 150, additions: 5000, deletions: 3000 }

// Checks
export const CHECKS_ALL_PASS  = [{ name: 'CI / test', conclusion: 'success' }, { name: 'CI / lint', conclusion: 'success' }]
export const CHECKS_FAILING   = [{ name: 'CI / test', conclusion: 'failure' }, { name: 'CI / lint', conclusion: 'success' }]
export const CHECKS_PENDING   = [{ name: 'CI / test', conclusion: null, status: 'in_progress' }]
export const CHECKS_WITH_ANSI = [{ name: '\x1b[32mCI / test\x1b[0m', conclusion: 'success' }]

// Error scenarios
export const ERROR_RATE_LIMIT = new Error('API rate limit exceeded')
export const ERROR_AUTH       = Object.assign(new Error('401 Unauthorized'), { exitCode: 1 })
export const ERROR_NOT_FOUND  = Object.assign(new Error('Resource not found'), { exitCode: 1 })
export const ERROR_NETWORK    = Object.assign(new Error('context deadline exceeded'), { exitCode: 1 })
export const ERROR_PROTECTED  = new Error('Required status check "CI" is expected')

// Terminal sizes
export const TERM_NARROW   = { rows: 24, columns: 60 }  // mobile-ish
export const TERM_STANDARD = { rows: 24, columns: 80 }  // default
export const TERM_MEDIUM   = { rows: 30, columns: 100 } // medium
export const TERM_WIDE     = { rows: 40, columns: 160 } // ultrawide
export const TERM_TINY     = { rows: 10, columns: 40 }  // tiny window
```

---

## Priority order — what to write first

This is the sequence that delivers maximum bug-catching value fastest:

### Week 1 — fix the untested failure paths
These directly correspond to bugs already in the issue tracker:

1. `executor.test.js` — add tests for `enableAutoMerge`, `disableAutoMerge`, `addLabels`, `removeLabels`, `requestReviewers`, `reviewPR` including error cases (issues #44, #45)
2. `detail.test.jsx` — render with `PR_OPEN_CLEAN` and assert status messages appear on merge failure (issue #44)
3. `detail.test.jsx` — render scrolled state, assert M hint still visible (issue #45)
4. `app.test.jsx` — render detail view at all 5 terminal sizes, assert output fills `rows` lines (issue #43)

### Week 2 — component states
5. All list panes: loading / empty / error / populated states across all terminal sizes
6. PR detail: all `mergeStateStatus` and `mergeable` combinations
7. `LogViewer`: ANSI stripping, step headers, empty state (issue #48)
8. Footer: assert max 1 line at 80 cols for every view (issue #46)

### Week 3 — property-based
9. Navigation invariants: cursor bounds, scroll bounds after random key sequences
10. PR row rendering: `fast-check` over all field combinations — never crashes
11. Escape invariant: always recoverable from any state

### Week 4 — AI generation
12. Run AI scenario generator against full state description
13. Review output, commit valid test cases
14. Add to CI as `npm run test:scenarios` (separate from main test suite, slower)

---

## CI integration

```yaml
# .github/workflows/ci.yml additions

- name: Run tests
  run: npm test                    # vitest — layers 1-2, always

- name: Property-based tests
  run: npm run test:property       # fast-check — layer 3, on PR only
  if: github.event_name == 'pull_request'

- name: AI scenario tests
  run: npm run test:scenarios      # layer 4, on PR only
  if: github.event_name == 'pull_request'
```

```json
// package.json additions
"test:property":  "vitest run src/**/*.property.test.*",
"test:scenarios": "vitest run src/__generated__/*.test.*",
"test:all":       "vitest run"
```

---

## What good looks like

A test suite that is actively useful has these properties:

- **Every new bug gets a regression test before the fix is merged.** The test is written first (red), then the fix is written (green). No exceptions. This is how you prevent the height bug (issue #43) from silently returning in 3 months.

- **CI fails when a catch block swallows an error.** The executor tests verify that every error scenario produces a thrown `GhError`. If someone adds `catch {}` to silence a new error, the test catches it.

- **The property tests run in <30s.** If they're slow, they get skipped. `fast-check` defaults to 100 runs per property — tune `numRuns` down if needed, but don't skip the tests.

- **The AI-generated tests are reviewed and owned.** Generated tests that are vague or trivially covered elsewhere get deleted. The ones that stay are specific, named after the exact edge case they cover, and documented with a comment explaining why a human wouldn't have written it.
