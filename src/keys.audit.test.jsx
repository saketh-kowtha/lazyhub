// Keyboard audit: real <App/>, real executor + runGh + useGh, fake `gh` behind a mocked execa.
// Tests named "AUDIT FAIL" are expected to FAIL today (each documents one defect);
// tests named "baseline" pass and prove the opposite (suspected defect disproved).
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sendInput } from './test/input-bus.js'
import { App } from './app.jsx'
import { getGhCallHistory } from './executor.js'
import { renderWithProviders, flush, cleanup, waitForExpectation } from './test/test-helpers.jsx'

const fake = vi.hoisted(() => ({ calls: [], respond: null }))

vi.mock('ink', async () => {
  const React = await import('react')
  const actual = await vi.importActual('ink')
  return { ...actual, useApp: () => ({ exit: () => {} }), useInput: (await import('./test/input-bus.js')).mockUseInput(React) }
})
vi.mock('./hooks/useLayout.js', () => ({
  useLayout: () => ({ cols: 120, rows: 40, sidebarWidth: 18, previewWidth: 40, borderStyle: 'round', compactFooter: false, showSidebar: false, showPreview: false, listHeight: 20, tooSmall: false, minCols: 50, minRows: 15 }),
}))
vi.mock('./ipc.js', () => ({ emitIPC: () => {}, startIPC: () => '/tmp/x.sock' }))
vi.mock('./editor.js', () => ({ openInEditor: vi.fn(async () => {}), editorLabel: 'Editor' }))
// Nothing here may reach the real `gh`, `open`, `xdg-open` or `pbcopy`: every spawn lands in this fake.
vi.mock('execa', () => ({
  execa: (cmd, args = []) => {
    fake.calls.push([cmd, ...args])
    const out = cmd === 'gh' ? fake.respond(args) : ''
    const p = Promise.resolve(out).then(o => (o && o.__fail
      ? { exitCode: 1, stdout: '', stderr: o.__fail }
      : { exitCode: 0, stdout: typeof o === 'string' ? o : JSON.stringify(o), stderr: '' }))
    p.stdin = { write() {}, end() {} }
    return p
  },
}))

const PR = {
  number: 42, title: 'Stabilize parser', body: 'body', state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  baseRefName: 'main', headRefName: 'feature/x', headRefOid: 'a'.repeat(40), url: 'https://example.test/pr/42', files: [{ path: 'a.js' }],
  labels: [{ name: 'bug', color: 'ff0000' }], assignees: [{ login: 'alice' }], reviews: [], reviewRequests: [], statusCheckRollup: [],
  author: { login: 'bob' }, autoMergeRequest: null, updatedAt: '2026-01-01T00:00:00Z', additions: 1, deletions: 1, changedFiles: 1,
}
const ISSUE = { number: 7, title: 'Parser crashes', state: 'OPEN', author: { login: 'bob' }, labels: [], assignees: [], updatedAt: '2026-01-01T00:00:00Z', body: 'b', milestone: null, comments: [], url: 'https://example.test/issues/7' }
const gqlNode = { __typename: 'PullRequest', ...PR, labels: { nodes: PR.labels }, assignees: { nodes: PR.assignees }, reviewRequests: { nodes: [] }, statusCheckRollup: null, reviewDecision: null }
const DIFF = 'diff --git a/a.js b/a.js\n--- a/a.js\n+++ b/a.js\n@@ -1,3 +1,3 @@\n const a = 1\n-const b = 2\n+const b = 3\n const c = 4\n'
const CHECKS = [
  { id: 9001, name: 'CI / test', status: 'completed', conclusion: 'failure', url: 'https://example.test/c/1' },
  { id: 9002, name: 'CI / lint', status: 'completed', conclusion: 'success', url: 'https://example.test/c/2' },
]
const delay = (ms, v) => new Promise(r => setTimeout(() => r(v), ms))

