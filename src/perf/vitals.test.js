// V0 acceptance (#597): the recorder is a constant no-op when disabled, and what it records is
// structurally incapable of carrying GitHub text. Metric math is covered in vitals-metrics.test.js.
import { EventEmitter } from 'events'
import { describe, expect, it, vi } from 'vitest'

const fsCalls = vi.hoisted(() => ({ n: 0 }))
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  const count = fn => (...args) => { fsCalls.n += 1; return fn(...args) }
  return {
    ...actual,
    default: actual,
    appendFileSync: count(actual.appendFileSync),
    writeFileSync: count(actual.writeFileSync),
    mkdirSync: count(actual.mkdirSync),
    openSync: count(actual.openSync),
    writeSync: count(actual.writeSync),
  }
})

const { createRecorder, hasClear, vitals } = await import('./vitals.js')

describe('vitals recorder, disabled (default)', () => {
  it('the env-driven singleton is off without LAZYHUB_VITALS=1', () => {
    expect(process.env.LAZYHUB_VITALS).not.toBe('1')
    expect(vitals.enabled).toBe(false)
  })

  it('makes zero fs calls, starts no timers and adds no listeners', () => {
    vi.useFakeTimers()
    try {
      const exitListeners = process.listenerCount('exit')
      const rec = createRecorder({ enabled: false, file: '/nonexistent/should-not-be-touched.jsonl' })
      const stream = new EventEmitter()
      stream.write = vi.fn(() => true)
      const wrapped = rec.wrapStdout(stream)
      expect(wrapped).toBe(stream) // not even a Proxy
      for (const r of [rec, vitals]) {
        r.key('nav'); r.frame('\x1b[2Jframe'); r.mount('pr-list'); r.unmount('pr-list')
        r.mode('pr-list', 'data'); r.gh('searchPrs'); r.rowRender('pr-list', 3)
      }
      wrapped.write('frame')
      expect(fsCalls.n).toBe(0)
      expect(vi.getTimerCount()).toBe(0)
      expect(process.listenerCount('exit')).toBe(exitListeners)
      expect(stream.listenerCount('data')).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('vitals recorder, enabled', () => {
  const FIXTURES = ['Perf PR 5000 fixture', 'octocat', 'saketh-kowtha/lazyhub', 'ghp_secrettoken123', 'feature/perf-5000']
  const FRAME_TEXT = FIXTURES.join(' ')
  const record = () => {
    const lines = []
    let t = 0
    const rec = createRecorder({ enabled: true, file: '/virtual/vitals.jsonl', append: (file, text) => { expect(file).toBe('/virtual/vitals.jsonl'); lines.push(text) }, now: () => (t += 1.5) })
    return { rec, lines, events: () => lines.join('').split('\n').filter(Boolean).map(l => JSON.parse(l)) }
  }

  it('records the typed events with timestamps', () => {
    const { rec, events } = record()
    rec.key('nav'); rec.mount('pr-list'); rec.mode('pr-list', 'skeleton'); rec.gh('searchPrs'); rec.rowRender('pr-list', 2); rec.unmount('pr-list')
    expect(events().map(e => e.type)).toEqual(['key', 'mount', 'mode', 'gh', 'rowRender', 'unmount'])
    expect(events()[2]).toMatchObject({ view: 'pr-list', mode: 'skeleton' })
    expect(events().every(e => typeof e.t === 'number')).toBe(true)
  })

  it('wrapStdout timestamps each write, passes bytes through unchanged and flags a clear', () => {
    const { rec, events } = record()
    const writes = []
    const stream = new EventEmitter()
    stream.columns = 80
    stream.rows = 24
    stream.write = chunk => { writes.push(chunk); return true }
    const wrapped = rec.wrapStdout(stream)
    expect(wrapped.columns).toBe(80)
    wrapped.write('first paint')
    wrapped.write(Buffer.from('\x1b[2J\x1b[3J\x1b[Hnext'))
    expect(writes).toEqual(['first paint', Buffer.from('\x1b[2J\x1b[3J\x1b[Hnext')])
    expect(events().map(e => [e.type, e.clear])).toEqual([['frame', false], ['frame', true]])
    expect(events()[0].bytes).toBe(11)
    expect(hasClear('plain')).toBe(false)
  })

  it('never lets GitHub text, logins, repo names or tokens reach the file', () => {
    const { rec, lines } = record()
    const stream = new EventEmitter()
    stream.write = () => true
    const wrapped = rec.wrapStdout(stream)
    // Frames carry rendered GitHub text; only bytes and the clear flag may be kept.
    wrapped.write(`#5000 ${FRAME_TEXT}`)
    // Names are short identifiers chosen in code, else "?": free text (a title, a repo, a branch) passed by mistake is dropped.
    rec.mount(FIXTURES[0]); rec.unmount(FIXTURES[2]); rec.mode(FIXTURES[0], FIXTURES[1]); rec.gh(FIXTURES[2]); rec.rowRender(FIXTURES[4], 1); rec.key(FIXTURES[0])
    const file = lines.join('')
    for (const secret of FIXTURES) expect(file).not.toContain(secret)
    expect(file).toContain('"view":"?"')
  })

  it('a failing sink never breaks the app', () => {
    const rec = createRecorder({ enabled: true, file: '/x', append: () => { throw new Error('disk full') } })
    expect(() => rec.mount('pr-list')).not.toThrow()
  })
})
