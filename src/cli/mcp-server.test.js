import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../bootstrap.js', () => ({ headlessPreflight: vi.fn() }))
vi.mock('../mcp.js', () => ({ runMCPServer: vi.fn() }))

const { runMcpServer } = await import('./mcp-server.js')
const { headlessPreflight } = await import('../bootstrap.js')
const { runMCPServer } = await import('../mcp.js')

describe('lazyhub mcp entry point', () => {
  beforeEach(() => {
    headlessPreflight.mockReset()
    runMCPServer.mockReset()
  })

  it('preflights gh headlessly before serving stdio and exits 0 when the stream ends', async () => {
    const order = []
    headlessPreflight.mockImplementation(async () => { order.push('preflight'); return { ok: true } })
    runMCPServer.mockImplementation(async () => { order.push('serve') })
    expect(await runMcpServer()).toBe(0)
    expect(order).toEqual(['preflight', 'serve'])
  })

  it('never opens the agent-facing server when preflight fails; one stderr line, exit 1', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    headlessPreflight.mockResolvedValue({ ok: false, message: 'lazyhub --mcp: not authenticated' })
    expect(await runMcpServer()).toBe(1)
    expect(runMCPServer).not.toHaveBeenCalled()
    expect(write).toHaveBeenCalledWith('lazyhub --mcp: not authenticated\n')
    write.mockRestore()
  })
})
