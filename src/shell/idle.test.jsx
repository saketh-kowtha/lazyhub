/**
 * #620 acceptance: zero work while idle. Every recurring timer in src (see the audit below) pauses
 * while its view is covered and while the app is idle, and resumes on uncover / the next key. Counted
 * with fake timers: a paused site has 0 pending timers and its callback never runs.
 */
import React, { useState } from 'react'
import { Text } from 'ink'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CoveredContext, useCoveredInterval } from './covered.js'
import { isIdle, noteActivity, resetActivity, subscribeIdle } from './activity.js'
import { PRListSkeleton } from '../components/Skeleton.jsx'
import { Spinner } from '../components/Spinner.jsx'
import { StatusBar } from '../components/StatusBar.jsx'
import { animationActive, animationClaimed } from '../ui/animation.js'
import { minuteClockSubscribers, useMinuteClock } from '../ui/clock.js'
import { cleanup, renderWithProviders } from '../test/test-helpers.jsx'

const IDLE_MS = 5_000
// React flushes effects on the (real) immediate queue; only the timer functions and Date are faked.
const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve)) }
/** @type {(on: boolean) => void} */
let setCovered = () => {}
/** A covered/uncovered switch that keeps its children mounted (a rerender from outside would remount them). */
function Cover({ initial, children }) {
  const [on, set] = useState(initial)
  setCovered = set
  return <CoveredContext.Provider value={on}>{children}</CoveredContext.Provider>
}
const covered = (on, ui) => <Cover initial={on}>{ui}</Cover>
const cover = async on => { setCovered(on); await settle() }

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-06-06T10:00:05Z'), toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  resetActivity(IDLE_MS)
})
afterEach(() => {
  cleanup()
  resetActivity()
  vi.useRealTimers()
})

/** Let Ink's render throttle settle, then count what is still pending. */
const pending = () => { vi.advanceTimersByTime(100); return vi.getTimerCount() }
const goIdle = async () => { vi.advanceTimersByTime(IDLE_MS + 10); await settle(); expect(isIdle()).toBe(true) }

function Poller({ onTick, ms = 1_000 }) {
  useCoveredInterval(onTick, ms, 'test')
  return <Text>poll</Text>
}

