import React from 'react'
import { sendInput } from './input-bus.js'

/**
 * Replays `events` ({ input, key } or { wait }) one at a time, each delivered via
 * sendInput() so React has settled (render + passive effects) before the next key.
 * Keep `events` referentially stable if the parent re-renders.
 */
export function InputDriver({ events }) {
  React.useEffect(() => {
    let alive = true
    ;(async () => {
      // Leave the commit phase this effect runs in; act() cannot start inside it.
      await Promise.resolve()
      for (const event of events) {
        if (!alive) return
        if (event.wait) {
          await new Promise(resolve => setTimeout(resolve, event.wait))
          continue
        }
        await sendInput(event.input || '', event.key || {})
      }
    })()
    return () => { alive = false }
  }, [events])

  return null
}