let overrides = {}
function gh(args) {
  const a = args.join(' ')
  for (const [re, v] of Object.entries(overrides)) if (new RegExp(re).test(a)) return typeof v === 'function' ? v() : v
  if (args[0] === 'api' && args[1] === 'graphql') return a.includes('is:pr') ? { data: { search: { pageInfo: { hasNextPage: false }, nodes: [gqlNode] } } } : { data: {} }
  if (a.startsWith('pr view') && a.includes('headRefOid') && !a.includes('number,title')) return { headRefOid: PR.headRefOid }
  if (a.startsWith('pr view')) return PR
  if (a.startsWith('pr diff')) return DIFF
  if (/check-runs/.test(a)) return CHECKS
  if (a.startsWith('label list')) return [{ name: 'bug', color: 'ff0000' }, { name: 'docs', color: '00ff00' }]
  if (/collaborators/.test(a)) return [{ login: 'alice' }, { login: 'carol' }]
  if (a.startsWith('issue list')) return [ISSUE]
  if (a.startsWith('issue view')) return ISSUE
  if (a.startsWith('run list')) return [{ databaseId: 5, name: 'CI', status: 'completed', conclusion: 'failure', workflowName: 'CI', headBranch: 'main', event: 'push', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', url: 'https://example.test/run/5' }]
  if (/\/branches\?/.test(a)) return [{ name: 'main', protected: true, commit: { sha: 'abc' } }, { name: 'feature/x', protected: false, commit: { sha: 'def' } }]
  if (a.startsWith('api notifications')) return [{ id: '1', unread: true, reason: 'mention', subject: { title: 'Ping', type: 'Issue', url: 'https://api.github.com/repos/o/r/issues/7' }, repository: { fullName: 'o/r', name: 'r' }, updatedAt: '2026-01-01T00:00:00Z' }]
  if (a.startsWith('repo view')) return { name: 'r', owner: { login: 'o' }, defaultBranchRef: { name: 'main' }, squashMergeAllowed: true, viewerPermission: 'ADMIN' }
  return []
}

const ghCalls = () => fake.calls.filter(c => c[0] === 'gh').map(c => c.slice(1).join(' '))
const frame = (v) => v.lastFrame()
const K = {
  tab: ['', { tab: true }], enter: ['', { return: true }], esc: ['', { escape: true }], down: ['', { downArrow: true }],
  ctrl: (c) => [c, { ctrl: true }],
}
const press = async (...keys) => {
  for (const k of keys) {
    if (typeof k === 'string') await sendInput(k)
    else await sendInput(...k)
  }
}

// A fresh repo name per test keeps useGh's in-memory/disk caches from serving a previous test's data.
let repoSeq = 0
async function boot() {
  repoSeq += 1
  const view = renderWithProviders(<App repo={`o/r${repoSeq}`} />)
  await flush(30)
  return view
}
async function openPrList() {
  const view = await boot()
  await press('g', 'p')
  await waitForExpectation(() => expect(frame(view)).toContain('Stabilize parser'))
  return view
}
async function openPrDetail() {
  const view = await openPrList()
  await press(K.enter)
  await waitForExpectation(() => expect(frame(view)).toContain('Description'))
  await flush(60)
  return view
}
// The status bar names the active pane: "<icon> Pull Requests · o/r".
const statusPane = (v) => {
  // Status bar row: " <icon>  <Pane label>  ..." (the repo is replaced by a health banner after gh failures).
  const m = frame(v).match(/^ \S\s{2}(Pull Requests|Issues|Branches|Actions|Notifications|Focus|focus)(?=\s{2})/m)
  if (!m && process.env.AUDIT_DEBUG) console.log(frame(v))
  return m && m[1]
}

beforeEach(() => { fake.calls.length = 0; fake.respond = gh; overrides = {} })
afterEach(() => { cleanup() })

// ───────────────────────────── (a) PR label / assignee keys ─────────────────────────────
describe('(a) PR label / assignee / reviewer keys', () => {
  it('baseline: l from PR detail loads labels, applies a diff via gh pr edit and refetches the PR', async () => {
    const view = await openPrDetail()
    await press('l')
    await waitForExpectation(() => expect(frame(view)).toContain('docs'))
    await press(K.down, ' ', K.enter)
    await waitForExpectation(() => expect(ghCalls().some(c => /pr edit 42 .*--add-label docs/.test(c))).toBe(true))
    const editIdx = ghCalls().findIndex(c => /pr edit 42/.test(c))
    await waitForExpectation(() => expect(ghCalls().slice(editIdx + 1).some(c => c.startsWith('pr view 42'))).toBe(true))
    expect(getGhCallHistory().some(h => h.args.join(' ').includes('--add-label'))).toBe(true)
  })

  it('baseline: A from PR detail loads collaborators and sends --add-assignee, then refetches', async () => {
    const view = await openPrDetail()
    await press('A')
    await waitForExpectation(() => expect(frame(view)).toContain('carol'))
    await press(K.down, ' ', K.enter)
    await waitForExpectation(() => expect(ghCalls().some(c => /pr edit 42 .*--add-assignee carol/.test(c))).toBe(true))
  })

  it('baseline: l and A from the PR list open the same pickers', async () => {
    const view = await openPrList()
    await press('l')
    await waitForExpectation(() => expect(frame(view)).toContain('docs'))
    await press(K.esc)
    await waitForExpectation(() => expect(frame(view)).toContain('Stabilize parser'))
    await press('A')
    await waitForExpectation(() => expect(frame(view)).toContain('carol'))
  })

  it('AUDIT FAIL: A with a failing collaborators call must tell the user why, not show an empty picker', async () => {
    overrides['collaborators'] = { __fail: 'HTTP 403: Must have push access to view repository collaborators' }
    const view = await openPrDetail()
    await press('A')
    await waitForExpectation(() => expect(ghCalls().some(c => /collaborators/.test(c))).toBe(true))
    await flush(150)
    const body = frame(view).split('\n').slice(0, -3).join('\n') // everything above status bar + footer
    expect(body).toMatch(/403|push access|failed|error|couldn't|could not/i)
  })

  it('AUDIT FAIL: l with a failing label list must tell the user why, not show an empty picker', async () => {
    overrides['^label list'] = { __fail: 'HTTP 404: Not Found' }
    const view = await openPrDetail()
    await press('l')
    await waitForExpectation(() => expect(ghCalls().some(c => c.startsWith('label list'))).toBe(true))
    await flush(150)
    const body = frame(view).split('\n').slice(0, -3).join('\n')
    expect(body).toMatch(/404|not found|failed|error|couldn't|could not/i)
  })

  it('AUDIT FAIL: Esc while the collaborators are still loading must close the picker', async () => {
    overrides['collaborators'] = () => delay(700, [{ login: 'alice' }])
    const view = await openPrDetail()
    await press('A')
    await waitForExpectation(() => expect(frame(view)).toContain('Loading collaborators'))
    await press(K.esc)
    await flush(50)
    expect(frame(view)).not.toContain('Loading collaborators')
  })

  it('AUDIT FAIL: R then Esc while reviewers load must not leave app-level keys dead (Tab/digits blocked by dialogActiveRef)', async () => {
    overrides['collaborators'] = () => delay(700, [{ login: 'alice' }])
    const view = await openPrDetail()
    await press('R')
    await waitForExpectation(() => expect(frame(view)).toContain('Loading collaborators'))
    await press(K.esc, 'q')
    await flush(50)
    expect(frame(view)).not.toContain('Loading collaborators')
  })

  it('baseline: l, A work in a PR detail that was opened from the Focus dashboard', async () => {
    const view = await boot()
    await waitForExpectation(() => expect(frame(view)).toContain('Stabilize parser'))
    await press(K.enter)
    await waitForExpectation(() => expect(frame(view)).toContain('Description'))
    await flush(60)
    await press('l')
    await waitForExpectation(() => expect(frame(view)).toContain('docs'))
  })
})

// ───────────────────────────── (b) digit pane-jump scoping ─────────────────────────────
describe('(b) 1-9 pane jump must not fire while text entry / dialogs own the keyboard', () => {
  const scenarios = [
    ['PR list: / search', ['g', 'p'], ['/'], 'Pull Requests'],
    ['PR list: @ author', ['g', 'p'], ['@'], 'Pull Requests'],
    ['PR list: n new PR form', ['g', 'p'], ['n'], 'Pull Requests'],
    ['PR list: a approve body', ['g', 'p'], ['a'], 'Pull Requests'],
    ['PR list: l label picker', ['g', 'p'], ['l'], 'Pull Requests'],
    ['PR detail: / search', ['g', 'p', K.enter], ['/'], 'Pull Requests'],
    ['PR detail: B base branch', ['g', 'p', K.enter], ['B'], 'Pull Requests'],
    ['PR detail: a approve body', ['g', 'p', K.enter], ['a'], 'Pull Requests'],
    ['PR detail: m merge picker', ['g', 'p', K.enter], ['m'], 'Pull Requests'],
    ['Issues list: / search', ['g', 'i'], ['/'], 'Issues'],
    ['Issues list: n new', ['g', 'i'], ['n'], 'Issues'],
    ['Issue detail: c reply', ['g', 'i', K.enter], ['c'], 'Issues'],
    ['Branches: n new', ['g', 'b'], ['n'], 'Branches'],
    ['Branches: / search', ['g', 'b'], ['/'], 'Branches'],
    ['Notifications: / search', ['g', 'n'], ['/'], 'Notifications'],
    ['Command palette', [], [':'], null],
  ]
  for (const [name, nav, open, pane] of scenarios) {
    it(`${name}: typing 1 does not jump to Focus`, async () => {
      const view = await boot()
      await press(...nav)
      await flush(150)
      const before = statusPane(view)
      const framePre = frame(view)
      await press(...open)
      await flush(80)
      if (name !== 'Command palette') expect(frame(view), 'text-entry mode did not open').not.toBe(framePre)
      await press('1')
      await flush(80)
      const after = statusPane(view)
      expect(after, `pane before=${before}`).toBe(pane === null ? before : pane)
    })
  }

  it('baseline: 1 from PR detail jumps to Focus (documented, intended by #398)', async () => {
    const view = await openPrDetail()
    await press('1')
    await flush(80)
    expect(statusPane(view)).toMatch(/focus|Focus/i)
  })

  it('AUDIT FAIL: help lists "1-9 jump to pane" under "Global (any view)" in the diff view, but digits do nothing there', async () => {
    const view = await openPrDetail()
    await press('d')
    await waitForExpectation(() => expect(frame(view)).toContain('const b = 3'))
    await press('?')
    await waitForExpectation(() => expect(frame(view)).toContain('Keyboard Reference'))
    const advertised = /1-9\s+jump to pane/.test(frame(view)) && /Global \(any view\)/.test(frame(view))
    await press('?')
    await flush(30)
    await press('2')
    await flush(80)
    const jumped = !/PR #42 Diff/.test(frame(view))
    expect({ advertised, jumped }).toEqual({ advertised: true, jumped: true })
  })

  it('AUDIT FAIL: help lists "Tab pane" as global, but Tab does nothing in PR detail while 1-9 does work there (inconsistent)', async () => {
    const view = await openPrDetail()
    await press(K.tab)
    await flush(80)
    const tabMoved = !/Description/.test(frame(view))
    await press('1')
    await flush(80)
    const digitMoved = !/Description/.test(frame(view))
    expect({ tabMoved, digitMoved }).toEqual({ tabMoved: true, digitMoved: true })
  })

  it('AUDIT FAIL: <Space> leader chord followed by a digit must not jump panes while the leader hint is shown', async () => {
    const view = await openPrList()
    await press(' ')
    await waitForExpectation(() => expect(frame(view)).toContain('recent'))
    await press('1')
    await flush(60)
    expect(statusPane(view)).toBe('Pull Requests')
  })
})

// ───────────────────────────── dead keys / false hints ─────────────────────────────
describe('declared-but-dead keys', () => {
  it('AUDIT FAIL: checks mode advertises [R] rerun (hint line + Checks.jsx) but R does nothing (registry key is Ctrl+R)', async () => {
    const view = await openPrDetail()
    await press('c')
    await waitForExpectation(() => expect(frame(view)).toContain('[R] rerun'))
    await press('R')
    await flush(80)
    expect(frame(view)).toMatch(/Re-run check/)
  })

  it('AUDIT FAIL: checks mode advertises [l] annotations but l does nothing', async () => {
    const view = await openPrDetail()
    await press('c')
    await waitForExpectation(() => expect(frame(view)).toContain('[l] annotations'))
    fake.calls.length = 0
    await press('l')
    await flush(80)
    expect(ghCalls().some(c => /check-runs\/\d+\/annotations/.test(c))).toBe(true)
  })

  it('AUDIT FAIL: diff view `g l` (go to line, in registry + which-key popup) does nothing', async () => {
    const view = await openPrDetail()
    await press('d')
    await waitForExpectation(() => expect(frame(view)).toContain('const b = 3'))
    await press('g')
    await flush(30)
    await press('l')
    await flush(80)
    expect(frame(view)).toMatch(/go to line/i)
  })

  it('AUDIT FAIL: PR list popover says "[p] close" but only Esc closes it', async () => {
    const view = await openPrList()
    await waitForExpectation(() => expect(frame(view)).toContain('[p] close'))
    await press('p')
    await flush(80)
    expect(frame(view)).not.toContain('[p] close')
  })

  it('AUDIT FAIL: Actions pane lists `/ search` in help but / does nothing', async () => {
    const view = await boot()
    await press('g', 'a')
    await waitForExpectation(() => expect(frame(view)).toContain('CI'))
    await flush(60)
    await press('?')
    await waitForExpectation(() => expect(frame(view)).toContain('Keyboard Reference'))
    expect(frame(view)).toMatch(/\/\s+.*[Ss]earch/) // help advertises it
    await press('?')
    await flush(40)
    const before = frame(view).replace(/just now|\d+[smh] ago/g, '')
    await press('/')
    await flush(100)
    expect(frame(view).replace(/just now|\d+[smh] ago/g, '')).not.toBe(before)
  })

  it('AUDIT FAIL: PR list shows [M]merged in its hint, but M on an open PR opens the auto-merge dialog', async () => {
    const view = await openPrList()
    await waitForExpectation(() => expect(frame(view)).toMatch(/\[M\]merged/))
    await press('M')
    await flush(80)
    expect(frame(view)).not.toMatch(/auto-merge/i)
  })

  it('AUDIT FAIL: pickers advertise [Ctrl+g/G] top/bottom but the bindings are Ctrl+T / Ctrl+B (Ctrl+G does nothing)', async () => {
    const view = await openPrDetail()
    await press('l')
    await waitForExpectation(() => expect(frame(view)).toContain('Ctrl+g/G'))
    await press(K.down)
    await flush(30)
    expect(frame(view)).toContain('2/2')
    await press(K.ctrl('g'))
    await flush(50)
    expect(frame(view)).toContain('1/2')
  })

  it('AUDIT FAIL: leader hint shows `r recent` but <Space> r does nothing (handler is a stub: "recent PRs — future")', async () => {
    const view = await openPrList()
    await press(' ')
    await waitForExpectation(() => expect(frame(view)).toContain('recent'))
    fake.calls.length = 0
    await press('r')
    await flush(100)
    expect(frame(view)).toMatch(/recent/i) // some "recent" UI must appear
  })
})
