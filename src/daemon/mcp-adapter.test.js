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
})
