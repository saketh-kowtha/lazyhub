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
    await expect(callTool('lazyhub_pr_list', { repo: 'owner/repo' })).resolves.toEqual([{ number: 1, statusCheckRollup: [] }])
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

  it('ignores client-supplied scope metadata when resolving authority', async () => {
    const { MCP_MUTATIONS_DISABLED, callTool } = await import('./mcp-adapter.js')
    await expect(callTool('merge_pr', {
      repo: 'owner/repo',
      number: 1,
      scope: 'full',
      _meta: { agent: 'trusted', scope: 'full' },
    })).rejects.toMatchObject({ code: 'MCP_MUTATIONS_DISABLED', message: MCP_MUTATIONS_DISABLED })
  })

  it.each([
    ['get_pr', { repo: 'owner/repo', number: '1' }, 'MCP_INVALID_NUMBER'],
    ['get_pr', { repo: 'owner/repo', number: -3 }, 'MCP_INVALID_NUMBER'],
    ['get_pr', { repo: 'owner/repo', number: 1.5 }, 'MCP_INVALID_NUMBER'],
    ['get_issue', { repo: 'owner/repo' }, 'MCP_INVALID_NUMBER'],
    ['get_pr', { repo: 'not a repo', number: 1 }, 'MCP_INVALID_REPO'],
    ['get_pr', { repo: ['owner/repo'], number: 1 }, 'MCP_INVALID_REPO'],
    ['list_prs', { repo: 'owner/repo', state: 'bogus' }, 'MCP_INVALID_STATE'],
    ['list_issues', { repo: 'owner/repo', state: 'merged' }, 'MCP_INVALID_STATE'],
    ['list_prs', { repo: 'owner/repo', limit: 100000 }, 'MCP_INVALID_LIMIT'],
    ['get_pr', { number: 1 }, 'MCP_INVALID_REPO'],
    ['list_prs', {}, 'MCP_INVALID_REPO'],
    ['lazyhub_query', { query: 'x' }, 'MCP_UNKNOWN_TOOL'],
    ['get_issue', { repo: 'owner/repo', number: 1, resource_type: 'pr' }, 'MCP_RESOURCE_MISMATCH'],
    ['get_pr', { repo: 'owner/repo', number: 1, resource_type: 'issue' }, 'MCP_RESOURCE_MISMATCH'],
    ['no_such_tool', {}, 'MCP_UNKNOWN_TOOL'],
    [undefined, {}, 'MCP_INVALID_TOOL'],
    ['list_prs', null, 'MCP_INVALID_ARGUMENTS'],
  ])('fails closed on malformed call %s %j with %s', async (name, args, code) => {
    const { callTool } = await import('./mcp-adapter.js')
    await expect(callTool(name, args)).rejects.toMatchObject({ code })
  })

  it('does not advertise a placeholder lazyhub_query tool', async () => {
    const { TOOLS } = await import('./mcp-adapter.js')
    expect(TOOLS.map(tool => tool.name)).not.toContain('lazyhub_query')
  })

  it('names the missing number when a numbered tool lacks it', async () => {
    const { callTool } = await import('./mcp-adapter.js')
    await expect(callTool('get_pr', { repo: 'owner/repo' })).rejects.toThrow(/requires a number/)
  })

  it('advertises per-tool input schemas with required fields', async () => {
    const { TOOLS } = await import('./mcp-adapter.js')
    const by = Object.fromEntries(TOOLS.map(t => [t.name, t.inputSchema]))
    for (const name of ['get_pr', 'get_pr_diff', 'get_checks', 'get_issue', 'lazyhub_pr_view', 'lazyhub_watch_ci']) {
      expect(by[name].required).toEqual(['number'])
    }
    expect(by.list_prs.required).toBeUndefined()
    expect(by.list_prs.properties.state.enum).toContain('merged')
    expect(by.list_issues.properties.state.enum).not.toContain('merged')
    expect(by.list_notifications.properties).toEqual({})
  })

  it('reports the package version in initialize and compact JSON in results', async () => {
    const { readFileSync } = await import('node:fs')
    const version = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version
    const { handleRequest } = await import('./mcp-adapter.js')
    const out = []
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(s => { out.push(String(s)); return true })
    await handleRequest({ id: 1, method: 'initialize' })
    await handleRequest({ id: 2, method: 'tools/call', params: { name: 'list_prs', arguments: { repo: 'owner/repo' } } })
    write.mockRestore()
    expect(JSON.parse(out[0]).result.serverInfo.version).toBe(version)
    const text = JSON.parse(out[1]).result.content[0].text
    expect(text).not.toContain('\n')
    expect(JSON.parse(text)[0].number).toBe(1)
  })

  it('slims list_prs: no body, checks capped with the real total reported', async () => {
    const { listPRs } = await import('../executor.js')
    const checks = Array.from({ length: 25 }, (_, i) => ({ name: `c${i}`, status: 'COMPLETED', conclusion: 'SUCCESS' }))
    listPRs.mockResolvedValueOnce([{ number: 7, title: 't', body: 'x'.repeat(5000), statusCheckRollup: checks }])
    const { callTool } = await import('./mcp-adapter.js')
    const [pr] = await callTool('list_prs', { repo: 'owner/repo' })
    expect(pr).not.toHaveProperty('body')
    expect(pr.statusCheckRollup).toHaveLength(10)
    expect(pr.checksTotal).toBe(25)
  })
})
