import { describe, it, expect } from 'vitest'
import { runDoctor } from './index.js'

function sink() {
  const chunks = []
  return { write: s => { chunks.push(s) }, text: () => chunks.join('') }
}

describe('runDoctor', () => {
  it('rejects --json with both --config and --coverage instead of emitting two documents', async () => {
    const out = sink()
    const err = sink()
    expect(await runDoctor(['--config', '--coverage', '--json'], out, err)).toBe(2)
    expect(out.text()).toBe('')
    expect(err.text()).toMatch(/not both/)
  })

  it('--help / -h print the real options and exit codes without running any check', async () => {
    for (const flag of ['--help', '-h']) {
      const out = sink()
      expect(await runDoctor([flag], out, sink())).toBe(0)
      for (const word of ['--config', '--coverage', '--repo', '--json', 'exactly one report', 'Exit codes']) expect(out.text()).toContain(word)
      expect(out.text()).not.toContain('--ai')
    }
  })
})
