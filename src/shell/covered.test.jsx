import React from 'react'
import { Text } from 'ink'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from 'ink-testing-library'
import { CoveredContext, useCoveredInterval } from './covered.js'

afterEach(() => { cleanup() })

function Poller({ onTick }) {
  useCoveredInterval(onTick, 20)
  return <Text>poller</Text>
}

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms))

describe('useCoveredInterval', () => {
  it('ticks while on screen, stops while covered (polling pause) and resumes after', async () => {
    const onTick = vi.fn()
    const view = render(<CoveredContext.Provider value={false}><Poller onTick={onTick} /></CoveredContext.Provider>)
    await wait(120)
    expect(onTick.mock.calls.length).toBeGreaterThan(1)

    view.rerender(<CoveredContext.Provider value><Poller onTick={onTick} /></CoveredContext.Provider>)
    await wait(30)
    const frozen = onTick.mock.calls.length
    await wait(200)
    expect(onTick.mock.calls.length).toBe(frozen)

    view.rerender(<CoveredContext.Provider value={false}><Poller onTick={onTick} /></CoveredContext.Provider>)
    await wait(120)
    expect(onTick.mock.calls.length).toBeGreaterThan(frozen)
  })
})
