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
  runGh,
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
  rerunCheckRun,
  getCheckRunAnnotations,
  listReleases,
  listNotifications,
  markNotificationRead,
  getPRDiff,
  addPRComment,
  addPRLineComment,
  listPRComments,
  resolveThread,
  createPR,
  listGists,
  getGist,
  deleteGist,
  getPRReviewComments,
  addPRReviewThreadReply,
  resolvePRReviewThread,
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

// ─── runGh() ───────────────────────────────────────────────────────────────────

describe('runGh()', () => {
  it('parses JSON stdout on success', async () => {
    mockSuccess([{ number: 1, title: 'PR 1' }])
    const result = await runGh(['pr', 'list', '--repo', 'owner/repo', '--json', 'number'])
    expect(result).toEqual([{ number: 1, title: 'PR 1' }])
  })

  it('returns null when stdout is empty', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    const result = await runGh(['pr', 'merge', '1'])
    expect(result).toBeNull()
  })

  it('returns raw string for non-JSON output (e.g. diff)', async () => {
    const diff = 'diff --git a/file.js b/file.js\n+added line'
    execa.mockResolvedValue({ exitCode: 0, stdout: diff, stderr: '' })
    const result = await runGh(['pr', 'diff', '1'])
    expect(result).toBe(diff)
  })

  it('throws GhError on non-zero exit code', async () => {
    mockFailure('repository not found', 1)
    await expect(runGh(['pr', 'list'])).rejects.toThrow(GhError)
  })

  it('throws GhError with rate limit message on rate-limit stderr', async () => {
    mockFailure('API rate limit exceeded', 1)
    try {
      await runGh(['pr', 'list'])
    } catch (err) {
      expect(err).toBeInstanceOf(GhError)
      expect(err.message).toContain('rate limit')
    }
  })

  it('throws GhError when execa itself throws', async () => {
    execa.mockRejectedValue(Object.assign(new Error('spawn gh ENOENT'), { exitCode: 127 }))
    await expect(runGh(['pr', 'list'])).rejects.toThrow(GhError)
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

describe('rerunCheckRun()', () => {
  it('calls gh api POST check-runs rerequest', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '{}', stderr: '' })
    await rerunCheckRun('owner/repo', 12345)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('api')
    expect(args.some(a => String(a).includes('12345') && String(a).includes('rerequest'))).toBe(true)
    expect(args).toContain('--method')
    expect(args).toContain('POST')
  })
})

describe('getCheckRunAnnotations()', () => {
  it('returns parsed annotations', async () => {
    const annotations = [{ path: 'src/foo.js', start_line: 10, annotation_level: 'failure', message: 'oops', title: 'Error' }]
    mockSuccess(annotations)
    const result = await getCheckRunAnnotations('owner/repo', 99)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('api')
    expect(args.some(a => String(a).includes('99') && String(a).includes('annotations'))).toBe(true)
    expect(result).toEqual(annotations)
  })

  it('returns empty array on error', async () => {
    execa.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found' })
    const result = await getCheckRunAnnotations('owner/repo', 0)
    expect(result).toEqual([])
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
  it('calls gh api graphql with reviewThreads query', async () => {
    mockSuccess({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } })
    await listPRComments('owner/repo', 5)
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('api')
    expect(args).toContain('graphql')
    expect(args.some(a => a.includes('reviewThreads'))).toBe(true)
    expect(args.some(a => a === 'owner=owner' || a === 'name=repo' || a === 'number=5')).toBe(true)
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

// ─── GHE / GH_HOST support ───────────────────────────────────────────────────

describe('GH_HOST support', () => {
  // gh CLI honors GH_HOST via env inheritance for `--repo OWNER/REPO` calls.
  // We deliberately do NOT pass --hostname: it's invalid on `gh pr list`,
  // `gh issue list`, etc. (valid only on `gh api`, `gh auth *`, `gh repo *`).
  it('does not pass --hostname when GH_HOST is set (relies on env inheritance)', async () => {
    process.env.GH_HOST = 'github.example.com'
    mockSuccess([])
    await listPRs('owner/repo')
    const [_cmd, args] = execa.mock.calls[0]
    expect(args).not.toContain('--hostname')
    delete process.env.GH_HOST
  })

  it('does not pass --hostname when GH_HOST is not set', async () => {
    delete process.env.GH_HOST
    mockSuccess([])
    await listPRs('owner/repo')
    const [_cmd, args] = execa.mock.calls[0]
    expect(args).not.toContain('--hostname')
  })
})

// ─── Rate limit detection ─────────────────────────────────────────────────────

describe('rate limit detection', () => {
  it('throws GhError with rate limit message', async () => {
    mockFailure('API rate limit exceeded for user', 1)
    await expect(listPRs('owner/repo')).rejects.toMatchObject({
      message: 'GitHub API rate limit exceeded',
    })
  })
})

// ─── 404 / not found detection ────────────────────────────────────────────────

describe('404 / not found detection', () => {
  it('throws GhError with not found message when stderr mentions HTTP 404', async () => {
    execa.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'HTTP 404: Not Found' })
    await expect(getPR('owner/repo', 999)).rejects.toMatchObject({
      message: 'Resource not found',
    })
  })

  it('throws GhError with not found for stderr "not found"', async () => {
    mockFailure('Could not resolve to a Repository', 1)
    await expect(listPRs('owner/repo')).rejects.toMatchObject({
      message: 'Resource not found',
    })
  })
})

// ─── Raw string return (non-JSON) ─────────────────────────────────────────────

describe('raw string return', () => {
  it('returns raw string when stdout is not JSON', async () => {
    const diff = 'diff --git a/foo.js b/foo.js\n+added line'
    mockSuccess(diff)
    const result = await getPRDiff('owner/repo', 1)
    expect(result).toBe(diff)
  })

  it('returns null for empty stdout', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    const result = await listLabels('owner/repo')
    expect(result).toBeNull()
  })
})

// ─── GhError fields ───────────────────────────────────────────────────────────

describe('GhError fields', () => {
  it('captures stderr, exitCode, and args on failure', async () => {
    execa.mockResolvedValue({ exitCode: 128, stdout: '', stderr: 'authentication required' })
    try {
      await listPRs('owner/repo')
    } catch (err) {
      expect(err).toBeInstanceOf(GhError)
      expect(err.exitCode).toBe(128)
      expect(err.stderr).toBe('authentication required')
      expect(err.message).toBe('authentication required')
    }
  })
})

// ─── Gist functions ───────────────────────────────────────────────────────────

describe('listGists', () => {
  it('calls gh gist list', async () => {
    mockSuccess([{ id: 'abc123', description: 'test gist' }])
    const result = await listGists()
    expect(execa).toHaveBeenCalledWith('gh', expect.arrayContaining(['gist', 'list']), expect.anything())
    expect(result[0].id).toBe('abc123')
  })
})

describe('getGist', () => {
  it('calls gh gist view --raw', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: 'const x = 1', stderr: '' })
    const result = await getGist('abc123')
    expect(execa).toHaveBeenCalledWith('gh', expect.arrayContaining(['gist', 'view', 'abc123', '--raw']), expect.anything())
    expect(result).toBe('const x = 1')
  })
})

