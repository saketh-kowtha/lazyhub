import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => { vi.restoreAllMocks(); vi.resetModules(); delete process.stdout.isTTY })

describe('restoreTerminal (machine modes)', () => {
  it('writes nothing to a piped stdout', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true, writable: true })
    const w = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { restoreTerminal } = await import('./crash.js')
    restoreTerminal()
    expect(w).not.toHaveBeenCalled()
  })
  it('still restores a real terminal', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true, writable: true })
    const w = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { restoreTerminal } = await import('./crash.js')
    restoreTerminal()
    expect(String(w.mock.calls[0][0])).toContain('\x1b[?1049l')
  })
})
