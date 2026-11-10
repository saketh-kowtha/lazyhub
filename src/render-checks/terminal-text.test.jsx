/**
 * Rendering check for GitHub-provided text: every string field of the fixtures below
 * gets a suffix full of control and invisible characters, each view is rendered, and
 * the frame must contain none of them. When a view is added, add it here.
 *
 * Fixture strings are built from escapes in source. Failures print code points only.
 */
import React from 'react'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEffect } from 'react'
import { useGh } from '../hooks/useGh.js'
import {
  getPR, getRepoInfo, getPRChecks, getBranchProtection, getPRDiffStats, listPRFilesPage, getPRFilePatch, listPRCommentsPage,
  getIssueHeader, loadEvidenceDetail, listIssueTimelinePage, listIssuesPage, listLabels, listCollaborators, listBranches, listOpenPRBranches, listRuns, listNotifications,
} from '../executor.js'
import { cleanup, flush, renderWithProviders, waitForExpectation } from '../test/test-helpers.jsx'
import { sendInput } from '../test/input-bus.js'
import { diffFilesPage, fakeFilePatch } from '../test/diff-fixtures.js'
import { PRDetail } from '../features/prs/detail.jsx'
import { PRRow, PRDetailPopoverContentMemo } from '../features/prs/list-row.jsx'
import { IssueList } from '../features/issues/list.jsx'
import { IssueDetail } from '../features/issues/detail.jsx'
import { BranchList } from '../features/branches/index.jsx'
import { ActionList } from '../features/actions/index.jsx'
import { NotificationList } from '../features/notifications/index.jsx'
import { LogViewer } from '../components/dialogs/LogViewer.jsx'
import { CollisionRadar } from '../features/prs/collisions/view.jsx'
import { EvidenceView } from '../features/prs/EvidenceView.jsx'
import { parsePatchChanges } from '../features/prs/collisions/engine.js'
import { PRComments } from '../features/prs/comments.jsx'
import { ConflictView } from '../features/prs/ConflictView.jsx'
import { AIReviewPane } from '../components/AIReviewPane.jsx'
import { CommentThread } from '../components/CommentThread.jsx'
import { useDiffState } from '../features/prs/diff/state.js'
import { DiffView } from '../features/prs/diff/render.jsx'
import { toLogLines, logTitle } from '../features/actions/log-lines.js'
import { annotationLines } from '../features/prs/ci-log.js'
import { whyRedRows } from '../features/prs/why-red-rows.js'
import { resolveTheme, useTheme } from '../theme.js'

vi.mock('ink', async () => ({
  ...await vi.importActual('ink'),
  useInput: (await import('../test/input-bus.js')).mockUseInput(await import('react')),
}))
vi.mock('../hooks/useGh.js', () => ({ useGh: vi.fn() }))
vi.mock('execa', () => ({ execa: vi.fn(async (_cmd, args) => ({ stdout: args?.[0] === 'remote' ? 'origin\tgit@github.com:o/r.git (fetch)' : 'main' })) }))
vi.mock('../services/git.js', async () => ({
  ...await vi.importActual('../services/git.js'),
  findLocalCheckout: vi.fn(async () => ({ dir: '/w', remote: 'origin' })),
  currentBranch: vi.fn(async () => 'feature'),
  isInMerge: vi.fn(async () => true),
  conflictedFiles: vi.fn(async () => []),
  countConflictMarkers: vi.fn(async () => 1),
  mergeMessage: vi.fn(async () => 'Merge branch main'),
}))
vi.mock('../editor.js', () => ({ openInEditor: vi.fn(), editorLabel: () => 'editor' }))
vi.mock('../services/platform.js', () => ({ openUrl: vi.fn(), copyToClipboard: vi.fn() }))