describe('deleteGist', () => {
  it('calls gh gist delete', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await deleteGist('abc123')
    expect(execa).toHaveBeenCalledWith('gh', expect.arrayContaining(['gist', 'delete', 'abc123']), expect.anything())
  })
})

// ─── Phase 2 IPC review functions ────────────────────────────────────────────

describe('getPRReviewComments', () => {
  it('calls gh api graphql and returns shaped comment array', async () => {
    const gqlResponse = {
      data: {
        repository: {
          pullRequest: {
            reviewThreads: {
              nodes: [
                {
                  id: 'PRRT_abc123',
                  isResolved: false,
                  comments: {
                    nodes: [
                      {
                        databaseId: 101,
                        body: 'Please fix this',
                        path: 'src/foo.js',
                        line: 42,
                        originalLine: 42,
                        author: { login: 'alice' },
                      },
                    ],
                  },
                },
              ],
            },
          },
        },
      },
    }
    mockSuccess(gqlResponse)
    const result = await getPRReviewComments('owner/repo', 7)
    expect(execa).toHaveBeenCalledWith('gh', expect.arrayContaining(['api', 'graphql']), expect.anything())
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      id:       101,
      threadId: 'PRRT_abc123',
      path:     'src/foo.js',
      line:     42,
      body:     'Please fix this',
      user:     'alice',
      resolved: false,
    })
  })

  it('throws GhError on invalid repo format', async () => {
    await expect(getPRReviewComments('bad repo!', 1)).rejects.toBeInstanceOf(Error)
  })

  it('returns empty array when no threads', async () => {
    mockSuccess({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } })
    const result = await getPRReviewComments('owner/repo', 1)
    expect(result).toEqual([])
  })
})

describe('addPRReviewThreadReply', () => {
  it('calls gh api graphql with the reply mutation', async () => {
    mockSuccess({
      data: {
        addPullRequestReviewThreadReply: {
          comment: { databaseId: 999 },
        },
      },
    })
    const result = await addPRReviewThreadReply('PRRT_abc123', 'Great point!')
    expect(execa).toHaveBeenCalledWith('gh', expect.arrayContaining(['api', 'graphql']), expect.anything())
    const [, args] = execa.mock.calls[0]
    expect(args).toContain('-f')
    // Verify mutation and thread ID are passed
    const allFArgs = []
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-f' && args[i + 1]) allFArgs.push(args[i + 1])
    }
    expect(allFArgs.some(a => a.startsWith('threadId='))).toBe(true)
    expect(result).toMatchObject({ ok: true, commentId: 999 })
  })
})

