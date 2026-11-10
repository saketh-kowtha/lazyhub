/** One animated element, tick >= 120 ms, fixed-width activity cell, shared minute clock (#597, V5). */
import React from 'react'
import { Box, Text } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Spinner, SPINNER_FRAMES } from '../components/Spinner.jsx'
import { ActivityIndicator } from '../components/ActivityIndicator.jsx'
import { TICK_MS, animationActive } from './animation.js'
import { currentMinute, minuteClockSubscribers, subscribeMinuteClock, useMinuteClock } from './clock.js'
import { cleanup, flush, renderWithProviders } from '../test/test-helpers.jsx'

afterEach(() => { cleanup(); vi.useRealTimers() })

const GLYPHS = new RegExp(`[${SPINNER_FRAMES.join('')}]`, 'g')

describe('single animation slot', () => {
  it('ticks no faster than 120 ms', () => {
    expect(TICK_MS).toBeGreaterThanOrEqual(120)
  })

  it('animates one element; the others stay static', async () => {
    const view = renderWithProviders(
      <Box flexDirection="column">
        <Spinner label="a" />
        <Spinner label="b" />
        <ActivityIndicator active width={4} />
      </Box>,
    )
    await flush(20)
    const seen = new Set()
    for (let i = 0; i < 6; i++) {
      const lines = view.lastFrame().split('\n')
      expect(lines[1]).toMatch(/^⠋ b/)
      expect(lines[2]).toContain('·')
      seen.add(lines[0].match(GLYPHS)?.[0])
      await new Promise(r => setTimeout(r, TICK_MS + 15))
    }
    expect(seen.size).toBeGreaterThan(2)
  })

  it('stops the timer when nothing animates', async () => {
    renderWithProviders(<Spinner label="a" />)
    await flush(20)
    expect(animationActive()).toBe(true)
    cleanup()
    await flush(20)
    expect(animationActive()).toBe(false)
  })
})

describe('ActivityIndicator', () => {
  it('reserves the same width idle and active', async () => {
    const row = active => (
      <Box><Text>[</Text><ActivityIndicator active={active} width={8} label="sync" /><Text>]</Text></Box>
    )
    const view = renderWithProviders(row(false))
    await flush(20)
    expect(view.lastFrame()).toBe('[        ]')
    view.rerender(row(true))
    await flush(20)
    expect(view.lastFrame()).toMatch(/^\[. sync {2}\]$/)
    expect(animationActive()).toBe(true)
    view.rerender(row(false))
    await flush(20)
    expect(view.lastFrame()).toBe('[        ]')
    expect(animationActive()).toBe(false)
  })

  it('clips a long label to its width', async () => {
    const view = renderWithProviders(<Box><ActivityIndicator active width={6} label="synchronizing everything" /><Text>|</Text></Box>)
    await flush(20)
    expect(view.lastFrame()).toMatch(/^.{5}…\|$/)
  })
})

describe('shared minute clock', () => {
  it('uses one timer for any number of subscribers and fires on the minute boundary', () => {
    vi.useFakeTimers({ now: new Date('2026-06-06T10:00:30Z') })
    const a = vi.fn(); const b = vi.fn(); const c = vi.fn()
    const offs = [a, b, c].map(subscribeMinuteClock)
    expect(vi.getTimerCount()).toBe(1)
    vi.advanceTimersByTime(29_000)
    expect(a).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1_100)
    expect([a, b, c].map(f => f.mock.calls.length)).toEqual([1, 1, 1])
    vi.advanceTimersByTime(60_000)
    expect(a).toHaveBeenCalledTimes(2)
    offs.forEach(off => off())
    expect(minuteClockSubscribers()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('re-renders a subscriber at the minute boundary and not in between', async () => {
    vi.useFakeTimers({ now: new Date('2026-06-06T10:00:30Z'), toFake: ['setTimeout', 'clearTimeout', 'Date'] })
    let renders = 0
    function Age() { useMinuteClock(); renders++; return <Text>m={currentMinute()}</Text> }
    const view = renderWithProviders(<Age />)
    const first = renders
    vi.advanceTimersByTime(25_000)
    expect(renders).toBe(first)
    vi.advanceTimersByTime(10_000)
    vi.useRealTimers()
    await flush(20)
    expect(renders).toBeGreaterThan(first)
    expect(view.lastFrame()).toContain(`m=${currentMinute()}`)
  })
})
