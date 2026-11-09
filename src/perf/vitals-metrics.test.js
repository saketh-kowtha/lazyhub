import { describe, expect, it } from 'vitest'
import { band, clearFrames, extraMounts, flashCount, ghCallsSince, parseEvents, percentile } from './vitals-metrics.js'

describe('vitals metric math', () => {
  it('bands follow the decision-doc thresholds', () => {
    expect(band('FMF-cold', 1200)).toBe('good')
    expect(band('FMF-cold', 1201)).toBe('needs-work')
    expect(band('FMF-cold', 2001)).toBe('poor')
    expect(band('KTF-nav', 50)).toBe('good')
    expect(band('KTF-nav', 101)).toBe('poor')
  })

  it('percentile is nearest-rank and NaN when empty', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3)
    expect(percentile(Array.from({ length: 20 }, (_, i) => i + 1), 95)).toBe(19)
    expect(percentile([], 95)).toBeNaN()
  })

  it('CLEAR ignores first paint and counts later clears', () => {
    const f = clear => ({ type: 'frame', clear })
    expect(clearFrames([f(true), f(false), f(true), { type: 'key' }, f(true)])).toBe(2)
    expect(clearFrames([])).toBe(0)
  })

  it('FLASH counts data -> placeholder, skipping other views', () => {
    const kind = s => (s.startsWith('rows') ? 'data' : s.startsWith('skel') ? 'placeholder' : null)
    expect(flashCount(['rows', 'rows', 'rows+'], kind)).toBe(0)
    expect(flashCount(['rows', 'skel', 'rows'], kind)).toBe(1)
    expect(flashCount(['rows', 'help overlay', 'skel', 'rows'], kind)).toBe(1)
    expect(flashCount(['skel', 'rows'], kind)).toBe(0) // first load is not a flash
    expect(flashCount(['rows', 'help overlay', 'rows'], kind)).toBe(0)
  })

  it('REMOUNT counts mounts beyond the first, per view', () => {
    const events = [{ type: 'mount', view: 'a' }, { type: 'mount', view: 'b' }, { type: 'unmount', view: 'a' }, { type: 'mount', view: 'a' }]
    expect(extraMounts(events, 'a')).toBe(1)
    expect(extraMounts(events, 'b')).toBe(0)
    expect(extraMounts([], 'a')).toBe(0)
  })

  it('WARM-GH counts calls from the window start and the JSONL parser tolerates blank lines', () => {
    expect(ghCallsSince([{ t: 1 }, { t: 5 }, { t: 9 }], 5)).toBe(2)
    expect(parseEvents('{"type":"key"}\n\n{"type":"frame"}\n')).toHaveLength(2)
  })
})