describe('resolvePRReviewThread', () => {
  it('calls gh api graphql with the resolve mutation', async () => {
    mockSuccess({
      data: {
        resolveReviewThread: { thread: { id: 'PRRT_abc123', isResolved: true } },
      },
    })
    const result = await resolvePRReviewThread('PRRT_abc123')
    expect(execa).toHaveBeenCalledWith('gh', expect.arrayContaining(['api', 'graphql']), expect.anything())
    const [, args] = execa.mock.calls[0]
    const allFArgs = []
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-f' && args[i + 1]) allFArgs.push(args[i + 1])
    }
    expect(allFArgs.some(a => a.startsWith('threadId='))).toBe(true)
    expect(result).toMatchObject({ ok: true })
  })

  it('propagates GhError on gh failure', async () => {
    mockFailure('not found', 1)
    await expect(resolvePRReviewThread('PRRT_bad')).rejects.toBeInstanceOf(Error)
  })
})

// ─── runGh() opts: json / stdin / timeout ────────────────────────────────────

describe('runGh() opts', () => {
  it('passes the default 30s timeout to execa', async () => {
    mockSuccess([])
    await runGh(['pr', 'list'])
    const [, , execaOpts] = execa.mock.calls[0]
    expect(execaOpts).toMatchObject({ reject: false, timeout: 30000 })
  })

  it('honors an explicit timeout override', async () => {
    mockSuccess([])
    await runGh(['pr', 'list'], { timeout: 5000 })
    const [, , execaOpts] = execa.mock.calls[0]
    expect(execaOpts).toMatchObject({ timeout: 5000 })
  })

  it('returns raw stdout (never parses) when json is false', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '{"a":1}', stderr: '' })
    const result = await runGh(['api', 'something'], { json: false })
    expect(result).toBe('{"a":1}')
  })

  it('parses JSON when json is true', async () => {
    execa.mockResolvedValue({ exitCode: 0, stdout: '{"a":1}', stderr: '' })
    const result = await runGh(['api', 'something'], { json: true })
    expect(result).toEqual({ a: 1 })
  })

  it('throws a GhError with a timeout message when execa reports timedOut', async () => {
    execa.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', timedOut: true })
    await expect(runGh(['pr', 'list'], { timeout: 1000 })).rejects.toMatchObject({
      name: 'GhError',
      message: expect.stringContaining('timed out'),
    })
  })
})

// ─── addPRLineComment routes stdin through runGh ──────────────────────────────

describe('addPRLineComment()', () => {
  it('pipes the JSON payload via stdin (never argv) through the chokepoint', async () => {
    const writes = []
    const proc = {
      stdin: { write: v => writes.push(v), end: () => {} },
      then: (res) => res({ exitCode: 0, stdout: '{"id":1}', stderr: '' }),
    }
    execa.mockReturnValue(proc)
    const result = await addPRLineComment('owner/repo', 7, {
      body: 'nit', path: 'src/foo.js', line: 10, commitId: 'abc',
    })
    const [cmd, args] = execa.mock.calls[0]
    expect(cmd).toBe('gh')
    expect(args).toContain('--input')
    expect(args).toContain('-')
    // the comment body must be on stdin, not in argv
    expect(args.some(a => String(a).includes('nit'))).toBe(false)
    expect(writes.join('')).toContain('"body":"nit"')
    expect(result).toEqual({ id: 1 })
  })
})

// ─── GHES (GH_HOST) regression ────────────────────────────────────────────────

describe('GHES regression (GH_HOST=ghe.example.com)', () => {
  // Sept 2024 bug: a curated env stripped GH_TOKEN/GH_HOST, breaking GHES auth.
  // runGh must inherit process.env (no env override) and add no --hostname flag.
  it('does not strip env and adds no --hostname when targeting a GHES host', async () => {
    process.env.GH_HOST = 'ghe.example.com'
    mockSuccess([])
    await runGh(['pr', 'list', '--repo', 'owner/repo'])
    const [cmd, args, execaOpts] = execa.mock.calls[0]
    expect(cmd).toBe('gh')
    expect(args).not.toContain('--hostname')
    // No `env` key → execa inherits process.env, so gh reads GH_HOST/GH_TOKEN.
    expect(execaOpts).not.toHaveProperty('env')
    delete process.env.GH_HOST
  })
})

// ─── Error message redaction (no over-redaction of repo/branch names) ─────────

describe('error message redaction', () => {
  it('keeps long repo names intact in the user-facing message', async () => {
    mockFailure('failed to access myorg/very-long-repo-name-here', 1)
    try {
      await runGh(['repo', 'view'])
    } catch (err) {
      expect(err.message).toContain('myorg/very-long-repo-name-here')
      expect(err.message).not.toContain('[REDACTED]')
    }
  })

  it('keeps long branch names intact in the user-facing message', async () => {
    mockFailure('cannot push to feature/jira-XYZ-123-stack-rewrite-attempt-2', 1)
    try {
      await runGh(['pr', 'create'])
    } catch (err) {
      expect(err.message).toContain('feature/jira-XYZ-123-stack-rewrite-attempt-2')
      expect(err.message).not.toContain('[REDACTED]')
    }
  })

  it('still redacts token-length secrets (40+ chars) in the message', async () => {
    // ghp_ + 36 chars = 40, the length of a real gh personal access token.
    mockFailure('bad credentials: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', 1)
    try {
      await runGh(['api', 'user'])
    } catch (err) {
      expect(err.message).toContain('[REDACTED]')
      expect(err.message).not.toContain('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789')
    }
  })
})