// ── canary ───────────────────────────────────────────────────────────────────
const ESC = '\x1b'
const BEL = '\x07'
const CANARY = [
  'CANARY',
  `${ESC}]0;title${BEL}`,
  `${ESC}]8;;https://example.invalid${BEL}link${ESC}]8;;${BEL}`,
  `${ESC}Pbody${ESC}\\`,
  `${ESC}_body${ESC}\\`,
  '\x9b31m', '\x9d0;t\x9c',
  `${BEL}\x08\x7f\x00`,
  String.fromCharCode(0x202e, 0x2066, 0x200b, 0x200f, 0x061c, 0xfeff),
  '&#27;[31m', '&#99999999999;', '&#55357;', '&#155;',
  String.fromCharCode(0xd800),
  '\r', 'END',
].join('')

const SKIP_KEYS = new Set(['state', 'status', 'conclusion', 'mergeable', 'mergeStateStatus', 'type', 'level', 'severity', 'color', 'id', 'oid', 'headRefOid', 'sha', 'url', 'reason'])
/**
 * Append the canary to every string leaf except enum-like keys and dates.
 * @param {any} value
 * @param {string} [key]
 * @returns {any}
 */
function poison(value, key = '') {
  if (typeof value === 'string') return SKIP_KEYS.has(key) || /At$/.test(key) ? value : value + CANARY
  if (Array.isArray(value)) return value.map(v => poison(v, key))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, poison(v, k)]))
  return value
}

const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g')
const BAD = new RegExp('[\\x00-\\x09\\x0b-\\x1f\\x7f-\\x9f\\u200e\\u200f\\u061c\\u2028-\\u202e\\u2066-\\u2069\\ufeff]', 'gu')
/**
 * Everything in a frame that should never be there, as code points.
 * @param {string} frame
 * @returns {string[]}
 */
function violations(frame) {
  const text = frame.replace(SGR, '').replace(/([\u231a-\u2b55])\u200b/g, '$1')
  const found = [...text.matchAll(BAD)].map(m => `U+${m[0].codePointAt(0).toString(16).padStart(4, '0')}`)
  if (text.includes('\u200b')) found.push('U+200b')
  if (!text.isWellFormed()) found.push('lone-surrogate')
  return [...new Set(found)]
}
/** @param {string} frame */
function expectClean(frame) {
  expect(JSON.stringify(violations(frame))).toBe('[]')
}
/** @param {{lastFrame: () => string|undefined}} view */
function frameOf(view) { return view.lastFrame() ?? '' }
const result = (data) => ({ data, loading: false, error: null, refetch: vi.fn(), mutate: vi.fn() })

beforeEach(() => { vi.clearAllMocks() })
afterEach(cleanup)


// ── one shared cleanup helper ────────────────────────────────────────────────

/** Files that match control characters for a reason other than cleaning GitHub-provided text. */
const OTHER_PURPOSE = {
  'src/app.jsx': 'parses mouse reports from the terminal',
  'src/theme/terminal.js': 'rewrites the colour codes of text lazyhub drew itself',
  'src/executor/prs.js': 'rejects control characters in a typed search query',
  'src/approval/canonical.js': 'rejects ref names with control characters',
  'src/input-validation.js': 'rejects control characters in typed references',
}
const CONTROL_PATTERN = new RegExp(['\\\\x1b', '\\\\u001b', '\\\\x9b', '\\\\u009b', '\\[\\\\u0000-', '\\[\\\\x00-', '\\\\x00-'].join('|'))
const REGEX_CONTEXT = /\.replace\(|\.test\(|\.match\(|RegExp|= \/|\(\//

/**
 * @param {string} dir
 * @param {string[]} out
 * @returns {string[]}
 */
function sourceFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name !== 'test') sourceFiles(full, out)
    } else if (/\.(js|jsx)$/.test(name) && !/\.(test|fixtures)\./.test(name)) out.push(full)
  }
  return out
}

