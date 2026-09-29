import { describe, expect, it, vi } from 'vitest'

vi.mock('../executor.js', () => ({
  addPRComment: vi.fn(),
  addPRLineComment: vi.fn(),
  closeIssue: vi.fn(),
  getIssue: vi.fn(),
  getPR: vi.fn(),
  getPRChecks: vi.fn(),
  getPRDiff: vi.fn(),
  listBranches: vi.fn(),
  listIssues: vi.fn(),
  listNotifications: vi.fn(),
  listPRs: vi.fn().mockResolvedValue([{ number: 1 }]),
  mergePR: vi.fn(),
  reviewPR: vi.fn(),
}))

describe('daemon MCP adapter', () => {
  it('exposes lazyhub-prefixed tools and executes aliases', async () => {
    const { TOOLS, callTool } = await import('./mcp-adapter.js')
    expect(TOOLS.map(tool => tool.name)).toContain('lazyhub_pr_list')
    await expect(callTool('lazyhub_pr_list', { repo: 'owner/repo' })).resolves.toEqual([{ number: 1 }])
  })

  it('does not advertise mutating tools', async () => {
    const { TOOLS } = await import('./mcp-adapter.js')
    const names = TOOLS.map(tool => tool.name)
    expect(names).not.toContain('merge_pr')
    expect(names).not.toContain('lazyhub_pr_merge')
    expect(names).not.toContain('post_comment')
    expect(names).not.toContain('lazyhub_issue_comment')
  })

  it.each([
    'approve_pr',
    'lazyhub_pr_approve',
    'merge_pr',
    'lazyhub_pr_merge',
    'post_comment',
    'lazyhub_pr_comment',
    'lazyhub_issue_comment',
    'close_issue',
    'review_line',
    'lazyhub_pr_review_line',
  ])(
    'rejects direct calls to disabled mutating tool %s',
    async name => {
      const { MCP_MUTATIONS_DISABLED, callTool } = await import('./mcp-adapter.js')
      await expect(callTool(name, {
        repo: 'owner/repo',
        number: 1,
        strategy: 'admin-squash',
      })).rejects.toThrow(MCP_MUTATIONS_DISABLED)
    }
  )
})
