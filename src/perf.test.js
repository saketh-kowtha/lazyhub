import { describe, expect, it } from 'vitest'
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
})