describe('one shared cleanup helper', () => {
  it('no other source file keeps its own control-character cleanup', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const offenders = []
    const seen = new Set()
    for (const file of sourceFiles(root)) {
      const rel = `src/${file.slice(root.length)}`
      if (rel === 'src/utils-core.js') continue // the shared helper itself
      const lines = readFileSync(file, 'utf8').split('\n')
      lines.forEach((line, i) => {
        if (!CONTROL_PATTERN.test(line) || !REGEX_CONTEXT.test(line)) return
        if (rel in OTHER_PURPOSE) seen.add(rel)
        else offenders.push(`${rel}:${i + 1}`)
      })
    }
    expect(JSON.stringify(offenders)).toBe('[]')
    // The list above is kept honest: every entry must still match (and it proves the scan works).
    expect(JSON.stringify([...seen].sort())).toBe(JSON.stringify(Object.keys(OTHER_PURPOSE).sort()))
  })
})

describe('comments and conflict views', () => {
  it('review comments and conversation', async () => {
    const data = poison({
      threads: { total: 1, hasNextPage: false },
      conversationPage: { total: 1, hasNextPage: false },
      conversation: [{ id: 'conv-1', kind: 'conversation', body: 'conversation body', user: { login: 'convuser' }, createdAt: '2026-01-01T00:00:00Z' }],
      comments: [{ id: 'comment-1', body: 'review body\nsecond line', path: 'src/a.js', line: 4, user: { login: 'reviewer' }, createdAt: '2026-01-01T00:00:00Z' }],
    })
    useGh.mockImplementation(() => result(data))
    const view = renderWithProviders(<PRComments prNumber={42} repo="o/r" onBack={() => {}} />)
    await waitForExpectation(() => expect(frameOf(view)).toContain('CANARY'))
    expectClean(frameOf(view))
  })

  it('conflict resolution', async () => {
    const git = await import('../services/git.js')
    git.conflictedFiles.mockResolvedValue([{ path: `src/conflict${CANARY.replace(/[\r]/g, '')}.js` }])
    const pr = poison({ number: 5, title: 'Conflicted', headRefName: 'feature', baseRefName: 'main', url: 'https://example.invalid/pr/5' })
    const view = renderWithProviders(<ConflictView pr={pr} repo="o/r" onBack={() => {}} onResolved={() => {}} />)
    await waitForExpectation(() => expect(frameOf(view)).toContain('CANARY'))
    expectClean(frameOf(view))
  })
})

describe('the checker itself', () => {
  it('flags the canary and accepts clean text', () => {
    expect(violations(`plain ${CANARY}`).length).toBeGreaterThan(5)
    expect(violations('plain \u2705\u200b text \u{1F600}')).toEqual([])
  })
})

// ── fixtures ─────────────────────────────────────────────────────────────────
const PR = poison({
  number: 42, title: 'Stabilize parser', body: '# Heading\n\nparagraph text\n\n- item one\n\n```js\nconst code = 1\n```\n\n`inline` **bold**',
  state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
  baseRefName: 'main', headRefName: 'feat/thing', headRefOid: 'a'.repeat(40), files: [],
  labels: [{ name: 'bug', color: 'ff0000' }], assignees: [{ login: 'alice' }],
  reviews: [{ author: { login: 'bob' }, state: 'APPROVED' }], reviewRequests: [{ login: 'carol' }],
  author: { login: 'dave' }, autoMergeRequest: { mergeMethod: 'SQUASH' }, url: 'https://example.invalid/pr/42',
  updatedAt: '2026-06-06T10:00:00Z', createdAt: '2026-06-06T10:00:00Z', additions: 3, deletions: 1, changedFiles: 2,
  statusCheckRollup: [{ name: 'build', conclusion: 'FAILURE', status: 'COMPLETED' }],
})
const CHECKS = poison([{ name: 'build', conclusion: 'FAILURE', status: 'COMPLETED', appName: 'app', id: 1 }])
const PROTECTION = poison({ requiredReviews: 1, requireCodeOwnerReviews: true, requireStatusChecks: true, requiredChecks: ['ci'] })

