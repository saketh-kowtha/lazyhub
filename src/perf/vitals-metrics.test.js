import { describe, expect, it } from 'vitest'
import { band, clearFrames, extraMounts, flashCount, ghCallsSince, idleWakeups, parseEvents, percentile } from './vitals-metrics.js'

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

describe('IDLE-WAKEUPS (#620)', () => {
  it('clusters callbacks into wakeups, names each by its first tag and splits out the shared clock', () => {
    const ev = [
      { type: 'wake', t: 0, tag: 'clock' }, { type: 'wake', t: 32, tag: '?' }, // clock + Ink throttle: 1 wakeup
      { type: 'frame', t: 40 },
      { type: 'wake', t: 10_000, tag: 'clock' },
      { type: 'wake', t: 20_000, tag: '?' }, { type: 'wake', t: 20_010, tag: 'poll.issue-detail' },
      { type: 'wake', t: 70_000, tag: 'clock' }, // outside the window
    ]
    expect(idleWakeups(ev, 0, 60_000)).toEqual({ total: 3, clock: 2, other: 1, tags: { clock: 2, 'poll.issue-detail': 1 } })
    expect(idleWakeups(ev, 30_000, 60_000)).toEqual({ total: 0, clock: 0, other: 0, tags: {} })
  })
})
