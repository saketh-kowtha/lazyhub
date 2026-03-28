/**
 * executor.test.js — unit tests for executor.js
 * Mocks execa to avoid real gh CLI calls.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('execa', () => {
  return {
    execa: vi.fn(),
  }
})

import { execa } from 'execa'
import {
  GhError,
  run,
  listPRs,
  getPR,
  mergePR,
  listIssues,
  getIssue,
  createIssue,
  closeIssue,
  listLabels,
  addLabels,
  removeLabels,
  listCollaborators,
  requestReviewers,
  listBranches,
  checkoutBranch,
  deleteBranch,
  listRuns,
  getRunLogs,
  rerunRun,
  cancelRun,
  listReleases,
  listNotifications,
  markNotificationRead,
  getPRDiff,
  addPRComment,
  listPRComments,
  resolveThread,
  createPR,
} from './executor.js'

// Helper: make execa return a successful JSON response
function mockSuccess(data) {
  execa.mockResolvedValue({
    exitCode: 0,
    stdout: typeof data === 'string' ? data : JSON.stringify(data),
    stderr: '',
  })
}

// Helper: make execa return a failure
function mockFailure(stderr = 'error', exitCode = 1) {
  execa.mockResolvedValue({ exitCode, stdout: '', stderr })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.GHUI_REPO = 'owner/repo'
})

// ─── GhError ─────────────────────────────────────────────────────────────────

describe('GhError', () => {
  it('is an instance of Error', () => {
    const err = new GhError({ message: 'test', stderr: 'err', exitCode: 1, args: ['pr', 'list'] })
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(GhError)
    expect(err.name).toBe('GhError')
    expect(err.message).toBe('test')
    expect(err.stderr).toBe('err')
    expect(err.exitCode).toBe(1)
    expect(err.args).toEqual(['pr', 'list'])
  })
})

// ─── run() ───────────────────────────────────────────────────────────────────

describe('run()', () => {
  it('parses JSON stdout on success', async () => {
    mockSuccess([{ number: 1, title: 'PR 1' }])
    const result = await run(['pr', 'list', '--repo', 'owner/repo', '--json', 'number'])
    expect(result).toEqual([{ number: 1, title: 'PR 1' }])
  })

  it('returns null when stdout is empty', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    const result = await run(['pr', 'merge', '1'])
    expect(result).toBeNull()
  })

  it('returns raw string for non-JSON output (e.g. diff)', async () => {
    const diff = 'diff --git a/file.js b/file.js\n+added line'
    execa.mockResolvedValue({ exitCode: 0, stdout: diff, stderr: '' })
    const result = await run(['pr', 'diff', '1'])
    expect(result).toBe(diff)
  })

  it('throws GhError on non-zero exit code', async () => {
    mockFailure('repository not found', 1)
    await expect(run(['pr', 'list'])).rejects.toThrow(GhError)
  })

  it('throws GhError with rate limit message on rate-limit stderr', async () => {
    mockFailure('API rate limit exceeded', 1)
    try {
      await run(['pr', 'list'])
    } catch (err) {
      expect(err).toBeInstanceOf(GhError)
      expect(err.message).toContain('rate limit')
    }
  })

  it('throws GhError when execa itself throws', async () => {
    execa.mockRejectedValue(Object.assign(new Error('spawn gh ENOENT'), { exitCode: 127 }))
    await expect(run(['pr', 'list'])).rejects.toThrow(GhError)
  })
})

// ─── PR functions ─────────────────────────────────────────────────────────────

describe('listPRs()', () => {
  it('calls gh pr list with correct args', async () => {
    mockSuccess([])
    await listPRs('owner/repo')
    const [cmd, args] = execa.mock.calls[0]
    expect(cmd).toBe('gh')
    expect(args).toContain('pr')
    expect(args).toContain('list')
    expect(args).toContain('--repo')
    expect(args).toContain('owner/repo')
    expect(args).toContain('--json')
  })

  it('passes state filter when provided', async () => {
    mockSuccess([])
    await listPRs('owner/repo', { state: 'closed' })
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('--state')
    expect(args).toContain('closed')
  })

  it('passes author filter when provided', async () => {
    mockSuccess([])
    await listPRs('owner/repo', { author: 'alice' })
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('--author')
    expect(args).toContain('alice')
  })
})

describe('getPR()', () => {
  it('calls gh pr view with number', async () => {
    mockSuccess({ number: 42, title: 'Fix bug' })
    await getPR('owner/repo', 42)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('view')
    expect(args).toContain('42')
    expect(args).toContain('--repo')
  })
})

describe('mergePR()', () => {
  it('calls gh pr merge with default --merge strategy', async () => {
    mockSuccess(null)
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await mergePR('owner/repo', 1)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('merge')
    expect(args).toContain('1')
    expect(args).toContain('--merge')
  })

  it('uses --squash strategy when specified', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await mergePR('owner/repo', 2, 'squash')
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('--squash')
  })

  it('uses --rebase strategy when specified', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await mergePR('owner/repo', 3, 'rebase')
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('--rebase')
  })
})

// ─── Issue functions ──────────────────────────────────────────────────────────

describe('listIssues()', () => {
  it('calls gh issue list with correct args', async () => {
    mockSuccess([])
    await listIssues('owner/repo')
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('issue')
    expect(args).toContain('list')
    expect(args).toContain('--repo')
  })

  it('passes label filter', async () => {
    mockSuccess([])
    await listIssues('owner/repo', { label: 'bug' })
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('--label')
    expect(args).toContain('bug')
  })
})

describe('getIssue()', () => {
  it('calls gh issue view', async () => {
    mockSuccess({ number: 5, title: 'Issue' })
    await getIssue('owner/repo', 5)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('issue')
    expect(args).toContain('view')
    expect(args).toContain('5')
  })
})

describe('createIssue()', () => {
  it('calls gh issue create with title', async () => {
    mockSuccess('https://github.com/owner/repo/issues/1')
    execa.mockResolvedValue({ exitCode: 0, stdout: 'https://github.com/owner/repo/issues/1', stderr: '' })
    await createIssue('owner/repo', { title: 'New issue', body: 'Body text' })
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('create')
    expect(args).toContain('--title')
    expect(args).toContain('New issue')
    expect(args).toContain('--body')
  })

  it('adds label args when labels are provided', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'https://example.com', stderr: '' })
    await createIssue('owner/repo', { title: 'T', labels: ['bug', 'help wanted'] })
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('--label')
    expect(args).toContain('bug,help wanted')
  })
})

describe('closeIssue()', () => {
  it('calls gh issue close', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await closeIssue('owner/repo', 10)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('close')
    expect(args).toContain('10')
  })
})

// ─── Label functions ──────────────────────────────────────────────────────────

describe('listLabels()', () => {
  it('calls gh label list', async () => {
    mockSuccess([{ name: 'bug', color: 'ff0000' }])
    await listLabels('owner/repo')
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('label')
    expect(args).toContain('list')
  })
})

describe('addLabels()', () => {
  it('calls gh issue edit --add-label', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await addLabels('owner/repo', 1, ['bug', 'enhancement'])
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('--add-label')
    expect(args).toContain('bug,enhancement')
  })
})

describe('removeLabels()', () => {
  it('calls gh issue edit --remove-label', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await removeLabels('owner/repo', 1, ['bug'])
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('--remove-label')
    expect(args).toContain('bug')
  })
})

// ─── Collaborator functions ───────────────────────────────────────────────────

describe('listCollaborators()', () => {
  it('calls gh api repos/{owner}/{repo}/collaborators', async () => {
    mockSuccess([{ login: 'alice', name: 'Alice' }])
    await listCollaborators('owner/repo')
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('api')
    expect(args.some(a => a.includes('collaborators'))).toBe(true)
  })
})

describe('requestReviewers()', () => {
  it('calls gh pr edit --add-reviewer', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await requestReviewers('owner/repo', 5, ['bob', 'carol'])
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('--add-reviewer')
    expect(args).toContain('bob,carol')
  })
})

// ─── Branch functions ─────────────────────────────────────────────────────────

describe('listBranches()', () => {
  it('calls gh api repos endpoint for branches', async () => {
    mockSuccess([{ name: 'main', protected: true }])
    await listBranches('owner/repo')
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('api')
    expect(args.some(a => a.includes('branches'))).toBe(true)
  })
})

describe('checkoutBranch()', () => {
  it('calls gh pr checkout', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await checkoutBranch('owner/repo', 7)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('checkout')
    expect(args).toContain('7')
  })
})

describe('deleteBranch()', () => {
  it('calls gh api DELETE on the branch ref', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await deleteBranch('owner/repo', 'feature-branch')
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('api')
    expect(args).toContain('--method')
    expect(args).toContain('DELETE')
    expect(args.some(a => a.includes('feature-branch'))).toBe(true)
  })
})

// ─── Actions functions ────────────────────────────────────────────────────────

describe('listRuns()', () => {
  it('calls gh run list', async () => {
    mockSuccess([])
    await listRuns('owner/repo')
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('run')
    expect(args).toContain('list')
    expect(args).toContain('--repo')
  })
})

describe('getRunLogs()', () => {
  it('calls gh run view --log', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'step logs here', stderr: '' })
    await getRunLogs('owner/repo', 12345)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('view')
    expect(args).toContain('12345')
    expect(args).toContain('--log')
  })
})

describe('rerunRun()', () => {
  it('calls gh run rerun --failed-only', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await rerunRun('owner/repo', 999)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('rerun')
    expect(args).toContain('999')
    expect(args).toContain('--failed-only')
  })
})

describe('cancelRun()', () => {
  it('calls gh run cancel', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await cancelRun('owner/repo', 888)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('cancel')
    expect(args).toContain('888')
  })
})

// ─── Release functions ────────────────────────────────────────────────────────

describe('listReleases()', () => {
  it('calls gh release list', async () => {
    mockSuccess([{ name: 'v1.0.0' }])
    await listReleases('owner/repo')
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('release')
    expect(args).toContain('list')
  })
})

// ─── Notification functions ───────────────────────────────────────────────────

describe('listNotifications()', () => {
  it('calls gh api notifications', async () => {
    mockSuccess([])
    await listNotifications()
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('api')
    expect(args).toContain('notifications')
  })
})

describe('markNotificationRead()', () => {
  it('calls gh api PATCH on notification thread', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await markNotificationRead('thread-123')
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('api')
    expect(args).toContain('--method')
    expect(args).toContain('PATCH')
    expect(args.some(a => a.includes('thread-123'))).toBe(true)
  })
})

// ─── PR diff and comment functions ───────────────────────────────────────────

describe('getPRDiff()', () => {
  it('calls gh pr diff', async () => {
    const diff = 'diff --git a/file.js b/file.js'
    execa.mockResolvedValue({ exitCode: 0, stdout: diff, stderr: '' })
    const result = await getPRDiff('owner/repo', 3)
    expect(result).toBe(diff)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('diff')
    expect(args).toContain('3')
  })
})

describe('addPRComment()', () => {
  it('calls gh pr comment with body', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await addPRComment('owner/repo', 4, 'Great work!')
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('comment')
    expect(args).toContain('4')
    expect(args).toContain('--body')
    expect(args).toContain('Great work!')
  })
})

describe('listPRComments()', () => {
  it('calls gh api pulls/{number}/comments', async () => {
    mockSuccess([])
    await listPRComments('owner/repo', 5)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('api')
    expect(args.some(a => a.includes('pulls/5/comments'))).toBe(true)
  })
})

describe('resolveThread()', () => {
  it('calls gh api graphql with resolveReviewThread mutation', async () => {
    mockSuccess({ data: { resolveReviewThread: { thread: { id: 'abc', isResolved: true } } } })
    await resolveThread('thread-abc')
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('api')
    expect(args).toContain('graphql')
    expect(args.some(a => a.includes('resolveReviewThread'))).toBe(true)
  })
})

describe('createPR()', () => {
  it('calls gh pr create with required args', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'https://github.com/owner/repo/pull/1', stderr: '' })
    await createPR('owner/repo', {
      title: 'My PR',
      head: 'feature',
      base: 'main',
      body: 'Description',
    })
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('create')
    expect(args).toContain('--title')
    expect(args).toContain('My PR')
    expect(args).toContain('--head')
    expect(args).toContain('feature')
    expect(args).toContain('--base')
    expect(args).toContain('main')
  })

  it('adds --draft flag when draft is true', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'https://example.com', stderr: '' })
    await createPR('owner/repo', { title: 'Draft PR', head: 'feat', base: 'main', draft: true })
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('--draft')
  })

  it('adds reviewer args', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'https://example.com', stderr: '' })
    await createPR('owner/repo', { title: 'T', head: 'h', base: 'b', reviewers: ['alice', 'bob'] })
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('--reviewer')
    expect(args).toContain('alice,bob')
  })
})