describe('PR views', () => {
  it('list row and popover', () => {
    const t = resolveTheme('github-dark')
    const row = renderWithProviders(<PRRow pr={PR} isSelected={true} t={t} titleWidth={60} expanded={true} />)
    expect(frameOf(row)).toContain('CANARY')
    expectClean(frameOf(row))
    const pop = renderWithProviders(<PRDetailPopoverContentMemo pr={PR} t={t} width={70} />)
    expectClean(frameOf(pop))
  })

  it('detail', async () => {
    useGh.mockImplementation((fn) => {
      if (fn === getPR) return result(PR)
      if (fn === getRepoInfo) return result({ viewerPermission: 'WRITE' })
      if (fn === getPRChecks) return result(CHECKS)
      if (fn === getBranchProtection) return result(PROTECTION)
      return result(null)
    })
    const view = renderWithProviders(<PRDetail prNumber={42} repo="o/r" onBack={() => {}} />)
    await waitForExpectation(() => expect(frameOf(view)).toContain('CANARY'))
    expectClean(frameOf(view))
    await flush(30)
    await sendInput('G')
    await flush(30)
    expect(frameOf(view)).toContain('inline')
    expectClean(frameOf(view))
  })

  it('discussion thread', () => {
    const comments = poison([
      { id: 1, user: { login: 'erin' }, body: 'first line\nsecond line', createdAt: '2026-06-06T10:00:00Z' },
      { id: 2, inReplyToId: 1, user: { login: 'frank' }, body: 'reply\nlines', createdAt: '2026-06-06T11:00:00Z' },
    ])
    function Host() { const { t } = useTheme(); return <CommentThread comments={comments} t={t} /> }
    const view = renderWithProviders(<Host />)
    expect(frameOf(view)).toContain('CANARY')
    expectClean(frameOf(view))
  })
})

describe('diff view', () => {
  const NAME = `src/file${CANARY.replace(/[\r]/g, '')}.js`
  const DIFF = [
    `diff --git a/${NAME} b/${NAME}`,
    `@@ -1,3 +1,3 @@ ctx${CANARY}`,
    ` context${CANARY}`,
    `-old${CANARY}`,
    `+new${CANARY}`,
    '+tab\there',
  ].join('\n')

  let state
  function Session(props) {
    const s = useDiffState(props)
    useEffect(() => { state = s })
    return <DiffView prNumber={props.prNumber} state={s} />
  }

  it('renders rows, file header and tree', async () => {
    const executor = await import('../executor.js')
    executor.getPRFilePatch.mockImplementation(fakeFilePatch(DIFF))
    useGh.mockImplementation(fn => ({
      data: fn.name === 'listPRDiffFiles' ? diffFilesPage(DIFF)
        : fn === getPR ? { title: `Title${CANARY}`, state: 'OPEN', headRefOid: 'a'.repeat(40) }
        : fn === getRepoInfo ? { viewerPermission: 'ADMIN' }
        : fn === getPRDiffStats ? { additions: 2, deletions: 1, changedFiles: 1 }
        : fn === listPRCommentsPage ? { comments: [], truncated: false } : null,
      loading: false, error: null, refetch: vi.fn(), mutate: vi.fn(),
    }))
    const view = renderWithProviders(<Session repo="o/r" prNumber={42} onBack={() => {}} onViewComments={() => {}} />)
    await waitForExpectation(() => expect(state?.rows?.length).toBeGreaterThan(3))
    await waitForExpectation(() => expect(frameOf(view)).toContain('CANARY'))
    expectClean(frameOf(view))
  })
})

vi.mock('../executor.js', async () => ({
  ...await vi.importActual('../executor.js'),
  getPRFilePatch: vi.fn(),
  loadEvidenceDetail: vi.fn(),
}))

