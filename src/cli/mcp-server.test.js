import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../bootstrap.js', () => ({ bootstrap: vi.fn() }))
vi.mock('../mcp.js', () => ({ runMCPServer: vi.fn() }))

const { runMcpServer } = await import('./mcp-server.js')
const { bootstrap } = await import('../bootstrap.js')
const { runMCPServer } = await import('../mcp.js')

describe('lazyhub mcp entry point', () => {
  beforeEach(() => {
    bootstrap.mockReset()
    runMCPServer.mockReset()
  })

  it('bootstraps gh health before serving stdio and exits 0 when the stream ends', async () => {
    const order = []
    bootstrap.mockImplementation(async () => { order.push('bootstrap') })
    runMCPServer.mockImplementation(async () => { order.push('serve') })
    expect(await runMcpServer()).toBe(0)
    expect(order).toEqual(['bootstrap', 'serve'])
    expect(bootstrap).toHaveBeenCalledWith(null)
  })

  it('never opens the agent-facing server when bootstrap fails', async () => {
    bootstrap.mockRejectedValue(new Error('gh not authenticated'))
    await expect(runMcpServer()).rejects.toThrow('gh not authenticated')
    expect(runMCPServer).not.toHaveBeenCalled()
  })
})
