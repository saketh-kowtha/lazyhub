import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi } from 'vitest'
import { buildPerfReport, percentile } from './perf.js'

describe('perf report', () => {
  it('calculates percentile rows from NDJSON', () => {
    const rows = buildPerfReport([
      JSON.stringify({ ts: 't', type: 'gh', name: 'pr list', ms: 10 }),
      JSON.stringify({ ts: 't', type: 'gh', name: 'pr list', ms: 30 }),
      JSON.stringify({ ts: 't', type: 'input', name: 'keypress-render', ms: 5 }),
      'not-json',
    ].join('\n'))
    expect(rows).toContainEqual({ op: 'gh:pr list', count: 2, p50: 10, p95: 30, max: 30 })
    expect(rows).toContainEqual({ op: 'input:keypress-render', count: 1, p50: 5, p95: 5, max: 5 })
  })

  it('handles empty percentile input', () => {
    expect(percentile([], 95)).toBe(0)
  })

  it('does not write perf entries unless LAZYHUB_PERF is enabled', async () => {
    vi.resetModules()
    const dir = mkdtempSync(join(tmpdir(), 'lazyhub-perf-test-'))
    const path = join(dir, 'perf.ndjson')
    delete process.env.LAZYHUB_PERF
    process.env.LAZYHUB_PERF_PATH = path
    try {
      const perf = await import('./perf.js')
      perf.recordDuration('input', 'keypress-render', 1)
      expect(perf.isPerfEnabled()).toBe(false)
      expect(existsSync(path)).toBe(false)
    } finally {
      delete process.env.LAZYHUB_PERF_PATH
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