describe('issue views', () => {
  const ISSUE = poison({
    number: 11, title: 'Issue title', body: '# Head\n\ntext line\n\n- item', state: 'OPEN', updatedAt: '2026-06-06T10:00:00Z',
    author: { login: 'author' }, labels: [{ name: 'bug', color: 'ff0000' }], assignees: [{ login: 'assignee' }],
    milestone: { title: 'release' },
    comments: [{ author: { login: 'reviewer' }, body: 'Comment body', createdAt: '2026-06-06T10:00:00Z' }],
  })
  const TIMELINE = poison({
    items: [
      { key: 'IC_1', kind: 'comment', id: 1, author: 'alice', authorAssociation: 'MEMBER', body: 'comment body\nsecond line', url: 'https://example.invalid/c/1', createdAt: '2026-06-06T10:00:00Z', lastEditedAt: null, isMinimized: false, minimizedReason: null, viewerCanUpdate: false, viewerCanDelete: false, reactions: [{ content: 'THUMBS_UP', label: '+1', count: 2 }] },
      { key: 'L1', kind: 'event', type: 'labeled', actor: 'bob', createdAt: '2026-06-06T10:00:00Z', label: 'bug', color: 'ff0000' },
      { key: 'R1', kind: 'event', type: 'renamed', actor: 'bob', createdAt: '2026-06-06T10:00:00Z', from: 'old title', to: 'new title' },
    ],
    page: { total: 3, hasNextPage: false, endCursor: 'c1', stalled: false },
    viewer: 'me',
  })
  const page = (items) => ({ items, hasNextPage: false, endCursor: null, totalCount: items.length })
  beforeEach(() => {
    useGh.mockImplementation(fn => result(
      fn === listIssuesPage ? page([ISSUE]) : fn === getIssueHeader ? ISSUE
          : fn === listIssueTimelinePage ? TIMELINE
        : fn === listLabels ? poison([{ name: 'bug', color: 'ff0000' }])
          : fn === listCollaborators ? poison([{ login: 'assignee' }]) : null,
    ))
  })
  it('list', async () => {
    const view = renderWithProviders(<IssueList repo="o/r" onSelectIssue={() => {}} />)
    await waitForExpectation(() => expect(frameOf(view)).toContain('CANARY'))
    expectClean(frameOf(view))
  })
  it('detail and timeline', async () => {
    const view = renderWithProviders(<IssueDetail repo="o/r" issueNumber={11} onBack={() => {}} />)
    await waitForExpectation(() => expect(frameOf(view)).toContain('CANARY'))
    expectClean(frameOf(view))
    await flush(30)
    for (let i = 0; i < 12; i++) await sendInput('j')
    await flush(30)
    expect(frameOf(view)).toContain('comment body')
    expectClean(frameOf(view))
  })
})

describe('other panes', () => {
  it('branches', async () => {
    useGh.mockImplementation(fn => result(fn === listBranches ? poison([{ name: 'feat/x' }, { name: 'main', isDefault: true }]) : fn === listOpenPRBranches ? poison([{ headRefName: 'feat/x', number: 1 }]) : []))
    const view = renderWithProviders(<BranchList repo="o/r" listHeight={10} />)
    await waitForExpectation(() => expect(frameOf(view)).toContain('CANARY'))
    expectClean(frameOf(view))
  })

  it('workflow runs', async () => {
    useGh.mockImplementation(fn => result(fn === listRuns ? poison([{ databaseId: 1, workflowName: 'Build', displayTitle: 'Build', headBranch: 'feat', status: 'completed', conclusion: 'success', createdAt: '2026-06-06T10:00:00Z' }]) : null))
    const view = renderWithProviders(<ActionList repo="o/r" listHeight={10} />)
    await waitForExpectation(() => expect(frameOf(view)).toContain('CANARY'))
    expectClean(frameOf(view))
  })

  it('notifications', async () => {
    const data = poison([{ id: '1', unread: true, reason: 'mention', updatedAt: '2026-06-06T10:00:00Z', repository: { name: 'repo', full_name: 'o/repo' }, subject: { title: 'Thread', type: 'Issue' } }])
    useGh.mockImplementation(fn => result(fn === listNotifications ? data : null))
    const view = renderWithProviders(<NotificationList repo="o/r" onNavigateTo={() => {}} />)
    await waitForExpectation(() => expect(frameOf(view)).toContain('CANARY'))
    expectClean(frameOf(view))
  })
})

