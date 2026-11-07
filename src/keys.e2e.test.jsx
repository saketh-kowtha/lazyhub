// Advertised keys must work (#511): real <App/>, real executor + runGh + useGh, fake `gh` behind a mocked execa.
// Each test presses the key a hint, help row or chord names and asserts it does what it says.
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
  const view = renderWithProviders(<App repo={`o/keys${repoSeq}`} />)
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

beforeEach(() => { fake.calls.length = 0; fake.respond = gh; overrides = {} })
afterEach(() => { cleanup() })

describe('advertised keys work (#511)', () => {
  it('checks mode hints name the real keys, and Ctrl+R / Enter do what the hint says', async () => {
    const view = await openPrDetail()
    await press('c')
    await waitForExpectation(() => expect(frame(view)).toContain('[Ctrl+R] re-run'))
    expect(frame(view)).not.toContain('[R] rerun')
    expect(frame(view)).not.toContain('[l] annotations')
    await press(K.ctrl('r'))
    await waitForExpectation(() => expect(frame(view)).toMatch(/Re-run check/))
    await press(K.esc)
    await flush(30)
    fake.calls.length = 0
    await press(K.enter)
    await waitForExpectation(() => expect(ghCalls().some(c => /check-runs\/\d+\/annotations/.test(c))).toBe(true))
  })

  it('diff view: g l (go to line) opens the go-to-line prompt', async () => {
    const view = await openPrDetail()
    await press('d')
    await waitForExpectation(() => expect(frame(view)).toContain('const b = 3'))
    await press('g')
    await flush(30)
    await press('l')
    await waitForExpectation(() => expect(frame(view)).toMatch(/go to line/i))
  })

  it('Actions pane: / opens search', async () => {
    const view = await boot()
    await press('g', 'a')
    await waitForExpectation(() => expect(frame(view)).toContain('CI'))
    await flush(60)
    await press('/')
    await waitForExpectation(() => expect(frame(view)).toMatch(/\[Enter\] select/))
    await press(K.esc)
    await flush(40)
    expect(frame(view)).not.toMatch(/\[Enter\] select/)
  })

  it('picker footers name Ctrl+T / Ctrl+B and those keys jump', async () => {
    const view = await openPrDetail()
    await press('l')
    await waitForExpectation(() => expect(frame(view)).toContain('[Ctrl+T] top'))
    expect(frame(view)).not.toContain('Ctrl+g/G')
    await press(K.down)
    await flush(30)
    expect(frame(view)).toContain('2/2')
    await press(K.ctrl('t'))
    await flush(50)
    expect(frame(view)).toContain('1/2')
    await press(K.ctrl('b'))
    await flush(50)
    expect(frame(view)).toContain('2/2')
  })

  it('leader hint lists only chords that work (no "recent")', async () => {
    const view = await openPrList()
    await press(' ')
    await waitForExpectation(() => expect(frame(view)).toContain('[t] theme'))
    expect(frame(view)).not.toContain('recent')
  })

  it('help: the "Global (any view)" block lists only keys that work in every view', async () => {
    const view = await openPrDetail()
    await press('d')
    await waitForExpectation(() => expect(frame(view)).toContain('const b = 3'))
    await press('?')
    await waitForExpectation(() => expect(frame(view)).toContain('Keyboard Reference'))
    const text = frame(view)
    expect(text).toContain('Global (any view)')
    expect(text).not.toMatch(/1-9\s+jump to pane/)
    expect(text).not.toMatch(/Tab\s+pane/)
  })
})