describe('idle detector (src/shell/activity.js)', () => {
  it('turns idle after the idle period without a key, and costs no timer once idle', () => {
    const changes = vi.fn()
    const off = subscribeIdle(changes)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(IDLE_MS - 100)
    noteActivity() // a key half way does not add a timer, it moves the deadline
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(200)
    expect(isIdle()).toBe(false)
    vi.advanceTimersByTime(IDLE_MS)
    expect(isIdle()).toBe(true)
    expect(changes).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    noteActivity()
    expect(isIdle()).toBe(false)
    expect(changes).toHaveBeenCalledTimes(2)
    off()
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('useCoveredInterval: polls', () => {
  it('covered: 0 pending timers and no tick; uncovered: resumes', async () => {
    const onTick = vi.fn()
    renderWithProviders(covered(false, <Poller onTick={onTick} />))
    await settle()
    vi.advanceTimersByTime(2_050)
    expect(onTick).toHaveBeenCalledTimes(2)

    await cover(true)
    const before = onTick.mock.calls.length
    vi.advanceTimersByTime(300)
    // only the idle detector remains (the poller is subscribed to it)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(1_000)
    expect(onTick).toHaveBeenCalledTimes(before)

    // The tick came due while covered: it runs at once on uncover, then every period.
    await cover(false)
    expect(onTick).toHaveBeenCalledTimes(before + 1)
    vi.advanceTimersByTime(1_000)
    expect(onTick).toHaveBeenCalledTimes(before + 2)
  })

  it('a short cover/uncover does not tick early (an overlay costs no poll)', async () => {
    const onTick = vi.fn()
    renderWithProviders(covered(false, <Poller onTick={onTick} />))
    await settle()
    vi.advanceTimersByTime(300)
    await cover(true)
    vi.advanceTimersByTime(200)
    await cover(false)
    expect(onTick).not.toHaveBeenCalled()
    vi.advanceTimersByTime(499)
    expect(onTick).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(onTick).toHaveBeenCalledTimes(1)
  })

  it('idle: 0 pending timers and no tick; the next key resumes it with one refresh', async () => {
    const onTick = vi.fn()
    renderWithProviders(<Poller onTick={onTick} ms={1_000} />)
    await settle()
    await goIdle()
    const before = onTick.mock.calls.length
    expect(pending()).toBe(0)
    vi.advanceTimersByTime(60_000)
    expect(onTick).toHaveBeenCalledTimes(before)
    noteActivity()
    await settle()
    expect(onTick).toHaveBeenCalledTimes(before + 1)
    vi.advanceTimersByTime(1_000)
    expect(onTick).toHaveBeenCalledTimes(before + 2)
  })
})

describe('skeleton pulse', () => {
  it('covered: no timer; uncovered: pulses', async () => {
    const view = renderWithProviders(covered(true, <PRListSkeleton count={2} />))
    await settle()
    expect(pending()).toBe(1) // the idle detector only
    await cover(false)
    expect(pending()).toBe(2)
    const a = view.lastFrame()
    vi.advanceTimersByTime(700)
    await settle()
    expect(view.lastFrame()).not.toBe(a)
  })

  it('idle: holds its frame with no timer; a key restarts it', async () => {
    const view = renderWithProviders(<PRListSkeleton count={2} />)
    await settle()
    await goIdle()
    expect(pending()).toBe(0)
    const still = view.lastFrame()
    vi.advanceTimersByTime(60_000)
    await settle()
    expect(view.lastFrame()).toBe(still)
    noteActivity()
    await settle()
    expect(pending()).toBe(2)
  })
})

describe('spinner (shared animation slot)', () => {
  it('a covered spinner does not claim the slot', async () => {
    renderWithProviders(covered(true, <Spinner label="x" />))
    await settle()
    expect(animationClaimed()).toBe(false)
    expect(pending()).toBe(0)
    await cover(false)
    expect(animationActive()).toBe(true)
  })

  it('idle: the tick stops (claim kept), the next key restarts it', async () => {
    renderWithProviders(<Spinner label="x" />)
    await settle()
    expect(animationActive()).toBe(true)
    await goIdle()
    expect(animationClaimed()).toBe(true)
    expect(animationActive()).toBe(false)
    expect(pending()).toBe(0)
    noteActivity()
    await settle()
    expect(animationActive()).toBe(true)
  })
})

describe('status bar age and the minute clock (the shared clock)', () => {
  it('the status bar ticks on the shared clock only while its age can show', async () => {
    // ink-testing-library's stdout is 100 columns: wide enough for the age
    const view = renderWithProviders(<StatusBar repo="o/r" pane="prs" count={1} />)
    await settle()
    expect(pending()).toBe(1)
    expect(minuteClockSubscribers()).toBe(1)
    view.rerender(<StatusBar repo="o/r" pane="prs" count={1} hideAge />)
    await settle()
    expect(pending()).toBe(0)
  })

  it('a covered view does not subscribe to the minute clock', async () => {
    function Age() { useMinuteClock(); return <Text>age</Text> }
    renderWithProviders(covered(true, <Age />))
    await settle()
    expect(minuteClockSubscribers()).toBe(0)
    expect(pending()).toBe(0)
    await cover(false)
    expect(minuteClockSubscribers()).toBe(1)
  })
})

describe('whole screen while idle', () => {
  it('poll + skeleton + spinner + relative time: zero timer ticks over 60 s idle except the shared clock', async () => {
    const onTick = vi.fn()
    let ageRenders = 0
    function Age() { useMinuteClock(); ageRenders++; return <Text>age</Text> }
    renderWithProviders(
      <>
        <Poller onTick={onTick} />
        <PRListSkeleton count={1} />
        <Spinner label="loading" />
        <Age />
      </>,
    )
    await settle()
    await goIdle()
    const ticks = onTick.mock.calls.length
    // Count every timer callback that fires during the idle minute.
    const fired = []
    const realAdvance = () => {
      for (let t = 0; t < 60_000; t += 1_000) {
        const n = vi.getTimerCount()
        vi.advanceTimersByTime(1_000)
        if (n > 0) fired.push(n)
      }
    }
    expect(pending()).toBe(1) // the minute clock only
    const agesBefore = ageRenders
    realAdvance()
    await settle()
    expect(onTick).toHaveBeenCalledTimes(ticks)
    expect(animationActive()).toBe(false)
    expect(ageRenders - agesBefore).toBeLessThanOrEqual(2) // one minute boundary (+ React re-check)
    expect(vi.getTimerCount()).toBe(1)
  })
})

describe('timer audit', () => {
  // Every recurring timer in src and how it pauses. A new setInterval must be added here with its gate.
  const GATED_INTERVALS = {
    'shell/covered.js': 'useCoveredInterval: covered + idle',
    'ui/animation.js': 'claims only while not covered; tick stops while idle',
    'components/Skeleton.jsx': 'usePulse: covered + idle',
  }
  it('no setInterval outside the gated sites', () => {
    const src = join(import.meta.dirname, '..')
    const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p] })
    const offenders = walk(src)
      .filter(f => /\.(js|jsx)$/.test(f) && !/\.test\.|\/test\//.test(f))
      .map(f => relative(src, f))
      .filter(rel => /\bsetInterval\(/.test(readFileSync(join(src, rel), 'utf8')) && !GATED_INTERVALS[rel])
    expect(offenders).toEqual([])
  })
})