describe('log viewer and annotations', () => {
  const RAW_LOG = [
    `build\tstep\t2026-01-01T00:00:03.0000000Z first${CANARY}`,
    `build\tstep\t2026-01-01T00:00:04.0000000Z progress 10%\r50%${CANARY}`,
    `##[group]Group${CANARY}`,
  ].join('\n')

  it('run log lines and title', () => {
    const lines = toLogLines(RAW_LOG)
    const title = logTitle({ workflowName: `Flow${CANARY}`, headBranch: `br${CANARY}`, conclusion: 'failure' })
    const view = renderWithProviders(<LogViewer lines={lines} title={title} onClose={() => {}} />)
    expect(frameOf(view)).toContain('CANARY')
    expectClean(frameOf(view))
  })

  it('raw lines passed straight to the viewer', () => {
    const view = renderWithProviders(<LogViewer lines={[`one${CANARY}`, `two\t${CANARY}`]} title={`T${CANARY}`} onClose={() => {}} />)
    expect(frameOf(view)).toContain('CANARY')
    expectClean(frameOf(view))
  })

  it('failure excerpt', () => {
    const excerpt = { state: 'ok', detail: '', excerpt: { kind: `kind${CANARY}`, job: `job${CANARY}`, step: `step${CANARY}`, lines: [`line${CANARY}`], truncated: false, locations: [{ path: `p${CANARY}`, line: 3, col: 1 }] } }
    const view = renderWithProviders(<LogViewer lines={[]} title={`T${CANARY}`} excerpt={excerpt} onClose={() => {}} />)
    expect(frameOf(view)).toContain('CANARY')
    expectClean(frameOf(view))
  })

  it('why is CI red rows', () => {
    const model = poison({ state: 'ok', pending: 0, totalFailing: 1, notAnalysed: 0, filesNote: 'note', checks: [{
      name: 'n', duration: '1s', step: 's', job: 'j', log: { state: 'ok', detail: '' }, url: null, blameNote: 'b',
      excerpt: { kind: 'tsc', job: 'j', step: 's', lines: ['l'], locations: [], truncated: false },
      blame: { items: [{ path: 'p', line: 1, failLine: 1, kind: 'changed', via: 'exact', text: 'code' }], unmatched: 0, ambiguous: 0, capped: false },
      base: { verdict: 'unknown', text: 'unknown: x' },
    }] })
    const lines = whyRedRows(model, { prNumber: 1 }).map(r => r.text)
    const view = renderWithProviders(<LogViewer lines={lines} onClose={() => {}} />)
    expect(frameOf(view)).toContain('CANARY')
    expectClean(frameOf(view))
  })

  it('check annotations', () => {
    const lines = annotationLines(poison([{ level: 'failure', path: 'src/a.js', line: 3, title: 'Title', message: 'First\nSecond' }]))
    const view = renderWithProviders(<LogViewer lines={lines} onClose={() => {}} />)
    expect(frameOf(view)).toContain('CANARY')
    expectClean(frameOf(view))
  })
})

describe('collision radar', () => {
  const file = (path, changes) => ({ path, additions: 1, deletions: 1, changeType: 'MODIFIED', changes })
  const patch = '@@ -3,2 +3,2 @@ heading'
  const scan = () => poison({
    repo: 'o/r', number: 1, fetchedAt: Date.now(), totalOpen: 9, notScanned: 3, currentOutside: false,
    filesCapped: [{ number: 2, shown: 100, total: 300 }], hunkChecked: [2], hunkSkipped: [], patchTruncated: [],
    errors: [{ number: 2, message: 'bad' }],
    prs: [
      { number: 1, title: 'Mine', author: 'me', state: 'OPEN', baseRefName: 'main', additions: 1, deletions: 1, files: [file('src/a.js', parsePatchChanges(`${patch}\n-a\n+b`))] },
      { number: 2, title: 'Theirs', author: 'you', state: 'OPEN', baseRefName: 'main', additions: 1, deletions: 1, files: [file('src/a.js', parsePatchChanges(`${patch}\n-a\n+b`))] },
    ],
  })

  for (const tab of ['pr', 'repo']) {
    it(`${tab} tab`, async () => {
      useGh.mockImplementation(() => result(scan()))
      const view = renderWithProviders(<CollisionRadar repo="o/r" prNumber={1} onClose={() => {}} />)
      await flush(20)
      if (tab === 'repo') { await sendInput('', { tab: true }); await flush(20) }
      expect(frameOf(view)).toContain('CANARY')
      expectClean(frameOf(view))
    })
  }
})

describe('review evidence view', () => {
  const fact = (value) => ({ value, source: 'github.graphql', fetched_at: '2026-11-09T12:00:00.000Z' })
  const detail = () => poison({
    record: {
      identity: { repo: 'o/r', number: 1, account: 'me' }, context: { head: fact('abc1234'), base: fact('main') },
      facts: {
        state: fact('OPEN'), is_draft: fact(false), mergeable: fact('MERGEABLE'), review_decision: fact('APPROVED'),
        checks: fact({ state: 'SUCCESS', total: 1, passed: 1, failed: 0, pending: 0, truncated: false }),
        reviews: fact({ approvals: 1, staleApprovals: 0, changesRequested: 0, mine: 'NONE', truncated: false }),
        review_requests: fact({ via: 'team_unverified', teams: ['core'], truncated: false }),
        unresolved_threads: fact({ unresolved: 0, total: 0, truncated: false }),
      },
      attention: [], actor: { login: 'dev', github_type: 'Bot', attribution: 'unverified' },
      untrusted: { title: 'Title', title_truncated: false, body: 'Body', body_truncated: false, threads: [{ path: 'src/a.js', author: 'jin', excerpt: 'Why', truncated: false }] },
      fetched_at: new Date().toISOString(),
    },
    files: fact({ items: [{ path: 'src/a.js', additions: 1, deletions: 0, change_type: 'MODIFIED', kind: 'source' }], total: 1, returned: 1, truncated: false, head: 'abc1234' }),
    required_checks: fact({ required: 1, passing: 1, failing: 0, pending: 0, total: 1, truncated: false, head: 'abc1234', names: ['lint'] }),
    head: { state: 'current', inspected: 'abc1234', current: 'abc1234' },
    errors: [{ part: 'files', message: 'bad' }],
  })
  it('rows, files and thread excerpts', async () => {
    loadEvidenceDetail.mockResolvedValue(detail())
    const view = renderWithProviders(<EvidenceView pr={{ number: 1 }} repo="o/r" onClose={() => {}} />)
    await flush(20)
    for (let i = 0; i < 30; i++) await sendInput('j')
    await flush(20)
    expect(frameOf(view)).toContain('CANARY')
    expectClean(frameOf(view))
  })
})

describe('AI review pane', () => {
  const suggestions = poison([{ file: 'src/a.js', line: 3, severity: 'bug', comment: 'Looks wrong\nsecond line' }])
  it('summary and step', async () => {
    const view = renderWithProviders(
      <AIReviewPane suggestions={suggestions} summary={poison('Summary text')} onJumpTo={() => {}} onPost={() => {}} onClose={() => {}} postStatus={null} onOpenEditor={() => ''} />,
    )
    expect(frameOf(view)).toContain('CANARY')
    expectClean(frameOf(view))
    const { sendInput } = await import('../test/input-bus.js')
    await flush(30)
    await sendInput(' ')
    await waitForExpectation(() => expect(frameOf(view)).toContain('1/1'))
    expect(frameOf(view)).toContain('CANARY')
    expectClean(frameOf(view))
  })
})
